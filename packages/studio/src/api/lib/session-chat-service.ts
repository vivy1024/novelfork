import type { Server as NodeHttpServer } from "node:http";

import { WebSocketServer, type RawData, type WebSocket as NodeWebSocket } from "ws";

import type {
  BunWebSocketConnection,
  BunWebSocketRegistrar,
  StartedHttpServer,
} from "../start-http-server.js";

import type {
  CanvasContext,
  OpenResourceTab,
  SessionToolDefinition,
  SessionToolExecutionResult,
  ToolConfirmationAudit,
  ToolConfirmationDecision,
  ToolConfirmationRequest,
  WorkspaceResourceRef,
} from "../../shared/agent-native-workspace.js";
import type {
  NarratorSessionChatClientMessage,
  NarratorSessionChatCursor,
  NarratorSessionChatErrorEnvelope,
  NarratorSessionChatHistory,
  NarratorSessionChatMessage,
  NarratorSessionChatMessageEnvelope,
  NarratorSessionChatServerEnvelope,
  NarratorSessionChatSnapshot,
  NarratorSessionChatStateEnvelope,
  NarratorSessionRecord,
  NarratorSessionRecoveryEnvelope,
  NarratorSessionRecoveryMetadata,
  ToolCall,
} from "../../shared/session-types.js";
import {
  appendSessionChatHistory,
  getSessionChatCursor,
  loadSessionChatHistory,
  saveSessionChatHistory,
  updateSessionChatAckedSeq,
  updateSessionChatRecoveryJson,
} from "./session-history-store.js";
import { generateSessionReply, type LlmRuntimeMetadata } from "./llm-runtime-service.js";
import { getSessionById, updateSession } from "./session-service.js";
import { buildAgentContext } from "./agent-context.js";
import { getAgentSystemPrompt } from "@vivy1024/novelfork-core";
import { createSessionToolExecutor, type SessionToolExecutorOptions } from "./session-tool-executor.js";
import { getEnabledSessionTools } from "./session-tool-registry.js";
import { runAgentTurn, type AgentTurnItem, type AgentGenerateResult } from "./agent-turn-runtime.js";
import { loadUserConfig } from "./user-config-service.js";
import { generateSessionTitle } from "./session-auto-title.js";
import { microCompact } from "./compact/micro-compact.js";

const MAX_SESSION_MESSAGES = 500;
const MAX_SESSION_TOOL_LOOP_STEPS = 200;

async function resolveMaxTurnSteps(): Promise<number> {
  try {
    const config = await loadUserConfig();
    const steps = config.runtimeControls?.maxTurnSteps;
    return typeof steps === "number" && steps > 0 ? steps : MAX_SESSION_TOOL_LOOP_STEPS;
  } catch {
    return MAX_SESSION_TOOL_LOOP_STEPS;
  }
}

function shouldContinueAfterToolResult({ result }: { readonly toolName: string; readonly result: SessionToolExecutionResult }): boolean {
  // 确认门暂停 — 不继续（由 isPendingConfirmationResult 在 agent-turn-runtime 中处理）
  if (!result.ok && result.error === "pending-confirmation") return false;
  // 成功或确认被拒绝 — 继续
  if (result.ok || result.error === "confirmation-rejected") return true;
  // 工具失败 — 继续（让模型决定下一步），agent-turn-runtime 内部已有重复检测
  return true;
}

type NormalizedRuntimeToolUse = {
  readonly id: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
};

export type PendingSessionToolConfirmation = ToolConfirmationRequest & {
  readonly sessionId: string;
  readonly messageId: string;
  readonly toolUseId?: string;
  readonly input: Record<string, unknown>;
  readonly status: "pending";
};

export type SessionToolState = {
  readonly sessionId: string;
  readonly tools: readonly SessionToolDefinition[];
  readonly pendingConfirmations: readonly PendingSessionToolConfirmation[];
};

export type ConfirmSessionToolDecisionInput = {
  readonly confirmationId?: string;
  readonly decision?: "approve" | "approved" | "reject" | "rejected";
  readonly action?: "approve" | "reject";
  readonly reason?: string;
};

export type ConfirmSessionToolDecisionResult =
  | {
    readonly ok: true;
    readonly decision: ToolConfirmationDecision;
    readonly toolResult: SessionToolExecutionResult;
    readonly snapshot: NarratorSessionChatSnapshot;
  }
  | { readonly ok: false; readonly status: 400 | 404; readonly error: string };

let sessionToolExecutor = createSessionToolExecutor();

export function configureSessionToolExecutor(options: SessionToolExecutorOptions): void {
  sessionToolExecutor = createSessionToolExecutor(options);
}

