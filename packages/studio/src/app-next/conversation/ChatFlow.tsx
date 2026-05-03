/**
 * ChatFlow — 对话流消息列表
 *
 * Claude Code 风格的单栏垂直对话流，工具调用内联展示。
 * 从 ChatWindow 的消息渲染逻辑提取为独立组件。
 */

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly timestamp?: number;
  readonly toolCalls?: readonly ChatToolCall[];
  readonly metadata?: Record<string, unknown>;
}

export interface ChatToolCall {
  readonly id: string;
  readonly toolName: string;
  readonly status: "pending" | "completed" | "failed";
  readonly input?: Record<string, unknown>;
  readonly result?: {
    readonly ok: boolean;
    readonly summary: string;
    readonly data?: unknown;
  };
  readonly durationMs?: number;
}

export interface ChatFlowProps {
  readonly messages: readonly ChatMessage[];
  /** 是否正在生成中 */
  readonly isStreaming?: boolean;
  /** 流式输出的当前内容 */
  readonly streamingContent?: string;
  /** 自定义工具调用渲染器 */
  readonly renderToolCall?: (toolCall: ChatToolCall, message: ChatMessage) => ReactNode;
  /** 消息点击回调 */
  readonly onMessageClick?: (messageId: string) => void;
  /** 自动滚动到底部 */
  readonly autoScroll?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Message components                                                 */
/* ------------------------------------------------------------------ */

function UserMessage({ message }: { readonly message: ChatMessage }) {
  return (
    <div className="chat-msg-user flex justify-end px-3 py-2">
      <div className="max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm">
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  renderToolCall,
}: {
  readonly message: ChatMessage;
  readonly renderToolCall?: ChatFlowProps["renderToolCall"];
}) {
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

  return (
    <div className="chat-msg-assistant space-y-2 px-3 py-2">
      {message.content && (
        <div className="max-w-[95%] text-sm">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      )}
      {hasToolCalls && (
        <div className="space-y-1.5">
          {message.toolCalls!.map((tc) => (
            <div key={tc.id}>
              {renderToolCall ? (
                renderToolCall(tc, message)
              ) : (
                <DefaultToolCallCard toolCall={tc} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DefaultToolCallCard({ toolCall }: { readonly toolCall: ChatToolCall }) {
  const statusColor = toolCall.status === "completed" ? "border-emerald-500/30 bg-emerald-500/5"
    : toolCall.status === "failed" ? "border-destructive/30 bg-destructive/5"
    : "border-border bg-muted/30";

  return (
    <div className={cn("rounded-lg border p-2 text-xs", statusColor)}>
      <div className="flex items-center gap-2">
        <span className="font-medium">{toolCall.toolName}</span>
        <span className="text-muted-foreground">
          {toolCall.status === "completed" ? "完成" : toolCall.status === "failed" ? "失败" : "执行中"}
        </span>
        {toolCall.durationMs !== undefined && (
          <span className="text-muted-foreground">{toolCall.durationMs}ms</span>
        )}
      </div>
      {toolCall.result && (
        <p className="mt-1 text-muted-foreground">{toolCall.result.summary}</p>
      )}
    </div>
  );
}

function StreamingIndicator({ content }: { readonly content?: string }) {
  return (
    <div className="chat-msg-assistant px-3 py-2">
      <div className="max-w-[95%] text-sm">
        {content ? (
          <p className="whitespace-pre-wrap">{content}<span className="inline-block h-4 w-0.5 animate-pulse bg-primary" /></p>
        ) : (
          <div className="flex items-center gap-1">
            <span className="chat-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <span className="chat-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <span className="chat-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ChatFlow                                                           */
/* ------------------------------------------------------------------ */

export function ChatFlow({
  messages,
  isStreaming = false,
  streamingContent,
  renderToolCall,
  autoScroll = true,
}: ChatFlowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent, autoScroll]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto" data-testid="chat-flow">
      {messages.length === 0 && !isStreaming ? (
        <div className="flex h-full items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">发送消息开始对话。</p>
        </div>
      ) : (
        <div className="space-y-1 py-2">
          {messages.map((msg) => (
            msg.role === "user" ? (
              <UserMessage key={msg.id} message={msg} />
            ) : msg.role === "assistant" ? (
              <AssistantMessage key={msg.id} message={msg} renderToolCall={renderToolCall} />
            ) : null
          ))}
          {isStreaming && <StreamingIndicator content={streamingContent} />}
        </div>
      )}
    </div>
  );
}
