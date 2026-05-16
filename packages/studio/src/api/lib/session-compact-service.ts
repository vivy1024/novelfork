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

  let prompt = `Your task is to create a detailed summary of the conversation below.

Before providing your final summary, wrap your analysis in <analysis> tags. In your analysis:
1. Chronologically analyze each message, identifying user requests, decisions, file changes, errors, and feedback.
2. Double-check for completeness.

Your summary should include:
1. Primary Request and Intent: The user's explicit requests in detail
2. Key Technical Concepts: Technologies, frameworks, patterns discussed
3. Files and Code Sections: Files examined/modified/created with summaries
4. Errors and Fixes: Errors encountered and solutions
5. Problem Solving: Problems solved and ongoing work
6. All User Messages: All non-tool-result user messages
7. Pending Tasks: Explicitly requested pending tasks
8. Current Work: What was being worked on immediately before this summary
9. Optional Next Step: Next step in line with the user's most recent request

Output format:
<analysis>[Your thought process]</analysis>
<summary>[Structured summary following the 9 sections above]</summary>

${instructions ? `Additional Instructions: ${instructions}\n\n` : ""}Conversation:
${textMessages}`;

  return prompt;
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
  console.log(`[compact] generating summary with ${providerId}:${modelId}, ${compactedMessages.length} messages`);

  try {
    // 30 秒超时保护，防止 API 无响应时永远挂起
    const timeoutSignal = AbortSignal.timeout(30_000);
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
          content: "You are a helpful AI assistant tasked with summarizing conversations. Respond with TEXT ONLY. Do NOT call any tools.",
        },
        {
          type: "message" as const,
          id: "compact-user",
          role: "user" as const,
          content: prompt,
        },
      ],
      signal: timeoutSignal,
    });

    if (result.success && result.type === "message" && result.content.trim()) {
      console.log(`[compact] summary generated, ${result.content.length} chars`);
      // 提取 <summary> 内容，去掉 <analysis>
      let summary = result.content.trim();
      summary = summary.replace(/<analysis>[\s\S]*?<\/analysis>/i, "").trim();
      const summaryMatch = summary.match(/<summary>([\s\S]*?)<\/summary>/i);
      if (summaryMatch?.[1]) {
        summary = summaryMatch[1].trim();
      }
      return summary;
    }
    console.log(`[compact] LLM returned unexpected result: success=${result.success}`);
  } catch (err) {
    console.error(`[compact] LLM summary failed:`, err instanceof Error ? err.message : err);
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
  if (!llmSummary) return compactFailed();
  const summary = llmSummary;
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
