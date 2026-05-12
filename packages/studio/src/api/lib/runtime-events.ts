import { normalizeToolConfirmationRequest, type CanvasArtifact, type SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";
import type { NarratorSessionChatMessage, ToolCall, TokenUsage } from "../../shared/session-types.js";
import type { AgentTurnEvent } from "./agent-turn-runtime.js";
import type { HeadlessChatCostEnvelope, HeadlessChatStreamEvent, HeadlessChatUsageEnvelope } from "./session-headless-chat-service.js";

export const RUNTIME_EVENT_TYPES = [
  "message",
  "assistant_delta",
  "tool_use",
  "tool_result",
  "permission_request",
  "checkpoint",
  "candidate",
  "usage",
  "command_started",
  "command_completed",
  "command_error",
  "error",
  "result",
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export interface RuntimeEventContext {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly ephemeral?: boolean;
}

export type RuntimeMessageRole = "system" | "user" | "assistant";

export type RuntimeItem =
  | {
    readonly type: "message";
    readonly id?: string;
    readonly session_id: string;
    readonly role: RuntimeMessageRole;
    readonly content: string;
    readonly seq?: number;
    readonly timestamp?: number;
    readonly runtime?: unknown;
  }
  | {
    readonly type: "tool_result";
    readonly id?: string;
    readonly session_id: string;
    readonly tool_use_id?: string;
    readonly tool_name: string;
    readonly status?: ToolCall["status"];
    readonly input?: unknown;
    readonly result?: ToolCall["result"];
  };

export type RuntimeResultStopReason = "completed" | "pending_confirmation" | "failed" | "max_turns" | "max_budget";

export type RuntimeEvent =
  | {
    readonly type: "message";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly role: RuntimeMessageRole;
    readonly content: string;
    readonly runtime?: unknown;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "assistant_delta";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly delta: string;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "tool_use";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly tool_use_id: string;
    readonly tool_name: string;
    readonly input: Record<string, unknown>;
    readonly runtime?: unknown;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "tool_result";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly tool_use_id: string;
    readonly tool_name: string;
    readonly result: SessionToolExecutionResult;
    readonly runtime?: unknown;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "permission_request";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly confirmation_id: string;
    readonly tool_name: string;
    readonly confirmation?: unknown;
    readonly result: SessionToolExecutionResult;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "checkpoint";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly checkpoint_id: string;
    readonly paths: readonly string[];
    readonly source_tool_use_id?: string;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "candidate";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly candidate_id: string;
    readonly artifact: CanvasArtifact;
    readonly source_tool_use_id?: string;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "usage";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly usage: TokenUsage | HeadlessChatUsageEnvelope;
    readonly runtime?: unknown;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "command_started";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly command_id: string;
    readonly command_name: string;
    readonly raw: string;
    readonly args: string;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "command_completed";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly command_id: string;
    readonly command_name: string;
    readonly raw: string;
    readonly args: string;
    readonly result: unknown;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "command_error";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly command_id?: string;
    readonly command_name?: string;
    readonly raw: string;
    readonly args?: string;
    readonly code: string;
    readonly message: string;
    readonly ephemeral?: boolean;
  }
  | {
    readonly type: "error";
    readonly session_id: string;
    readonly turn_id?: string;
    readonly code: string;
    readonly message: string;
    readonly data?: unknown;
    readonly ephemeral?: boolean;
  }
  | RuntimeResultEvent;

export interface RuntimeResultEvent {
  readonly type: "result";
  readonly session_id: string;
  readonly turn_id?: string;
  readonly success: boolean;
  readonly stop_reason: RuntimeResultStopReason;
  readonly exit_code: number;
  readonly final_message?: string;
  readonly error?: string;
  readonly pending_confirmation?: { readonly id: string; readonly toolName: string };
  readonly duration_ms?: number;
  readonly usage?: HeadlessChatUsageEnvelope;
  readonly cost?: HeadlessChatCostEnvelope;
  readonly permission_denials?: readonly unknown[];
  readonly runtime_capabilities?: readonly unknown[];
  readonly ephemeral?: boolean;
}

function baseContext(context: RuntimeEventContext): Pick<RuntimeEvent, "session_id" | "turn_id" | "ephemeral"> {
  return {
    session_id: context.sessionId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    ...(context.ephemeral !== undefined ? { ephemeral: context.ephemeral } : {}),
  };
}

function sourceToolUseIdFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { sourceToolUseId?: unknown; source_tool_use_id?: unknown };
  if (typeof record.sourceToolUseId === "string") return record.sourceToolUseId;
  if (typeof record.source_tool_use_id === "string") return record.source_tool_use_id;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArrayFrom(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function checkpointEventFromToolResult(event: Extract<AgentTurnEvent, { type: "tool_result" }>, context: RuntimeEventContext): RuntimeEvent | null {
  const data = isRecord(event.result.data) ? event.result.data : undefined;
  const checkpointId = typeof data?.checkpointId === "string"
    ? data.checkpointId
    : typeof data?.checkpoint_id === "string"
      ? data.checkpoint_id
      : undefined;
  if (!checkpointId) return null;
  const paths = stringArrayFrom(data?.paths ?? data?.resourcePaths);
  return {
    type: "checkpoint",
    ...baseContext(context),
    checkpoint_id: checkpointId,
    paths,
    source_tool_use_id: event.id,
  };
}

function candidateEventFromToolResult(event: Extract<AgentTurnEvent, { type: "tool_result" }>, context: RuntimeEventContext): RuntimeEvent | null {
  const artifact = event.result.artifact;
  if (!artifact || artifact.kind !== "candidate") return null;
  return {
    type: "candidate",
    ...baseContext(context),
    candidate_id: artifact.id,
    artifact,
    source_tool_use_id: event.id,
  };
}

export function runtimeItemsFromSessionMessage(message: NarratorSessionChatMessage, context: Pick<RuntimeEventContext, "sessionId">): RuntimeItem[] {
  const items: RuntimeItem[] = [{
    type: "message",
    id: message.id,
    session_id: context.sessionId,
    role: message.role,
    content: message.content,
    ...(message.seq !== undefined ? { seq: message.seq } : {}),
    timestamp: message.timestamp,
    ...(message.runtime ? { runtime: message.runtime } : {}),
  }];

  for (const toolCall of message.toolCalls ?? []) {
    items.push({
      type: "tool_result",
      ...(toolCall.id ? { id: toolCall.id, tool_use_id: toolCall.id } : {}),
      session_id: context.sessionId,
      tool_name: toolCall.toolName,
      ...(toolCall.status ? { status: toolCall.status } : {}),
      ...(toolCall.input !== undefined ? { input: toolCall.input } : {}),
      ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
    });
  }

  return items;
}

export function runtimeEventsFromAgentTurnEvent(event: AgentTurnEvent, context: RuntimeEventContext): RuntimeEvent[] {
  const base = baseContext(context);
  switch (event.type) {
    case "streaming_chunk":
      return [{ type: "assistant_delta", ...base, delta: event.content }];
    case "reasoning_chunk":
      return []; // reasoning chunks are accumulated internally, not sent as text deltas
    case "assistant_message": {
      const events: RuntimeEvent[] = [{ type: "message", ...base, role: "assistant", content: event.content, runtime: event.runtime }];
      if (event.runtime.usage) events.push({ type: "usage", ...base, usage: event.runtime.usage, runtime: event.runtime });
      return events;
    }
    case "tool_call":
      return [{ type: "tool_use", ...base, tool_use_id: event.id, tool_name: event.toolName, input: event.input, runtime: event.runtime }];
    case "tool_result": {
      const events: RuntimeEvent[] = [{ type: "tool_result", ...base, tool_use_id: event.id, tool_name: event.toolName, result: event.result, ...(event.runtime ? { runtime: event.runtime } : {}) }];
      const checkpointEvent = checkpointEventFromToolResult(event, context);
      if (checkpointEvent) events.push(checkpointEvent);
      const candidateEvent = candidateEventFromToolResult(event, context);
      if (candidateEvent) events.push(candidateEvent);
      return events;
    }
    case "confirmation_required": {
      const confirmation = event.result.confirmation
        ? normalizeToolConfirmationRequest(event.result.confirmation, {
          sessionId: context.sessionId,
          ...(context.turnId ? { turnId: context.turnId } : {}),
          ...(sourceToolUseIdFrom(event) ? { toolUseId: sourceToolUseIdFrom(event) } : {}),
        })
        : undefined;
      return [{ type: "permission_request", ...base, confirmation_id: event.id, tool_name: event.toolName, ...(confirmation ? { confirmation } : {}), result: event.result }];
    }
    case "turn_failed":
      return [{ type: "error", ...base, code: event.reason, message: event.message, ...(event.data ? { data: event.data } : {}) }];
    case "turn_completed":
      return [{ type: "result", ...base, success: true, stop_reason: "completed", exit_code: 0 }];
  }
}

export function createRuntimeResultEvent(input: {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly success: boolean;
  readonly stopReason: RuntimeResultStopReason;
  readonly exitCode: number;
  readonly finalMessage?: string;
  readonly error?: string;
  readonly pendingConfirmation?: { readonly id: string; readonly toolName: string };
  readonly durationMs?: number;
  readonly usage?: HeadlessChatUsageEnvelope;
  readonly cost?: HeadlessChatCostEnvelope;
  readonly permissionDenials?: readonly unknown[];
  readonly runtimeCapabilities?: readonly unknown[];
  readonly ephemeral?: boolean;
}): RuntimeResultEvent {
  return {
    type: "result",
    session_id: input.sessionId,
    ...(input.turnId ? { turn_id: input.turnId } : {}),
    success: input.success,
    stop_reason: input.stopReason,
    exit_code: input.exitCode,
    ...(input.finalMessage ? { final_message: input.finalMessage } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.pendingConfirmation ? { pending_confirmation: input.pendingConfirmation } : {}),
    ...(input.durationMs !== undefined ? { duration_ms: input.durationMs } : {}),
    ...(input.usage ? { usage: input.usage } : {}),
    ...(input.cost ? { cost: input.cost } : {}),
    ...(input.permissionDenials ? { permission_denials: input.permissionDenials } : {}),
    ...(input.runtimeCapabilities ? { runtime_capabilities: input.runtimeCapabilities } : {}),
    ...(input.ephemeral !== undefined ? { ephemeral: input.ephemeral } : {}),
  };
}

export function runtimeEventsFromHeadlessChatEvent(event: HeadlessChatStreamEvent): RuntimeEvent[] {
  const context = { sessionId: event.session_id, ephemeral: event.ephemeral };
  const base = baseContext(context);
  switch (event.type) {
    case "user_message":
      return [{ type: "message", ...base, role: "user", content: event.content }];
    case "assistant_delta":
      return [{ type: "assistant_delta", ...base, delta: event.delta }];
    case "assistant_message":
      return [{ type: "message", ...base, role: "assistant", content: event.content, ...(event.runtime ? { runtime: event.runtime } : {}) }];
    case "tool_use":
      return [{ type: "tool_use", ...base, tool_use_id: event.tool_use_id, tool_name: event.tool_name, input: event.input, ...(event.runtime ? { runtime: event.runtime } : {}) }];
    case "tool_result":
      return [{ type: "tool_result", ...base, tool_use_id: event.tool_use_id, tool_name: event.tool_name, result: event.result, ...(event.runtime ? { runtime: event.runtime } : {}) }];
    case "checkpoint_created":
      return [{ type: "checkpoint", ...base, checkpoint_id: event.checkpoint_id, paths: event.paths, ...(event.source_tool_use_id ? { source_tool_use_id: event.source_tool_use_id } : {}) }];
    case "candidate_created":
      return [{ type: "candidate", ...base, candidate_id: event.candidate_id, artifact: event.artifact as Extract<RuntimeEvent, { type: "candidate" }>["artifact"], ...(event.source_tool_use_id ? { source_tool_use_id: event.source_tool_use_id } : {}) }];
    case "resource_updated":
      return [];
    case "permission_request": {
      const confirmation = event.confirmation
        ? normalizeToolConfirmationRequest(event.confirmation as Parameters<typeof normalizeToolConfirmationRequest>[0], {
          sessionId: event.session_id,
          ...(sourceToolUseIdFrom(event) ? { toolUseId: sourceToolUseIdFrom(event) } : {}),
        })
        : undefined;
      return [{ type: "permission_request", ...base, confirmation_id: event.confirmation_id, tool_name: event.tool_name, ...(confirmation ? { confirmation } : {}), result: event.result }];
    }
    case "usage_delta":
      return [{ type: "usage", ...base, usage: event.usage as Extract<RuntimeEvent, { type: "usage" }>["usage"], ...(event.runtime ? { runtime: event.runtime } : {}) }];
    case "command_started":
      return [{ type: "command_started", ...base, command_id: event.command_id, command_name: event.command_name, raw: event.raw, args: event.args }];
    case "command_completed":
      return [{ type: "command_completed", ...base, command_id: event.command_id, command_name: event.command_name, raw: event.raw, args: event.args, result: event.result }];
    case "command_error":
      return [{ type: "command_error", ...base, ...(event.command_id ? { command_id: event.command_id } : {}), ...(event.command_name ? { command_name: event.command_name } : {}), raw: event.raw, ...(event.args !== undefined ? { args: event.args } : {}), code: event.code, message: event.message }];
    case "error":
      return [{ type: "error", ...base, code: event.code, message: event.message, ...(event.data ? { data: event.data } : {}) }];
    case "result":
      return [createRuntimeResultEvent({
        sessionId: event.session_id,
        success: event.success,
        stopReason: event.stop_reason,
        exitCode: event.exit_code,
        ...(event.final_message ? { finalMessage: event.final_message } : {}),
        ...(event.error ? { error: event.error } : {}),
        ...(event.pending_confirmation ? { pendingConfirmation: { id: event.pending_confirmation.id, toolName: event.pending_confirmation.toolName } } : {}),
        durationMs: event.duration_ms,
        usage: event.usage,
        cost: event.cost,
        permissionDenials: event.permission_denials,
        runtimeCapabilities: event.runtime_capabilities,
        ephemeral: event.ephemeral,
      })];
  }
}
