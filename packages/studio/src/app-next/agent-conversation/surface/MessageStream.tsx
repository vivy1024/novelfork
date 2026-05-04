import { MessageItem, type ConversationSurfaceMessage } from "./MessageItem";

export function MessageStream({ messages }: { messages: readonly ConversationSurfaceMessage[] }) {
  return (
    <section data-testid="message-stream" className="message-stream min-h-0 flex-1 overflow-y-auto" aria-label="对话消息流">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </section>
  );
}

export type { ConversationSurfaceMessage };
