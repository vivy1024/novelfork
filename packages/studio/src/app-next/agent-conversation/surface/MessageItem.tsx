import type { ToolResultArtifact } from "../../tool-results";
import { ToolCallCard, type ConversationToolCall } from "./ToolCallCard";

export interface ConversationSurfaceMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ConversationToolCall[];
}

export function MessageItem({ message, onOpenArtifact }: { message: ConversationSurfaceMessage; onOpenArtifact?: (artifact: ToolResultArtifact) => void }) {
  return (
    <article data-testid={`message-${message.id}`} className={`conversation-message conversation-message--${message.role}`}>
      <p>{message.content}</p>
      {message.toolCalls?.map((toolCall) => <ToolCallCard key={toolCall.id} toolCall={toolCall} onOpenArtifact={onOpenArtifact} />)}
    </article>
  );
}