interface SessionChatTransport {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface SessionChatTransportState {
  ackedSeq: number;
}

interface SessionChatRuntimeState {
  messageCount: number;
  nextSeq: number;
  messages: NarratorSessionChatMessage[];
  transports: Map<SessionChatTransport, SessionChatTransportState>;
  persistedAckedSeq: number;
  availableFromSeq: number;
  recoveryJson: string;
}

interface AttachSessionChatTransportOptions {
  resumeFromSeq?: number;
}

const runtimeStateBySessionId = new Map<string, SessionChatRuntimeState>();

function sanitizeSeq(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function getLastSeq(messages: NarratorSessionChatMessage[]): number {
  return messages.at(-1)?.seq ?? 0;
}

function normalizeSessionMessages(
  messages: NarratorSessionChatMessage[] | undefined,
  messageCount: number,
): NarratorSessionChatMessage[] {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  const effectiveCount = Math.max(messageCount, sourceMessages.length);
  let nextSeq = Math.max(1, effectiveCount - sourceMessages.length + 1);

  return sourceMessages.map((message) => {
    const candidateSeq = sanitizeSeq(message.seq);
    const seq = candidateSeq >= nextSeq ? candidateSeq : nextSeq;
    nextSeq = seq + 1;

    return {
      ...message,
      timestamp: normalizeTimestamp(message.timestamp),
      seq,
    };
  });
}

function createRuntimeState(
  initialMessageCount = 0,
  initialMessages: NarratorSessionChatMessage[] = [],
  initialAckedSeq = 0,
  initialAvailableFromSeq = 0,
  initialRecoveryJson = "{}",
): SessionChatRuntimeState {
  const normalizedMessages = normalizeSessionMessages(initialMessages, initialMessageCount);
  const lastSeq = getLastSeq(normalizedMessages);
  const messageCount = Math.max(initialMessageCount, lastSeq, normalizedMessages.length);

  return {
    messageCount,
    nextSeq: Math.max(messageCount, lastSeq) + 1,
    messages: normalizedMessages.slice(-MAX_SESSION_MESSAGES),
    transports: new Map(),
    persistedAckedSeq: Math.max(0, Math.min(initialAckedSeq, Math.max(messageCount, lastSeq))),
    availableFromSeq: initialAvailableFromSeq,
    recoveryJson: initialRecoveryJson || "{}",
  };
}

function getRuntimeState(
  sessionId: string,
  initialMessageCount = 0,
  initialMessages: NarratorSessionChatMessage[] = [],
  initialAckedSeq = 0,
  initialAvailableFromSeq = 0,
  initialRecoveryJson = "{}",
): SessionChatRuntimeState {
  const existing = runtimeStateBySessionId.get(sessionId);
  if (existing) {
    if (existing.messages.length === 0 && initialMessages.length > 0) {
      existing.messages = normalizeSessionMessages(initialMessages, initialMessageCount).slice(-MAX_SESSION_MESSAGES);
    }
    existing.messageCount = Math.max(existing.messageCount, initialMessageCount, getLastSeq(existing.messages));
    existing.nextSeq = Math.max(existing.nextSeq, existing.messageCount + 1, getLastSeq(existing.messages) + 1);
    existing.persistedAckedSeq = Math.max(existing.persistedAckedSeq, Math.min(initialAckedSeq, existing.messageCount));
    existing.availableFromSeq = initialAvailableFromSeq || existing.availableFromSeq;
    existing.recoveryJson = initialRecoveryJson || existing.recoveryJson;
    return existing;
  }

  const state = createRuntimeState(initialMessageCount, initialMessages, initialAckedSeq, initialAvailableFromSeq, initialRecoveryJson);
  runtimeStateBySessionId.set(sessionId, state);
  return state;
}

function serializeEnvelope(envelope: NarratorSessionChatServerEnvelope): string {
  return JSON.stringify(envelope);
}

function sendEnvelope(transport: SessionChatTransport, envelope: NarratorSessionChatServerEnvelope): boolean {
  try {
    transport.send(serializeEnvelope(envelope));
    return true;
  } catch {
    return false;
  }
}

function trimSessionMessages(state: SessionChatRuntimeState): void {
  if (state.messages.length <= MAX_SESSION_MESSAGES) {
    return;
  }

  state.messages = state.messages.slice(-MAX_SESSION_MESSAGES);
}

function getPendingToolCalls(messages: NarratorSessionChatMessage[]): ToolCall[] {
  return messages.flatMap((message) => message.toolCalls ?? []).filter((toolCall) => toolCall.status === "pending" || toolCall.status === "running");
}

function buildRecoveryMetadata(
  state: SessionChatRuntimeState,
  messages: NarratorSessionChatMessage[],
  failure?: NarratorSessionRecoveryMetadata["lastFailure"],
): NarratorSessionRecoveryMetadata {
  const lastSeq = Math.max(state.messageCount, getLastSeq(messages));
  const lastAckedSeq = Math.max(0, Math.min(state.persistedAckedSeq, lastSeq));
  const pendingToolCalls = getPendingToolCalls(messages);
  const pendingMessageCount = messages.filter((message) => (message.seq ?? 0) > lastAckedSeq).length;
  return {
    lastSeq,
    lastAckedSeq,
    availableFromSeq: state.availableFromSeq,
    pendingMessageCount,
    pendingToolCallCount: pendingToolCalls.length,
    pendingToolCallSummary: pendingToolCalls.slice(0, 5).map((toolCall) => `${toolCall.toolName}:${toolCall.status ?? "pending"}`),
    ...(failure ? { lastFailure: failure } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function serializeRecoveryMetadata(metadata: NarratorSessionRecoveryMetadata): string {
  return JSON.stringify(metadata);
}

function buildServerFirstSession(session: NarratorSessionRecord, state: SessionChatRuntimeState): NarratorSessionRecord {
  const recentMessages = state.messages.length > 0 ? [...state.messages] : [...(session.recentMessages ?? [])];
  const messageCount = Math.max(session.messageCount, state.messageCount, getLastSeq(recentMessages), recentMessages.length);
  const recovery = buildRecoveryMetadata(state, recentMessages, session.recovery?.lastFailure);

  return {
    ...session,
    messageCount,
    recentMessages,
    recovery,
  };
}

function createCursor(state: SessionChatRuntimeState, ackedSeq = state.persistedAckedSeq): NarratorSessionChatCursor {
  const lastSeq = Math.max(state.messageCount, getLastSeq(state.messages));
  return {
    lastSeq,
    ackedSeq: Math.max(0, Math.min(Math.floor(ackedSeq), lastSeq)),
  };
}

function createSessionChatStateEnvelope(
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  ackedSeq?: number,
  recovery?: NarratorSessionRecoveryEnvelope,
): NarratorSessionChatStateEnvelope {
  return {
    type: "session:state",
    session,
    cursor: createCursor(state, ackedSeq),
    ...(recovery ? { recovery } : {}),
  };
}

function createSessionChatMessageEnvelope(
  sessionId: string,
  state: SessionChatRuntimeState,
  message: NarratorSessionChatMessage,
): NarratorSessionChatMessageEnvelope {
  return {
    type: "session:message",
    sessionId,
    message,
    cursor: createCursor(state),
  };
}

function broadcastMessageEnvelope(
  sessionId: string,
  state: SessionChatRuntimeState,
  message: NarratorSessionChatMessage,
  except?: SessionChatTransport,
): void {
  const envelope = createSessionChatMessageEnvelope(sessionId, state, message);
  const payload = serializeEnvelope(envelope);

  for (const transport of state.transports.keys()) {
    if (transport === except) {
      continue;
    }

    try {
      transport.send(payload);
    } catch {
      state.transports.delete(transport);
    }
  }
}

function broadcastStateEnvelope(
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  recovery?: NarratorSessionRecoveryEnvelope,
): void {
  for (const [transport, transportState] of state.transports.entries()) {
    const delivered = sendEnvelope(transport, createSessionChatStateEnvelope(session, state, transportState.ackedSeq, recovery));
    if (!delivered) {
      state.transports.delete(transport);
    }
  }
}

async function loadSessionState(sessionId: string): Promise<{ session: NarratorSessionRecord; state: SessionChatRuntimeState } | null> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return null;
  }

  const persistedCursor = await getSessionChatCursor(sessionId);
  const persistedHistory = await loadSessionChatHistory(sessionId);
  const sourceMessages = persistedHistory.length > 0 ? persistedHistory : session.recentMessages;
  const normalizedRecentMessages = normalizeSessionMessages(sourceMessages, Math.max(session.messageCount, persistedCursor.lastSeq));
  const normalizedMessageCount = Math.max(session.messageCount, persistedCursor.lastSeq, getLastSeq(normalizedRecentMessages), normalizedRecentMessages.length);
  const state = getRuntimeState(
    sessionId,
    normalizedMessageCount,
    normalizedRecentMessages,
    persistedCursor.ackedSeq,
    persistedCursor.availableFromSeq,
    persistedCursor.recoveryJson,
  );

  if (state.messages.length === 0 && normalizedRecentMessages.length > 0) {
    state.messages = [...normalizedRecentMessages];
  }

  trimSessionMessages(state);
  state.messageCount = Math.max(state.messageCount, normalizedMessageCount, getLastSeq(state.messages));
  state.nextSeq = Math.max(state.nextSeq, state.messageCount + 1, getLastSeq(state.messages) + 1);

  return { session, state };
}

function normalizeMessageText(raw: RawData | string | ArrayBuffer | ArrayBufferView | Blob | unknown): Promise<string | null> | string | null {
  if (typeof raw === "string") {
    return raw;
  }

  if (typeof Blob !== "undefined" && raw instanceof Blob) {
    return raw.text();
  }

  if (raw instanceof Uint8Array) {
    return new TextDecoder().decode(raw);
  }

  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(raw));
  }

  if (ArrayBuffer.isView(raw)) {
    return new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  }

  if (typeof raw === "object" && raw !== null && "toString" in raw) {
    return String(raw);
  }

  return null;
}

function parseClientMessage(text: string): NarratorSessionChatClientMessage {
  try {
    const parsed = JSON.parse(text) as Partial<NarratorSessionChatClientMessage> | string;
    if (typeof parsed === "string") {
      return { content: parsed };
    }
    if (parsed?.type === "session:ack") {
      return {
        type: "session:ack",
        sessionId: parsed.sessionId,
        ack: sanitizeSeq((parsed as { ack?: unknown }).ack),
      };
    }
    if (parsed && typeof (parsed as { content?: unknown }).content === "string") {
      return {
        ...(parsed as Record<string, unknown>),
        content: (parsed as { content: string }).content,
        ack: sanitizeSeq((parsed as { ack?: unknown }).ack),
      } as NarratorSessionChatClientMessage;
    }
  } catch {
    // Treat raw text as a chat message payload.
  }

  return { content: text };
}

function sanitizeCanvasContext(value: unknown): CanvasContext | undefined {
  if (!isRecord(value)) return undefined;
  const activeTabId = sanitizeOptionalString(value.activeTabId);
  const activeResource = sanitizeWorkspaceResourceRef(value.activeResource);
  const selection = sanitizeCanvasSelection(value.selection);
  const dirty = typeof value.dirty === "boolean" ? value.dirty : undefined;
  const openTabs = Array.isArray(value.openTabs)
    ? value.openTabs.map(sanitizeOpenResourceTab).filter((tab): tab is OpenResourceTab => Boolean(tab))
    : undefined;

  if (!activeTabId && !activeResource && !selection && dirty === undefined && !openTabs?.length) return undefined;
  return {
    ...(activeTabId ? { activeTabId } : {}),
    ...(activeResource ? { activeResource } : {}),
    ...(selection ? { selection } : {}),
    ...(dirty !== undefined ? { dirty } : {}),
    ...(openTabs?.length ? { openTabs } : {}),
  };
}

function sanitizeWorkspaceResourceRef(value: unknown): WorkspaceResourceRef | undefined {
  if (!isRecord(value)) return undefined;
  const kind = sanitizeOptionalString(value.kind);
  const id = sanitizeOptionalString(value.id);
  if (!kind || !id) return undefined;
  const bookId = sanitizeOptionalString(value.bookId);
  const title = sanitizeOptionalString(value.title);
  const path = sanitizeOptionalString(value.path);
  return {
    kind,
    id,
    ...(bookId ? { bookId } : {}),
    ...(title ? { title } : {}),
    ...(path ? { path } : {}),
  };
}

function sanitizeCanvasSelection(value: unknown): CanvasContext["selection"] | undefined {
  if (!isRecord(value)) return undefined;
  const text = sanitizeOptionalString(value.text);
  const start = sanitizeOptionalNumber(value.start);
  const end = sanitizeOptionalNumber(value.end);
  if (!text && start === undefined && end === undefined) return undefined;
  return {
    ...(text ? { text } : {}),
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  };
}

function sanitizeOpenResourceTab(value: unknown): OpenResourceTab | undefined {
  if (!isRecord(value)) return undefined;
  const id = sanitizeOptionalString(value.id);
  const nodeId = sanitizeOptionalString(value.nodeId);
  const kind = sanitizeOptionalString(value.kind);
  const title = sanitizeOptionalString(value.title);
  if (!id || !nodeId || !kind || !title) return undefined;
  const dirty = typeof value.dirty === "boolean" ? value.dirty : false;
  const source = value.source === "agent" ? "agent" : "user";
  const payloadRef = sanitizeOptionalString(value.payloadRef);
  return {
    id,
    nodeId,
    kind: kind as OpenResourceTab["kind"],
    title,
    dirty,
    source,
    ...(payloadRef ? { payloadRef } : {}),
  };
}

function sanitizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createSessionChatError(
  sessionId: string,
  error: string,
  details: Partial<Omit<NarratorSessionChatErrorEnvelope, "type" | "sessionId" | "error">> = {},
): NarratorSessionChatErrorEnvelope {
  return {
    type: "session:error",
    sessionId,
    error,
    ...details,
  };
}

function appendMessageToState(
  state: SessionChatRuntimeState,
  message: Omit<NarratorSessionChatMessage, "seq">,
): NarratorSessionChatMessage {
  const nextMessage: NarratorSessionChatMessage = {
    ...message,
    seq: state.nextSeq,
  };

  state.nextSeq += 1;
  state.messages.push(nextMessage);
  state.messageCount = Math.max(state.messageCount, nextMessage.seq ?? 0);
  trimSessionMessages(state);
  return nextMessage;
}

function updateTransportAck(
  state: SessionChatRuntimeState,
  transport: SessionChatTransport,
  ackCandidate: number,
): SessionChatTransportState | null {
  const transportState = state.transports.get(transport);
  if (!transportState) {
    return null;
  }

  transportState.ackedSeq = Math.max(transportState.ackedSeq, Math.min(sanitizeSeq(ackCandidate), createCursor(state).lastSeq));
  return transportState;
}

async function persistSessionChatProgress(
  sessionId: string,
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  messages: NarratorSessionChatMessage[],
  failure?: NarratorSessionRecoveryMetadata["lastFailure"],
): Promise<NarratorSessionRecord | null> {
  const persistedHistory = await appendSessionChatHistory(
    sessionId,
    messages,
    session.recentMessages ?? state.messages,
  );

  if (persistedHistory.length > 0) {
    state.messageCount = Math.max(state.messageCount, getLastSeq(persistedHistory));
    state.nextSeq = Math.max(state.nextSeq, state.messageCount + 1);
    state.availableFromSeq = persistedHistory[0]?.seq ?? state.availableFromSeq;
  }

  const recovery = buildRecoveryMetadata(state, state.messages, failure);
  state.recoveryJson = serializeRecoveryMetadata(recovery);
  await updateSessionChatRecoveryJson(sessionId, state.recoveryJson);
  return updateSession(sessionId, {
    messageCount: state.messageCount,
    recentMessages: [...state.messages],
    recovery,
  });
}

function normalizeRuntimeToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { rawInput: value };
    }
  }

  return {};
}

