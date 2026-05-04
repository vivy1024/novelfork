import type { NarratorSessionChatMessage } from "../../../shared/session-types";

export function normalizeSessionMessage(message: NarratorSessionChatMessage): NarratorSessionChatMessage {
  const { runtime: _runtime, toolCalls, ...rest } = message as NarratorSessionChatMessage & { runtime?: unknown; toolCalls?: Array<Record<string, unknown>> };

  return {
    ...rest,
    toolCalls: toolCalls?.map((toolCall) => ({
      ...toolCall,
      allowed: typeof toolCall.result === "object" && toolCall.result !== null ? (toolCall.result as Record<string, unknown>).allowed : undefined,
    })) as NarratorSessionChatMessage["toolCalls"],
  };
}

export function mergeSessionMessages(
  current: readonly NarratorSessionChatMessage[],
  incoming: readonly NarratorSessionChatMessage[],
): NarratorSessionChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));

  for (const message of incoming) {
    if (!byId.has(message.id)) {
      byId.set(message.id, normalizeSessionMessage(message));
    }
  }

  return Array.from(byId.values()).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export function appendStreamChunk(
  messages: readonly NarratorSessionChatMessage[],
  sessionId: string,
  content: string,
  timestamp = Date.now(),
): { messages: NarratorSessionChatMessage[]; streamingMessageId: string } {
  const existing = messages.find((message) => message.id.startsWith(`stream:${sessionId}:`));
  const streamingMessageId = existing?.id ?? `stream:${sessionId}:${timestamp}`;

  if (existing) {
    return {
      streamingMessageId,
      messages: messages.map((message) =>
        message.id === streamingMessageId ? { ...message, content: `${message.content}${content}` } : message,
      ),
    };
  }

  return {
    streamingMessageId,
    messages: [
      ...messages,
      {
        id: streamingMessageId,
        role: "assistant",
        content,
        timestamp,
      } as NarratorSessionChatMessage,
    ],
  };
}
