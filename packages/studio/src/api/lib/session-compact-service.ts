import type { AgentTurnItem } from "./agent-turn-runtime.js";
import type { NarratorSessionChatMessage, NarratorSessionChatSnapshot } from "../../shared/session-types.js";
import { microCompact } from "./compact/micro-compact.js";
import { getSessionChatSnapshot, replaceSessionChatState } from "./session-chat-service.js";
import { collectRuntimeTranscriptEvents } from "./runtime-transcript.js";
import { generateSessionReply } from "./llm-runtime-service.js";
import { loadUserConfig } from "./user-config-service.js";

// Store last pre-compact snapshot for undo capability
const preCompactSnapshots = new Map<string, NarratorSessionChatMessage[]>();

export type SessionCompactErrorCode = "session_not_found" | "not_enough_messages" | "compact_failed";

export type SessionCompactFailure = {
  readonly ok: false;
  readonly status: 400 | 404 | 500;
  readonly code: SessionCompactErrorCode;
  readonly error: string;
};

export type SessionCompactBudget = {
  readonly estimatedTokensBefore: number;
  readonly estimatedTokensAfter: number;
  readonly maxRecentMessages: number;
  readonly preservedMessages: number;
};

export type SessionCompactSuccess = {
  readonly ok: true;
  readonly summary: string;
  readonly compactedAt: number;
  readonly beforeMessageCount: number;
  readonly afterMessageCount: number;
  readonly compactedMessageCount: number;
  readonly sourceRange: { readonly fromSeq: number; readonly toSeq: number };
  readonly preservedRange: { readonly fromSeq: number; readonly toSeq: number };
  readonly model: { readonly providerId: string; readonly modelId: string };
  readonly budget: SessionCompactBudget;
  readonly snapshot: NarratorSessionChatSnapshot;
};

export type SessionCompactResult = SessionCompactSuccess | SessionCompactFailure;

export type CompactSessionInput = {
  readonly sessionId: string;
  readonly preserveRecentMessages?: number;
  readonly instructions?: string;
  readonly now?: number;
};

function sessionNotFound(): SessionCompactFailure {
  return { ok: false, status: 404, code: "session_not_found", error: "Session not found" };
}

function notEnoughMessages(): SessionCompactFailure {
  return { ok: false, status: 400, code: "not_enough_messages", error: "Not enough messages to compact" };
}

function compactFailed(): SessionCompactFailure {
  return { ok: false, status: 500, code: "compact_failed", error: "Compact failed" };
}

function seqOf(message: NarratorSessionChatMessage | undefined, fallback: number): number {
  return Math.max(0, message?.seq ?? fallback);
}

function estimateTokens(messages: readonly NarratorSessionChatMessage[]): number {
  const chars = messages.reduce((total, message) => total + message.content.length, 0);
  return Math.max(1, Math.ceil(chars / 4));
}

function toTurnItem(message: NarratorSessionChatMessage): AgentTurnItem {
  return { type: "message", role: message.role, content: message.content, id: message.id, metadata: message.metadata };
}

function truncate(text: string, maxLength: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

function buildSummary(compactedMessages: readonly NarratorSessionChatMessage[], compactedItems: readonly AgentTurnItem[], instructions?: string): string {
  const excerpts = compactedMessages
    .slice(0, 8)
    .map((message) => `${message.role}: ${truncate(message.content, 120)}`)
    .filter(Boolean)
    .join("\n");
  const compactedPreview = compactedItems
    .slice(0, 8)
    .map((item) => (item.type === "message" ? `${item.role}: ${item.content}` : item.type))
    .join("\n");
  const instructionLine = instructions?.trim() ? `\n执行指令：${instructions.trim()}` : "";
  return `上下文压缩摘要：已压缩 ${compactedMessages.length} 条较早消息。${instructionLine}\n关键摘录：\n${excerpts || compactedPreview || "无"}`;
}

function parseSummaryModelRef(summaryModel: string): { providerId: string; modelId: string } | null {
  if (!summaryModel) return null;
  const colonIndex = summaryModel.indexOf(":");
  if (colonIndex <= 0) return null;
  const providerId = summaryModel.slice(0, colonIndex);
  const modelId = summaryModel.slice(colonIndex + 1);
  return providerId && modelId ? { providerId, modelId } : null;
}

function stripImages(content: string): string {
  return content.replace(/\[image:[^\]]*\]/g, "[image]");
}