function isPendingConfirmationResult(result: SessionToolExecutionResult): boolean {
  return result.ok && (
    Boolean(result.confirmation)
    || (
      result.data !== null
      && typeof result.data === "object"
      && (result.data as { status?: unknown }).status === "pending-confirmation"
    )
  );
}

function buildToolResultStatus(result: SessionToolExecutionResult): ToolCall["status"] {
  if (isPendingConfirmationResult(result)) {
    return "pending";
  }
  return result.ok ? "success" : "error";
}

function buildToolResultMetadata(result: SessionToolExecutionResult): NarratorSessionChatMessage["metadata"] {
  return {
    ...(result.renderer ? { renderer: result.renderer } : {}),
    ...(result.artifact ? { artifact: result.artifact } : {}),
    ...(result.confirmation ? { confirmation: result.confirmation } : {}),
    ...(result.confirmationAudit ? { confirmationAudit: result.confirmationAudit } : {}),
    ...(result.guided ? { guided: result.guided } : {}),
    ...(result.pgi ? { pgi: result.pgi } : {}),
    ...(result.narrative ? { narrative: result.narrative } : {}),
    toolResult: result,
  };
}

function buildToolResultCall(
  toolUse: NormalizedRuntimeToolUse,
  result: SessionToolExecutionResult,
): ToolCall {
  const status = buildToolResultStatus(result);
  return {
    id: toolUse.id,
    toolName: toolUse.toolName,
    status,
    summary: result.summary,
    input: toolUse.input,
    duration: result.durationMs,
    result,
    ...(result.renderer ? { renderer: result.renderer } : {}),
    ...(result.artifact ? { artifact: result.artifact } : {}),
    ...(result.confirmation ? { confirmation: result.confirmation } : {}),
    ...(result.guided ? { guided: result.guided } : {}),
    ...(result.pgi ? { pgi: result.pgi } : {}),
    ...(result.narrative ? { narrative: result.narrative } : {}),
    ...(!result.ok && result.error ? { error: result.error } : {}),
  };
}

