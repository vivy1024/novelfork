import type {
  NarratorSessionChatCursor,
  NarratorSessionChatMessage,
  NarratorSessionRecoveryMetadata,
  ToolCall,
} from "../../../shared/session-types.js";

export interface SessionChatCursorState {
  readonly messageCount: number;
  readonly messages: readonly NarratorSessionChatMessage[];
  readonly persistedAckedSeq: number;
}

export interface SessionChatRecoveryState extends SessionChatCursorState {
  readonly availableFromSeq: number;
}

export interface BuildSessionRecoveryMetadataOptions {
  readonly now?: () => string;
}

export function sanitizeSeq(value: unknown): number {
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

export function normalizeMessageTimestamp(value: unknown): number {
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

export function getLastSessionSeq(messages: readonly NarratorSessionChatMessage[]): number {
  return messages.at(-1)?.seq ?? 0;
}

export function normalizeSessionMessages(
  messages: readonly NarratorSessionChatMessage[] | undefined,
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
      timestamp: normalizeMessageTimestamp(message.timestamp),
      seq,
    };
  });
}

export function createSessionChatCursor(
  state: SessionChatCursorState,
  ackedSeq = state.persistedAckedSeq,
): NarratorSessionChatCursor {
  const lastSeq = Math.max(state.messageCount, getLastSessionSeq(state.messages));
  return {
    lastSeq,
    ackedSeq: Math.max(0, Math.min(Math.floor(ackedSeq), lastSeq)),
  };
}

export function getPendingToolCalls(messages: readonly NarratorSessionChatMessage[]): ToolCall[] {
  return messages.flatMap((message) => message.toolCalls ?? []).filter((toolCall) => toolCall.status === "pending" || toolCall.status === "running");
}

export function buildSessionRecoveryMetadata(
  state: SessionChatRecoveryState,
  messages: readonly NarratorSessionChatMessage[],
  failure?: NarratorSessionRecoveryMetadata["lastFailure"],
  options: BuildSessionRecoveryMetadataOptions = {},
): NarratorSessionRecoveryMetadata {
  const lastSeq = Math.max(state.messageCount, getLastSessionSeq(messages));
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
    updatedAt: options.now?.() ?? new Date().toISOString(),
  };
}

export function serializeSessionRecoveryMetadata(metadata: NarratorSessionRecoveryMetadata): string {
  return JSON.stringify(metadata);
}
