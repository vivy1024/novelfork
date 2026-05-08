import type { ReactNode } from "react";
import { ToolCallCard, type ConversationToolCall } from "./ToolCallCard";

export interface ConversationSurfaceMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ConversationToolCall[];
}

/**
 * 简易 markdown 渲染（不引入重依赖）
 * 支持：代码块、行内代码、粗体、列表、标题
 */
function renderMarkdown(text: string): ReactNode {
  // Split by code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const lines = part.slice(3, -3).split("\n");
          const lang = lines[0]?.trim() || "";
          const code = (lang ? lines.slice(1) : lines).join("\n");
          return (
            <pre key={i} className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              <code>{code}</code>
            </pre>
          );
        }
        // Render inline markdown
        return <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: inlineMarkdown(part) }} />;
      })}
    </div>
  );
}

function inlineMarkdown(text: string): string {
  return text
    // Headers
    .replace(/^### (.+)$/gm, '<h4 class="font-semibold text-sm mt-3 mb-1">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-semibold text-base mt-3 mb-1">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="font-semibold text-lg mt-3 mb-1">$1</h2>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-xs font-mono">$1</code>')
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline" target="_blank" rel="noopener">$1</a>');
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
        {message.content && renderMarkdown(message.content)}
        {message.toolCalls?.map((toolCall) => <ToolCallCard key={toolCall.id} toolCall={toolCall} />)}
      </div>
    </div>
  );
}