function extractPendingToolConfirmations(sessionId: string, messages: readonly NarratorSessionChatMessage[]): PendingSessionToolConfirmation[] {
  return messages.flatMap((message) => (message.toolCalls ?? []).flatMap((toolCall) => {
    const confirmation = toolCall.confirmation ?? message.metadata?.confirmation;
    if (!confirmation || toolCall.status !== "pending") {
      return [];
    }

    return [{
      ...confirmation,
      sessionId,
      messageId: message.id,
      toolUseId: toolCall.id,
      toolName: confirmation.toolName || toolCall.toolName,
      input: normalizeRuntimeToolInput(toolCall.input),
      status: "pending" as const,
    }];
  }));
}

type PendingConfirmationMatch = {
  readonly message: NarratorSessionChatMessage;
  readonly toolCall: ToolCall;
  readonly confirmation: PendingSessionToolConfirmation;
};

function findPendingToolConfirmation(
  sessionId: string,
  messages: NarratorSessionChatMessage[],
  toolName: string,
  confirmationId?: string,
): PendingConfirmationMatch | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]!;
    for (const toolCall of message.toolCalls ?? []) {
      const confirmation = toolCall.confirmation ?? message.metadata?.confirmation;
      if (!confirmation || toolCall.status !== "pending") {
        continue;
      }
      if ((confirmation.toolName || toolCall.toolName) !== toolName) {
        continue;
      }
      if (confirmationId && confirmation.id !== confirmationId) {
        continue;
      }

      return {
        message,
        toolCall,
        confirmation: {
          ...confirmation,
          sessionId,
          messageId: message.id,
          toolUseId: toolCall.id,
          toolName: confirmation.toolName || toolCall.toolName,
          input: normalizeRuntimeToolInput(toolCall.input),
          status: "pending",
        },
      };
    }
  }

  return null;
}

function normalizeConfirmationDecision(input: ConfirmSessionToolDecisionInput): "approved" | "rejected" | null {
  const rawDecision = input.decision ?? input.action;
  if (rawDecision === "approve" || rawDecision === "approved") {
    return "approved";
  }
  if (rawDecision === "reject" || rawDecision === "rejected") {
    return "rejected";
  }
  return null;
}

function buildSessionConfirmationAudit(
  confirmation: PendingSessionToolConfirmation,
  decision: ToolConfirmationDecision,
  summary: string,
): ToolConfirmationAudit {
  return {
    confirmationId: confirmation.id,
    sessionId: decision.sessionId,
    toolName: confirmation.toolName,
    targetResources: confirmation.targetResource ? [confirmation.targetResource] : [{ kind: confirmation.toolName, id: confirmation.target, ...(typeof confirmation.target === "string" ? { bookId: confirmation.target } : {}) }],
    summary,
    risk: confirmation.risk,
    decision: decision.decision,
    decidedAt: decision.decidedAt,
    ...(decision.reason ? { reason: decision.reason } : {}),
  };
}

function withSessionConfirmationAudit(
  result: SessionToolExecutionResult,
  confirmation: PendingSessionToolConfirmation,
  decision: ToolConfirmationDecision,
): SessionToolExecutionResult {
  return {
    ...result,
    confirmationAudit: buildSessionConfirmationAudit(confirmation, decision, result.summary),
  };
}

function createRejectedToolResult(
  toolName: string,
  confirmation: PendingSessionToolConfirmation,
  decision: ToolConfirmationDecision,
): SessionToolExecutionResult {
  const reasonSuffix = decision.reason ? `：${decision.reason}` : "";
  const result: SessionToolExecutionResult = {
    ok: false,
    error: "confirmation-rejected",
    summary: `用户已拒绝执行 ${toolName}${reasonSuffix}`,
    data: { status: "rejected", decision },
    confirmation,
  };
  return withSessionConfirmationAudit(result, confirmation, decision);
}

function resolvePendingToolCall(
  match: PendingConfirmationMatch,
  result: SessionToolExecutionResult,
): void {
  const nextCall = buildToolResultCall({
    id: match.toolCall.id ?? match.confirmation.id,
    toolName: match.confirmation.toolName,
    input: match.confirmation.input,
  }, result);
  match.message.toolCalls = (match.message.toolCalls ?? []).map((toolCall) => (
    toolCall === match.toolCall || (toolCall.id && toolCall.id === match.toolCall.id)
      ? { ...toolCall, ...nextCall, confirmation: match.confirmation }
      : toolCall
  ));
}

async function appendModelContinuationAfterToolDecision(
  loaded: { session: NarratorSessionRecord; state: SessionChatRuntimeState },
  timestamp: number,
): Promise<NarratorSessionRecoveryMetadata["lastFailure"] | undefined> {
  try {
    const agentSystemPrompt = getAgentSystemPrompt(loaded.session.agentId);
    const projectId = (loaded.session as { projectId?: string }).projectId;
    let bookContext = "";
    if (projectId) {
      try {
        bookContext = await buildAgentContext({ bookId: projectId });
      } catch { /* context build failure is non-fatal */ }
    }
    const canvasContext = latestCanvasContextFromMessages(loaded.state.messages);
    const maxSteps = await resolveMaxTurnSteps();
    const compactedMessages = microCompact(sessionMessagesToTurnItems(loaded.state.messages));
    const runtimeEvents = await runAgentTurn({
      sessionId: loaded.session.id,
      sessionConfig: loaded.session.sessionConfig,
      messages: compactedMessages,
      systemPrompt: `${agentSystemPrompt}${AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS}`,
      context: createRuntimeContext(bookContext, canvasContext),
      tools: getEnabledSessionTools(loaded.session.sessionConfig.permissionMode),
      permissionMode: loaded.session.sessionConfig.permissionMode,
      ...(canvasContext ? { canvasContext } : {}),
      maxSteps,
      shouldContinueAfterToolResult,
      generate: async (generateInput): Promise<AgentGenerateResult> => {
        const result = await generateSessionReply({
          sessionConfig: generateInput.sessionConfig,
          messages: generateInput.messages,
          tools: generateInput.tools,
        });
        return result as AgentGenerateResult;
      },
      executeTool: (toolInput) => sessionToolExecutor.execute(toolInput),
    });

    const toolInputsById = new Map<string, Record<string, unknown>>();
    let nextTimestamp = timestamp;
    let assistantIndex = 0;
    for (const event of runtimeEvents) {
      if (event.type === "assistant_message") {
        const assistantMessage = appendMessageToState(loaded.state, {
          id: assistantIndex === 0 ? `confirmation-continuation-${timestamp}` : `confirmation-continuation-${timestamp}-${assistantIndex + 1}`,
          role: "assistant",
          content: event.content,
          timestamp: nextTimestamp,
          runtime: event.runtime,
        });
        assistantIndex += 1;
        nextTimestamp += 1;
        broadcastMessageEnvelope(loaded.session.id, loaded.state, assistantMessage);
        continue;
      }

      if (event.type === "tool_call") {
        toolInputsById.set(event.id, event.input);
        const toolUseMessage = appendMessageToState(loaded.state, {
          id: `confirmation-tool-use-${event.id}-${nextTimestamp}`,
          role: "assistant",
          content: `请求调用工具 ${event.toolName}。`,
          timestamp: nextTimestamp,
          runtime: event.runtime,
          toolCalls: [{ id: event.id, toolName: event.toolName, input: event.input }],
        });
        nextTimestamp += 1;
        broadcastMessageEnvelope(loaded.session.id, loaded.state, toolUseMessage);
        continue;
      }

      if (event.type === "tool_result") {
        const toolUse = {
          id: event.id,
          toolName: event.toolName,
          input: toolInputsById.get(event.id) ?? {},
        };
        const toolResultMessage = appendMessageToState(loaded.state, {
          id: `confirmation-tool-result-${event.id}-${nextTimestamp}`,
          role: "assistant",
          content: event.result.summary,
          timestamp: nextTimestamp,
          runtime: event.runtime,
          toolCalls: [buildToolResultCall(toolUse, event.result)],
          metadata: buildToolResultMetadata(event.result),
        });
        nextTimestamp += 1;
        broadcastMessageEnvelope(loaded.session.id, loaded.state, toolResultMessage);
        continue;
      }

      if (event.type === "confirmation_required" || event.type === "turn_completed") {
        continue;
      }

      if (event.type === "turn_failed") {
        return { reason: event.reason, message: event.message, at: new Date().toISOString() };
      }
    }
    return undefined;
  } catch (error) {
    return {
      reason: "provider-unavailable",
      message: error instanceof Error ? error.message : "LLM runtime request failed",
      at: new Date().toISOString(),
    };
  }
}