function buildCompactPrompt(messages: readonly NarratorSessionChatMessage[], instructions?: string): string {
  const textMessages = messages
    .map((m) => `[${m.role}] ${stripImages(m.content)}`)
    .join("\n\n");

  return `请总结以下对话历史，生成一份简洁但完整的摘要。

要求保留：
1. 关键决策和结论
2. 已完成的文件修改（文件名和修改内容概要）
3. 未完成的任务和下一步计划
4. 重要的上下文信息（项目结构、技术选型等）
5. 用户的偏好和约束

不需要保留：
- 工具调用的详细输出
- 重复的搜索结果
- 中间推理过程

${instructions ? `额外指令：${instructions}\n\n` : ""}对话历史：
${textMessages}

请用中文生成摘要：`;
}

async function generateLlmSummary(
  compactedMessages: readonly NarratorSessionChatMessage[],
  sessionProviderId: string,
  sessionModelId: string,
  instructions?: string,
): Promise<string | null> {
  let summaryModelRef: { providerId: string; modelId: string } | null = null;
  try {
    const config = await loadUserConfig();
    summaryModelRef = parseSummaryModelRef(config.modelDefaults.summaryModel);
  } catch {
    // config load failure → use session model
  }

  const providerId = summaryModelRef?.providerId ?? sessionProviderId;
  const modelId = summaryModelRef?.modelId ?? sessionModelId;

  if (!providerId || !modelId) return null;

  const prompt = buildCompactPrompt(compactedMessages, instructions);

  try {
    const result = await generateSessionReply({
      sessionConfig: {
        providerId,
        modelId,
        permissionMode: "allow",
        reasoningEffort: "low",
      },
      messages: [
        {
          type: "message" as const,
          id: "compact-system",
          role: "system" as const,
          content: "你是一个对话摘要助手。请根据用户提供的对话历史生成结构化摘要。摘要应简洁、完整、保留关键信息。最多 2000 字。",
        },
        {
          type: "message" as const,
          id: "compact-user",
          role: "user" as const,
          content: prompt,
        },
      ],
    });

    if (result.success && result.type === "message" && result.content.trim()) {
      return result.content.trim();
    }
  } catch {
    // LLM failure → fallback to text concatenation
  }

  return null;
}

function buildSummaryMessage(input: {
  readonly sessionId: string;
  readonly summary: string;
  readonly compactedAt: number;
  readonly compactedMessageCount: number;
  readonly sourceRange: { readonly fromSeq: number; readonly toSeq: number };
  readonly preservedRange: { readonly fromSeq: number; readonly toSeq: number };
  readonly model: { readonly providerId: string; readonly modelId: string };
  readonly budget: SessionCompactBudget;
  readonly runtimeTranscriptSummary?: { readonly eventCount: number; readonly eventTypes: readonly string[] };
  readonly instructions?: string;
}): NarratorSessionChatMessage {
  return {
    id: `compact-summary-${crypto.randomUUID()}`,
    role: "system",
    content: input.summary,
    timestamp: input.compactedAt,
    metadata: {
      kind: "session-compact-summary",
      sessionId: input.sessionId,
      compactedAt: input.compactedAt,
      compactedMessageCount: input.compactedMessageCount,
      sourceRange: input.sourceRange,
      preservedRange: input.preservedRange,
      model: input.model,
      budget: input.budget,
      ...(input.runtimeTranscriptSummary ? { runtimeTranscriptSummary: input.runtimeTranscriptSummary } : {}),
      ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
    },
  };
}

