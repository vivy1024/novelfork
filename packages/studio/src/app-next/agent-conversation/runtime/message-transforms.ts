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

  // Merge tool-result messages into their corresponding tool-use messages
  const toolResultIds: string[] = [];
  for (const [id, message] of byId) {
    if (id.includes("-tool-result-")) {
      const toolUseId = id.replace("-tool-result-", "-tool-use-");
      const toolUseMessage = byId.get(toolUseId);
      if (toolUseMessage) {
        // Merge tool-result's toolCalls into tool-use message (result has complete data)
        byId.set(toolUseId, {
          ...toolUseMessage,
          toolCalls: message.toolCalls ?? toolUseMessage.toolCalls,
        });
        toolResultIds.push(id);
      }
    }
  }
  for (const id of toolResultIds) {
    byId.delete(id);
  }

  return Array.from(byId.values()).sort((a, b) => {
    // Streaming messages (no seq) always sort to the end
    const aIsStream = a.id.startsWith("stream:");
    const bIsStream = b.id.startsWith("stream:");
    if (aIsStream && !bIsStream) return 1;
    if (!aIsStream && bIsStream) return -1;
    return (a.seq ?? 0) - (b.seq ?? 0);
  });
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
        seq: messages.reduce((max, m) => Math.max(max, m.seq ?? 0), 0) + 1,
      } as NarratorSessionChatMessage,
    ],
  };
}