async function persistMergedSessionChatProgress(
  sessionId: string,
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  failure?: NarratorSessionRecoveryMetadata["lastFailure"],
): Promise<NarratorSessionRecord | null> {
  trimSessionMessages(state);
  const persistedHistory = await loadSessionChatHistory(sessionId);
  const recentById = new Map(state.messages.map((message) => [message.id, message]));
  const merged = persistedHistory.length > 0
    ? persistedHistory.map((message) => recentById.get(message.id) ?? message)
    : [];
  const mergedIds = new Set(merged.map((message) => message.id));
  for (const message of state.messages) {
    if (!mergedIds.has(message.id)) {
      merged.push(message);
      mergedIds.add(message.id);
    }
  }
  merged.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));

  await saveSessionChatHistory(sessionId, merged);
  state.availableFromSeq = merged[0]?.seq ?? state.messages[0]?.seq ?? state.availableFromSeq;
  const recovery = buildRecoveryMetadata(state, state.messages, failure);
  state.recoveryJson = serializeRecoveryMetadata(recovery);
  await updateSessionChatRecoveryJson(sessionId, state.recoveryJson);
  return updateSession(sessionId, {
    messageCount: state.messageCount,
    recentMessages: [...state.messages],
    recovery,
  });
}

export async function getSessionToolState(sessionId: string): Promise<SessionToolState | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  return {
    sessionId,
    tools: getEnabledSessionTools(loaded.session.sessionConfig.permissionMode),
    pendingConfirmations: extractPendingToolConfirmations(sessionId, loaded.state.messages),
  };
}

export async function confirmSessionToolDecision(
  sessionId: string,
  toolName: string,
  input: ConfirmSessionToolDecisionInput,
): Promise<ConfirmSessionToolDecisionResult> {
  const normalizedDecision = normalizeConfirmationDecision(input);
  if (!normalizedDecision) {
    return { ok: false, status: 400, error: "Invalid confirmation decision" };
  }

  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return { ok: false, status: 404, error: "Session not found" };
  }

  const match = findPendingToolConfirmation(sessionId, loaded.state.messages, toolName, input.confirmationId);
  if (!match) {
    return { ok: false, status: 404, error: "Pending confirmation not found" };
  }

  const decision: ToolConfirmationDecision = {
    confirmationId: match.confirmation.id,
    decision: normalizedDecision,
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    decidedAt: new Date().toISOString(),
    sessionId,
  };
  const rawToolResult = normalizedDecision === "approved"
    ? await sessionToolExecutor.execute({
      sessionId,
      toolName,
      input: match.confirmation.input,
      permissionMode: loaded.session.sessionConfig.permissionMode,
      sessionConfig: loaded.session.sessionConfig,
      confirmationDecision: decision,
    })
    : createRejectedToolResult(toolName, match.confirmation, decision);
  const toolResult = withSessionConfirmationAudit(rawToolResult, match.confirmation, decision);

  resolvePendingToolCall(match, toolResult);
  match.message.metadata = {
    ...match.message.metadata,
    confirmation: match.confirmation,
    confirmationDecision: decision,
    ...(toolResult.confirmationAudit ? { confirmationAudit: toolResult.confirmationAudit } : {}),
  };

  const timestamp = Date.now();
  const resultMessage = appendMessageToState(loaded.state, {
    id: `confirmation-result-${match.confirmation.id}-${timestamp}`,
    role: "assistant",
    content: toolResult.summary,
    timestamp,
    runtime: match.message.runtime,
    toolCalls: [buildToolResultCall({
      id: match.confirmation.toolUseId ?? match.confirmation.id,
      toolName,
      input: match.confirmation.input,
    }, toolResult)],
    metadata: {
      ...buildToolResultMetadata(toolResult),
      confirmation: match.confirmation,
      confirmationDecision: decision,
    },
  });
  broadcastMessageEnvelope(sessionId, loaded.state, resultMessage);
  const failure = await appendModelContinuationAfterToolDecision(loaded, timestamp + 1);
  const updatedSession = await persistMergedSessionChatProgress(sessionId, loaded.session, loaded.state, failure);
  const serverFirstSession = buildServerFirstSession(updatedSession ?? loaded.session, loaded.state);
  broadcastStateEnvelope(serverFirstSession, loaded.state);

  return {
    ok: true,
    decision,
    toolResult,
    snapshot: {
      session: serverFirstSession,
      messages: [...loaded.state.messages],
      cursor: createCursor(loaded.state),
    },
  };
}

export async function getSessionChatSnapshot(sessionId: string): Promise<NarratorSessionChatSnapshot | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  return {
    session: buildServerFirstSession(loaded.session, loaded.state),
    messages: [...loaded.state.messages],
    cursor: createCursor(loaded.state),
  };
}

export async function getSessionChatHistory(sessionId: string, sinceSeq = 0): Promise<NarratorSessionChatHistory | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  const normalizedSinceSeq = Math.max(0, sanitizeSeq(sinceSeq));
  const persistedHistory = await loadSessionChatHistory(sessionId);
  const sourceMessages = persistedHistory.length > 0 ? persistedHistory : loaded.state.messages;
  const availableFromSeq = sourceMessages[0]?.seq ?? 0;
  const cursor = createCursor(loaded.state);
  const resetRequired = normalizedSinceSeq > 0 && (
    (availableFromSeq > 0 && normalizedSinceSeq < availableFromSeq - 1)
    || normalizedSinceSeq > cursor.lastSeq
  );

  return {
    sessionId,
    sinceSeq: normalizedSinceSeq,
    availableFromSeq,
    resetRequired,
    messages: resetRequired ? [] : sourceMessages.filter((message) => (message.seq ?? 0) > normalizedSinceSeq),
    cursor,
  };
}