export async function compactSession(input: CompactSessionInput): Promise<SessionCompactResult> {
  const snapshot = await getSessionChatSnapshot(input.sessionId);
  if (!snapshot) return sessionNotFound();

  const preserveRecentMessages = Math.max(1, input.preserveRecentMessages ?? 6);
  const sourceMessages = snapshot.messages;
  if (sourceMessages.length <= preserveRecentMessages) return notEnoughMessages();

  const compactedMessages = sourceMessages.slice(0, sourceMessages.length - preserveRecentMessages);
  const preservedMessages = sourceMessages.slice(-preserveRecentMessages);
  const compactedItems = microCompact(compactedMessages.map(toTurnItem));
  const runtimeTranscriptEvents = collectRuntimeTranscriptEvents(compactedMessages);
  const runtimeTranscriptSummary = {
    eventCount: runtimeTranscriptEvents.length,
    eventTypes: [...new Set(runtimeTranscriptEvents.map((event) => event.type))],
  };
  const compactedAt = input.now ?? Date.now();
  const sourceRange = {
    fromSeq: seqOf(compactedMessages[0], 1),
    toSeq: seqOf(compactedMessages.at(-1), compactedMessages.length),
  };
  const preservedRange = {
    fromSeq: seqOf(preservedMessages[0], sourceRange.toSeq + 1),
    toSeq: seqOf(preservedMessages.at(-1), sourceMessages.length),
  };
  const model = {
    providerId: snapshot.session.sessionConfig.providerId,
    modelId: snapshot.session.sessionConfig.modelId,
  };
  const llmSummary = await generateLlmSummary(compactedMessages, model.providerId, model.modelId, input.instructions);
  const summary = llmSummary ?? buildSummary(compactedMessages, compactedItems, input.instructions);
  const budget = {
    estimatedTokensBefore: estimateTokens(sourceMessages),
    estimatedTokensAfter: estimateTokens([buildSummaryMessage({ sessionId: input.sessionId, summary, compactedAt, compactedMessageCount: compactedMessages.length, sourceRange, preservedRange, model, budget: { estimatedTokensBefore: 1, estimatedTokensAfter: 1, maxRecentMessages: preserveRecentMessages, preservedMessages: preservedMessages.length }, runtimeTranscriptSummary, instructions: input.instructions }), ...preservedMessages]),
    maxRecentMessages: preserveRecentMessages,
    preservedMessages: preservedMessages.length,
  } satisfies SessionCompactBudget;
  const summaryMessage = buildSummaryMessage({
    sessionId: input.sessionId,
    summary,
    compactedAt,
    compactedMessageCount: compactedMessages.length,
    sourceRange,
    preservedRange,
    model,
    budget,
    runtimeTranscriptSummary,
    instructions: input.instructions,
  });

  // Save pre-compact snapshot for undo
  preCompactSnapshots.set(input.sessionId, [...sourceMessages]);

  const compactedSnapshot = await replaceSessionChatState(input.sessionId, [summaryMessage, ...preservedMessages]);
  if (!compactedSnapshot) return compactFailed();

  return {
    ok: true,
    summary,
    compactedAt,
    beforeMessageCount: sourceMessages.length,
    afterMessageCount: compactedSnapshot.messages.length,
    compactedMessageCount: compactedMessages.length,
    sourceRange,
    preservedRange,
    model,
    budget,
    snapshot: compactedSnapshot,
  };
}

export type UndoCompactResult =
  | { readonly ok: true; readonly restoredMessageCount: number; readonly snapshot: NarratorSessionChatSnapshot }
  | { readonly ok: false; readonly status: 404; readonly error: string };

export async function undoCompactSession(sessionId: string): Promise<UndoCompactResult> {
  const preCompactMessages = preCompactSnapshots.get(sessionId);
  if (!preCompactMessages) {
    return { ok: false, status: 404, error: "No compact history available to undo." };
  }

  const restored = await replaceSessionChatState(sessionId, preCompactMessages);
  if (!restored) {
    return { ok: false, status: 404, error: "Failed to restore pre-compact state." };
  }

  preCompactSnapshots.delete(sessionId);
  return { ok: true, restoredMessageCount: preCompactMessages.length, snapshot: restored };
}

export async function editCompactSummary(sessionId: string, newSummary: string): Promise<{ ok: boolean; error?: string }> {
  const snapshot = await getSessionChatSnapshot(sessionId);
  if (!snapshot) return { ok: false, error: "Session not found" };

  const summaryMessage = snapshot.messages.find((m) => (m.metadata as Record<string, unknown> | undefined)?.kind === "session-compact-summary");
  if (!summaryMessage) return { ok: false, error: "No compact summary found in session" };

  const updatedMessages = snapshot.messages.map((m) =>
    m.id === summaryMessage.id ? { ...m, content: newSummary } : m,
  );

  const result = await replaceSessionChatState(sessionId, updatedMessages);
  return result ? { ok: true } : { ok: false, error: "Failed to update summary" };
}
