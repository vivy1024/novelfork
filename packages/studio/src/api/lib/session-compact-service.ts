import type { AgentTurnItem } from "./agent-turn-runtime.js";
import type { NarratorSessionChatMessage, NarratorSessionChatSnapshot } from "../../shared/session-types.js";
import { microCompact } from "./compact/micro-compact.js";
import { getSessionChatSnapshot, replaceSessionChatState } from "./session-chat-service.js";

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

function buildSummaryMessage(input: {
  readonly sessionId: string;
  readonly summary: string;
  readonly compactedAt: number;
  readonly compactedMessageCount: number;
  readonly sourceRange: { readonly fromSeq: number; readonly toSeq: number };
  readonly preservedRange: { readonly fromSeq: number; readonly toSeq: number };
  readonly model: { readonly providerId: string; readonly modelId: string };
  readonly budget: SessionCompactBudget;
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
  const summary = buildSummary(compactedMessages, compactedItems, input.instructions);
  const budget = {
    estimatedTokensBefore: estimateTokens(sourceMessages),
    estimatedTokensAfter: estimateTokens([buildSummaryMessage({ sessionId: input.sessionId, summary, compactedAt, compactedMessageCount: compactedMessages.length, sourceRange, preservedRange, model, budget: { estimatedTokensBefore: 1, estimatedTokensAfter: 1, maxRecentMessages: preserveRecentMessages, preservedMessages: preservedMessages.length }, instructions: input.instructions }), ...preservedMessages]),
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
    instructions: input.instructions,
  });

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