export async function replaceSessionChatState(
  sessionId: string,
  nextMessages: NarratorSessionChatMessage[],
): Promise<NarratorSessionChatSnapshot | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  const normalizedMessages = normalizeSessionMessages(nextMessages, Array.isArray(nextMessages) ? nextMessages.length : 0).slice(-MAX_SESSION_MESSAGES);
  loaded.state.messages = normalizedMessages;
  loaded.state.messageCount = Math.max(normalizedMessages.length, getLastSeq(normalizedMessages));
  loaded.state.nextSeq = loaded.state.messageCount + 1;
  loaded.state.persistedAckedSeq = 0;
  loaded.state.availableFromSeq = normalizedMessages[0]?.seq ?? 0;

  for (const transportState of loaded.state.transports.values()) {
    transportState.ackedSeq = 0;
  }

  await saveSessionChatHistory(sessionId, normalizedMessages);
  const recovery = buildRecoveryMetadata(loaded.state, normalizedMessages);
  loaded.state.recoveryJson = serializeRecoveryMetadata(recovery);
  await updateSessionChatRecoveryJson(sessionId, loaded.state.recoveryJson);
  const updatedSession = await updateSession(sessionId, {
    messageCount: loaded.state.messageCount,
    recentMessages: [...normalizedMessages],
    recovery,
  });
  const serverFirstSession = buildServerFirstSession(updatedSession ?? loaded.session, loaded.state);
  const snapshot: NarratorSessionChatSnapshot = {
    session: serverFirstSession,
    messages: [...loaded.state.messages],
    cursor: createCursor(loaded.state),
  };

  for (const transport of loaded.state.transports.keys()) {
    const transportState = loaded.state.transports.get(transport);
    sendEnvelope(
      transport,
      createSessionChatStateEnvelope(serverFirstSession, loaded.state, transportState?.ackedSeq ?? 0, {
        state: "resetting",
        reason: "server-reset",
      }),
    );
    sendEnvelope(transport, {
      type: "session:snapshot",
      snapshot,
      recovery: {
        state: "idle",
        reason: "server-reset",
      },
    });
  }
  return snapshot;
}

export async function attachSessionChatTransport(
  sessionId: string,
  transport: SessionChatTransport,
  options: AttachSessionChatTransportOptions = {},
): Promise<boolean> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Session not found"));
    transport.close(1008, "Session not found");
    return false;
  }

  const session = buildServerFirstSession(loaded.session, loaded.state);
  const hasExplicitResume = options.resumeFromSeq !== undefined;
  const requestedResumeSeq = hasExplicitResume ? sanitizeSeq(options.resumeFromSeq) : loaded.state.persistedAckedSeq;
  const cursor = createCursor(loaded.state);
  const resumeOutOfRange = requestedResumeSeq > cursor.lastSeq;
  const ackedSeq = Math.min(requestedResumeSeq, cursor.lastSeq);
  loaded.state.transports.set(transport, {
    ackedSeq,
  });

  if (!hasExplicitResume || ackedSeq === 0) {
    sendEnvelope(transport, {
      type: "session:snapshot",
      snapshot: {
        session,
        messages: [...loaded.state.messages],
        cursor: createCursor(loaded.state, ackedSeq),
      },
      recovery: {
        state: hasExplicitResume && ackedSeq === 0 ? "recovering" : "idle",
        reason: hasExplicitResume ? "reconnect" : "initial-hydration",
      },
    });
  }

  console.log(JSON.stringify({
    component: "session.recovery",
    ok: true,
    sessionId,
    route: "/api/sessions/:id/chat",
    requestedResumeSeq,
    ackedSeq,
    lastSeq: cursor.lastSeq,
    pendingMessageCount: session.recovery?.pendingMessageCount ?? 0,
    recoveryState: resumeOutOfRange ? "resetting" : "idle",
  }));

  sendEnvelope(
    transport,
    createSessionChatStateEnvelope(
      session,
      loaded.state,
      ackedSeq,
      resumeOutOfRange ? { state: "resetting", reason: "history-gap" } : undefined,
    ),
  );
  return true;
}

export function detachSessionChatTransport(sessionId: string, transport: SessionChatTransport): void {
  const state = runtimeStateBySessionId.get(sessionId);
  if (!state) {
    return;
  }

  state.transports.delete(transport);
  if (state.transports.size === 0 && state.messages.length === 0) {
    runtimeStateBySessionId.delete(sessionId);
  }
}

const SESSION_TOOL_RESULT_CONTINUATION_INSTRUCTION = "工具已完成。请先总结已经获得的信息，判断是否足够进入下一步。如果信息足够，请继续执行下一步；不要重复读取同一资源。";

function formatSessionToolResultContent(result: SessionToolExecutionResult): string {
  return result.summary ? `${result.summary}\n\n${SESSION_TOOL_RESULT_CONTINUATION_INSTRUCTION}` : SESSION_TOOL_RESULT_CONTINUATION_INSTRUCTION;
}

function extractMessageToolResult(message: NarratorSessionChatMessage): SessionToolExecutionResult | undefined {
  const toolResult = message.metadata?.toolResult;
  if (!isRecord(toolResult) || typeof toolResult.ok !== "boolean" || typeof toolResult.summary !== "string") {
    return undefined;
  }
  return toolResult as unknown as SessionToolExecutionResult;
}

function sessionMessagesToTurnItems(messages: readonly NarratorSessionChatMessage[]): AgentTurnItem[] {
  const latestResultIndexByToolCallId = new Map<string, number>();
  messages.forEach((message, index) => {
    if (!extractMessageToolResult(message)) return;
    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.id) latestResultIndexByToolCallId.set(toolCall.id, index);
    }
  });

  return messages.flatMap((message, messageIndex): AgentTurnItem[] => {
    if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
      return [];
    }

    const toolCalls = message.toolCalls ?? [];
    if (toolCalls.length > 0) {
      const toolResult = extractMessageToolResult(message);
      if (toolResult) {
        return toolCalls.flatMap((toolCall): AgentTurnItem[] => {
          if (!toolCall.id || latestResultIndexByToolCallId.get(toolCall.id) !== messageIndex) return [];
          return [{
            type: "tool_result",
            toolCallId: toolCall.id,
            name: toolCall.toolName,
            content: formatSessionToolResultContent(toolResult),
            ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
            metadata: { toolResult },
          }];
        });
      }

      return toolCalls.flatMap((toolCall): AgentTurnItem[] => {
        if (!toolCall.id) return [];
        return [{
          type: "tool_call",
          id: toolCall.id,
          name: toolCall.toolName,
          input: normalizeRuntimeToolInput(toolCall.input),
        }];
      });
    }

    if (!message.content.trim()) return [];
    return [{
      type: "message",
      id: message.id,
      role: message.role,
      content: message.content,
      ...(message.metadata ? { metadata: message.metadata } : {}),
    }];
  });
}

function createRuntimeContext(bookContext: string, canvasContext?: CanvasContext): string {
  const parts = [bookContext.trim(), canvasContext ? formatCanvasContextForPrompt(canvasContext) : ""].filter(Boolean);
  return parts.join("\n\n");
}

