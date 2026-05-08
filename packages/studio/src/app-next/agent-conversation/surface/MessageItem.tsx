import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ToolCallBlock } from "@/components/ToolCall/ToolCallBlock";
import type { ConversationToolCall } from "./ToolCallCard";
import { adaptConversationToolCall } from "./tool-call-adapter";

export interface ConversationSurfaceMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ConversationToolCall[];
}

export function MessageItem({ message }: { message: ConversationSurfaceMessage; onOpenArtifact?: unknown }) {
  if (message.role === "system") {
    return (
      <div className="mx-auto max-w-lg py-1 text-center text-xs text-muted-foreground">
        {message.content}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end py-2">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  // assistant or tool
  return (
    <div className="py-2">
      <div className="max-w-[90%]">
        {message.content && <MarkdownRenderer content={message.content} />}
        {message.toolCalls?.map((toolCall) => (
          <ToolCallBlock key={toolCall.id} toolCall={adaptConversationToolCall(toolCall)} />
        ))}
      </div>
    </div>
  );
}