export async function handleSessionChatTransportMessage(
  sessionId: string,
  transport: SessionChatTransport,
  rawMessage: RawData | string | ArrayBuffer | ArrayBufferView | Blob | unknown,
): Promise<void> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Session not found"));
    transport.close(1008, "Session not found");
    return;
  }

  const text = await normalizeMessageText(rawMessage);
  if (!text) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Empty message payload"));
    return;
  }

  const payload = parseClientMessage(text);
  const canvasContext = sanitizeCanvasContext("canvasContext" in payload ? payload.canvasContext : undefined);
  const transportState = loaded.state.transports.get(transport);

  if ("ack" in payload && sanitizeSeq(payload.ack) > 0 && transportState) {
    const updatedTransportState = updateTransportAck(loaded.state, transport, sanitizeSeq(payload.ack));
    if (updatedTransportState) {
      loaded.state.persistedAckedSeq = Math.max(loaded.state.persistedAckedSeq, updatedTransportState.ackedSeq);
      const recovery = buildRecoveryMetadata(loaded.state, loaded.state.messages);
      loaded.state.recoveryJson = serializeRecoveryMetadata(recovery);
      await updateSessionChatAckedSeq(sessionId, loaded.state.persistedAckedSeq, loaded.state.recoveryJson);
      await updateSession(sessionId, { recovery });
    }
  }

  if (payload.type === "session:ack") {
    const session = buildServerFirstSession(loaded.session, loaded.state);
    sendEnvelope(transport, createSessionChatStateEnvelope(session, loaded.state, transportState?.ackedSeq ?? loaded.state.persistedAckedSeq));
    return;
  }

  const content = payload.content.trim();
  if (!content) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Empty message payload"));
    return;
  }

  const timestamp = Date.now();
  const userMessage = appendMessageToState(loaded.state, {
    id: payload.messageId?.trim() || `session-msg-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content,
    timestamp,
    ...(canvasContext ? { metadata: { canvasContext } } : {}),
  });
  broadcastMessageEnvelope(sessionId, loaded.state, userMessage);

  const messagesToPersist: NarratorSessionChatMessage[] = [userMessage];
  const sessionTools = getEnabledSessionTools(loaded.session.sessionConfig.permissionMode);
  let failure: NarratorSessionRecoveryMetadata["lastFailure"] | undefined;
  let errorEnvelope: NarratorSessionChatErrorEnvelope | undefined;

  try {
    const agentSystemPrompt = getAgentSystemPrompt(loaded.session.agentId);
    const projectId = (loaded.session as { projectId?: string }).projectId;
    let bookContext = "";
    if (projectId) {
      try {
        bookContext = await buildAgentContext({ bookId: projectId });
      } catch { /* context build failure is non-fatal */ }
    }

    const fullSystemPrompt = `${agentSystemPrompt}${AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS}`;
    const maxSteps = await resolveMaxTurnSteps();
    const compactedMessages = microCompact(sessionMessagesToTurnItems(loaded.state.messages));
    const runtimeEvents = await runAgentTurn({
      sessionId,
      sessionConfig: loaded.session.sessionConfig,
      messages: compactedMessages,
      systemPrompt: fullSystemPrompt,
      context: createRuntimeContext(bookContext, canvasContext),
      tools: sessionTools,
      permissionMode: loaded.session.sessionConfig.permissionMode,
      ...(canvasContext ? { canvasContext } : {}),
      maxSteps,
      shouldContinueAfterToolResult,
      generate: async (generateInput): Promise<AgentGenerateResult> => {
        const result = await generateSessionReply({
          sessionConfig: generateInput.sessionConfig,
          messages: generateInput.messages,
          tools: generateInput.tools,
        });
        return result as AgentGenerateResult;
      },
      executeTool: (toolInput) => sessionToolExecutor.execute(toolInput),
    });

    const toolInputsById = new Map<string, Record<string, unknown>>();
    let assistantIndex = 0;
    for (const event of runtimeEvents) {
      if (event.type === "assistant_message") {
        const assistantMessage = appendMessageToState(loaded.state, {
          id: assistantIndex === 0 ? `${userMessage.id}-assistant` : `${userMessage.id}-assistant-${assistantIndex + 1}`,
          role: "assistant",
          content: event.content,
          timestamp: timestamp + messagesToPersist.length,
          runtime: event.runtime,
        });
        assistantIndex += 1;
        messagesToPersist.push(assistantMessage);
        broadcastMessageEnvelope(sessionId, loaded.state, assistantMessage);
        continue;
      }

      if (event.type === "tool_call") {
        toolInputsById.set(event.id, event.input);
        const toolUseMessage = appendMessageToState(loaded.state, {
          id: `${userMessage.id}-tool-use-${event.id}`,
          role: "assistant",
          content: `请求调用工具 ${event.toolName}。`,
          timestamp: timestamp + messagesToPersist.length,
          runtime: event.runtime,
          toolCalls: [
            {
              id: event.id,
              toolName: event.toolName,
              input: event.input,
            },
          ],
        });
        messagesToPersist.push(toolUseMessage);
        broadcastMessageEnvelope(sessionId, loaded.state, toolUseMessage);
        continue;
      }

      if (event.type === "tool_result") {
        const toolUse = {
          id: event.id,
          toolName: event.toolName,
          input: toolInputsById.get(event.id) ?? {},
        };
        const toolResultMessage = appendMessageToState(loaded.state, {
          id: `${userMessage.id}-tool-result-${event.id}`,
          role: "assistant",
          content: event.result.summary,
          timestamp: timestamp + messagesToPersist.length,
          runtime: event.runtime,
          toolCalls: [buildToolResultCall(toolUse, event.result)],
          metadata: buildToolResultMetadata(event.result),
        });
        messagesToPersist.push(toolResultMessage);
        broadcastMessageEnvelope(sessionId, loaded.state, toolResultMessage);
        continue;
      }

      if (event.type === "confirmation_required") {
        continue;
      }

      if (event.type === "turn_failed") {
        failure = {
          reason: event.reason,
          message: event.message,
          at: new Date().toISOString(),
        };

        if (event.reason === "model-unavailable" || event.reason === "provider-unavailable" || event.reason === "unsupported-tools") {
          const metadata = event.data?.metadata as Partial<LlmRuntimeMetadata> | undefined;
          errorEnvelope = createSessionChatError(sessionId, event.message, {
            code: event.reason,
            ...(metadata ? { runtime: metadata } : {}),
          });
        } else {
          const assistantMessage = appendMessageToState(loaded.state, {
            id: `${userMessage.id}-${event.reason}`,
            role: "assistant",
            content: event.message,
            timestamp: timestamp + messagesToPersist.length,
            metadata: event.reason === "tool-loop-limit" ? {
              toolLoop: {
                error: "tool-loop-limit",
                maxSteps: event.data?.maxSteps,
              },
            } : undefined,
          });
          messagesToPersist.push(assistantMessage);
          broadcastMessageEnvelope(sessionId, loaded.state, assistantMessage);
        }
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM runtime request failed";
    failure = {
      reason: "provider-unavailable",
      message,
      at: new Date().toISOString(),
    };
    errorEnvelope = createSessionChatError(sessionId, message, {
      code: "provider-unavailable",
      runtime: {
        providerId: loaded.session.sessionConfig.providerId,
        modelId: loaded.session.sessionConfig.modelId,
      },
    });
  }

  const updatedSession = await persistSessionChatProgress(sessionId, loaded.session, loaded.state, messagesToPersist, failure);
  if (errorEnvelope) {
    sendEnvelope(transport, errorEnvelope);
  }

  if (updatedSession) {
    broadcastStateEnvelope(buildServerFirstSession(updatedSession, loaded.state), loaded.state);
  }

  // 自动命名：第一轮对话且标题为默认值时，异步生成标题
  const hasAssistantReply = messagesToPersist.some((m) => m.role === "assistant");
  const userMessageCount = loaded.state.messages.filter((m) => m.role === "user").length;
  const currentTitle = loaded.session.title;
  const needsAutoTitle = hasAssistantReply
    && userMessageCount <= 1
    && (currentTitle === "Untitled Session" || currentTitle.startsWith("Headless:"));
  if (needsAutoTitle) {
    void generateSessionTitle(loaded.state.messages).then((title) => {
      if (title && title !== "Untitled Session") {
        void updateSession(sessionId, { title });
      }
    }).catch(() => { /* auto-title failure is non-fatal */ });
  }
}

const AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS = `

## Agent-native 写下一章链路
当用户请求「写下一章」「生成下一章」或 write next 时，必须按顺序推进：cockpit.get_snapshot → pgi.generate_questions → guided.enter/guided.exit → candidate.create_chapter。
- PGI 无问题时也要明确说明 skippedReason=no-questions，并继续形成 GuidedGenerationPlan。
- guided.exit 必须等待用户批准；拒绝后不得执行 candidate.create_chapter。
- 批准后才允许调用 candidate.create_chapter，结果只进入候选稿并通过 artifact 在中间画布打开。
- 任一步失败时停止后续写入，展示失败原因，并保留已完成的只读调查结果。`;

const SESSION_CHAT_WS_PATH = "/api/sessions/:id/chat";
const SESSION_CHAT_PATHNAME_REGEX = /^\/api\/sessions\/([^/]+)\/chat$/;

function parseSessionChatUrl(url: URL): { sessionId: string; resumeFromSeq: number | undefined } | null {
  const match = url.pathname.match(SESSION_CHAT_PATHNAME_REGEX);
  if (!match) return null;
  const sessionId = decodeURIComponent(match[1]!);
  const resumeFromSeq = sanitizeSeq(url.searchParams.get("resumeFromSeq"));
  return { sessionId, resumeFromSeq };
}

function isBunWebSocketRegistrar(server: StartedHttpServer): server is BunWebSocketRegistrar {
  return typeof server === "object" && server !== null && "runtime" in server && server.runtime === "bun";
}

function latestCanvasContextFromMessages(messages: readonly NarratorSessionChatMessage[]): CanvasContext | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const canvasContext = messages[index]?.metadata?.canvasContext;
    if (canvasContext) return canvasContext;
  }
  return undefined;
}

function formatCanvasContextForPrompt(canvasContext: CanvasContext): string {
  const lines = ["## 当前画布上下文"];
  if (canvasContext.activeTabId) lines.push(`- activeTabId: ${canvasContext.activeTabId}`);
  if (canvasContext.activeResource) {
    const resourceParts = [
      `kind=${canvasContext.activeResource.kind}`,
      `id=${canvasContext.activeResource.id}`,
      canvasContext.activeResource.bookId ? `bookId=${canvasContext.activeResource.bookId}` : null,
      canvasContext.activeResource.title ? `title=${canvasContext.activeResource.title}` : null,
      canvasContext.activeResource.path ? `path=${canvasContext.activeResource.path}` : null,
    ].filter((part): part is string => Boolean(part));
    lines.push(`- activeResource: ${resourceParts.join(", ")}`);
  }
  lines.push(`- dirty: ${canvasContext.dirty === true ? "true" : "false"}`);
  if (canvasContext.selection?.text) lines.push(`- selection: ${canvasContext.selection.text}`);
  if (canvasContext.openTabs?.length) {
    lines.push(`- openTabs: ${canvasContext.openTabs.map((tab) => `${tab.title}(${tab.kind}${tab.dirty ? ", dirty" : ""})`).join("；")}`);
  }
  lines.push("- 注意：dirty=true 表示作者有未保存编辑，任何写入类工具都必须先要求作者处理该资源；当前上下文不会包含未保存正文全文。");
  return lines.join("\n");
}

export function setupSessionChatWebSocket(server: StartedHttpServer): void {
  if (isBunWebSocketRegistrar(server)) {
    const sockets = new WeakMap<BunWebSocketConnection, SessionChatTransport>();

    server.registerWebSocketRoute({
      path: SESSION_CHAT_WS_PATH,
      matchPath(pathname) {
        return SESSION_CHAT_PATHNAME_REGEX.test(pathname);
      },
      upgrade(request, bunServer) {
        const url = new URL(request.url);
        const parsed = parseSessionChatUrl(url);
        if (!parsed) return false;
        return bunServer.upgrade(request, {
          data: {
            routePath: SESSION_CHAT_WS_PATH,
            sessionId: parsed.sessionId,
            resumeFromSeq: parsed.resumeFromSeq,
          },
        });
      },
      open(socket) {
        const data = socket.data ?? {};
        const sessionId = typeof data.sessionId === "string" ? data.sessionId : null;
        if (!sessionId) {
          socket.close(4000, "missing sessionId");
          return;
        }
        const resumeFromSeq = typeof data.resumeFromSeq === "number" ? data.resumeFromSeq : undefined;
        const transport: SessionChatTransport = {
          send: (payload: string) => socket.send(payload),
          close: (code?: number, reason?: string) => socket.close(code, reason),
        };
        sockets.set(socket, transport);
        void (async () => {
          const attached = await attachSessionChatTransport(sessionId, transport, { resumeFromSeq });
          if (!attached) {
            sockets.delete(socket);
          }
        })();
      },
      message(socket, message) {
        const transport = sockets.get(socket);
        if (!transport) return;
        const sessionId = typeof socket.data?.sessionId === "string" ? socket.data.sessionId : null;
        if (!sessionId) return;
        void handleSessionChatTransportMessage(sessionId, transport, message);
      },
      close(socket) {
        const transport = sockets.get(socket);
        sockets.delete(socket);
        const sessionId = typeof socket.data?.sessionId === "string" ? socket.data.sessionId : null;
        if (transport && sessionId) {
          detachSessionChatTransport(sessionId, transport);
        }
      },
      error(socket) {
        const transport = sockets.get(socket);
        sockets.delete(socket);
        const sessionId = typeof socket.data?.sessionId === "string" ? socket.data.sessionId : null;
        if (transport && sessionId) {
          detachSessionChatTransport(sessionId, transport);
        }
      },
    });

    return;
  }

  const httpServer = server as NodeHttpServer;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const parsed = parseSessionChatUrl(url);
    if (!parsed) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      void bindNodeSessionChatConnection(parsed.sessionId, ws, { resumeFromSeq: parsed.resumeFromSeq });
    });
  });
}

async function bindNodeSessionChatConnection(
  sessionId: string,
  ws: NodeWebSocket,
  options: AttachSessionChatTransportOptions,
): Promise<void> {
  const transport: SessionChatTransport = {
    send: (data: string) => ws.send(data),
    close: (code?: number, reason?: string) => ws.close(code, reason),
  };

  const attached = await attachSessionChatTransport(sessionId, transport, options);
  if (!attached) {
    return;
  }

  ws.on("message", (data) => {
    void handleSessionChatTransportMessage(sessionId, transport, data);
  });

  ws.on("close", () => {
    detachSessionChatTransport(sessionId, transport);
  });

  ws.on("error", () => {
    detachSessionChatTransport(sessionId, transport);
  });
}
