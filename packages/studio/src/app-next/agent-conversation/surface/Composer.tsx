import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Paperclip, ListPlus, Loader2, Square } from "lucide-react";

import {
  createDefaultSlashCommandRegistry,
  executeSlashCommandInput,
  getSlashCommandSuggestions,
  parseSlashCommandInput,
  type SlashCommandExecutionContext,
  type SlashCommandExecutionResult,
} from "../slash-command-registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export interface ComposerProps {
  onSend: (content: string) => void;
  onAbort: () => void;
  onContinue?: () => void;
  onSlashCommandResult?: (result: SlashCommandExecutionResult) => void;
  onAttach?: (files: FileList) => void;
  slashCommandContext?: SlashCommandExecutionContext;
  isRunning?: boolean;
  isInterrupted?: boolean;
  disabledReason?: string;
  settingsHref?: string;
}

export function Composer({
  onSend,
  onAbort,
  onContinue,
  onSlashCommandResult,
  onAttach,
  slashCommandContext,
  isRunning = false,
  isInterrupted = false,
  disabledReason,
  settingsHref,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [commandStatus, setCommandStatus] = useState<string | null>(null);
  const [aborting, setAborting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const registry = useMemo(() => slashCommandContext?.registry ?? createDefaultSlashCommandRegistry(), [slashCommandContext?.registry]);

  // Reset aborting state when turn ends
  useEffect(() => {
    if (!isRunning) setAborting(false);
  }, [isRunning]);
  const slashSuggestions = getSlashCommandSuggestions(value, registry);
  const showSlashSuggestions = parseSlashCommandInput(value).ok && slashSuggestions.length > 0;

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const handleSend = useCallback(async () => {
    const content = value.trim();
    if (!content) return;
    const slash = parseSlashCommandInput(content);
    if (slash.ok) {
      try {
        const result = await executeSlashCommandInput(content, { ...slashCommandContext, registry });
        // 后端执行的命令（novel:* 等）：前端 registry 无 handler，发送到后端处理
        if (!result.ok && result.code === "unhandled_command") {
          onSend(content);
          setValue("");
          setCommandStatus(null);
          return;
        }
        setCommandStatus(result.message);
        onSlashCommandResult?.(result);
        if (result.ok) setValue("");
      } catch (error) {
        const result = { ok: false as const, kind: "error" as const, code: "command_failed", message: error instanceof Error ? error.message : "命令执行失败", runtimeEvents: [] };
        setCommandStatus(result.message);
        onSlashCommandResult?.(result);
      }
      return;
    }
    onSend(content);
    setValue("");
    setCommandStatus(null);
  }, [value, onSend, onSlashCommandResult, slashCommandContext, registry]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <TooltipProvider>
    <footer className="shrink-0 bg-background px-4 py-2" aria-label="会话输入区">
      {/* Slash command suggestions */}
      {showSlashSuggestions && (
        <div className="mb-2 rounded-lg border border-border bg-card p-2 shadow-sm">
          {slashSuggestions.map((command) => (
            <Button
              key={command.name}
              variant="ghost"
              size="sm"
              className="flex w-full items-center gap-2 justify-start rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => { setValue(`/${command.name} `); textareaRef.current?.focus(); }}
            >
              <code className="text-xs font-mono text-primary">/{command.name}</code>
              <span className="text-muted-foreground">{command.description}</span>
            </Button>
          ))}
        </div>
      )}

      {/* Command status */}
      {commandStatus && (
        <div className="mb-2 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">{commandStatus}</div>
      )}

      {/* Disabled reason */}
      {disabledReason && (
        <div className="mb-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {disabledReason}
          {settingsHref && <a href={settingsHref} className="ml-2 underline">打开设置</a>}
        </div>
      )}

      {/* Input row — NarraFork 模式：📎 + textarea + 单按钮 */}
      <div className="flex items-end gap-2">
        {/* Attachment button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} aria-label="附件">
              <Paperclip className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>附件</TooltipContent>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length && onAttach) onAttach(e.target.files); e.target.value = ""; }}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="min-h-[40px] max-h-[200px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          aria-label="对话输入框"
          placeholder="发送消息... (Enter 发送, Shift+Enter 换行)"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />

        {/* Action button — NarraFork 优先级：
            1. running + 无输入 → 中断（红色，带 loading 反馈）
            2. idle + 无输入 + 可继续 → 继续（蓝色文字）
            3. running + 有输入 → 队列发送（排队）
            4. 默认（有输入） → 发送
        */}
        {isRunning && !value.trim() ? (
          <Button
            variant="destructive"
            size="sm"
            className="font-medium text-sm px-4 shrink-0 gap-1.5"
            onClick={() => { setAborting(true); onAbort(); }}
            disabled={aborting}
            aria-label="中断"
          >
            {aborting ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3 fill-current" />}
            {aborting ? "中断中..." : "中断"}
          </Button>
        ) : !isRunning && !value.trim() && (isInterrupted || onContinue) ? (
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm px-4 shrink-0"
            onClick={() => onContinue?.()}
            aria-label="继续"
          >
            继续
          </Button>
        ) : isRunning && value.trim() ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" className="bg-amber-600 text-white hover:bg-amber-700" onClick={() => void handleSend()} aria-label="排队发送">
                <ListPlus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>排队发送（完成后自动发送）</TooltipContent>
          </Tooltip>
        ) : value.trim() ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" onClick={() => void handleSend()} disabled={Boolean(disabledReason)} aria-label="发送">
                <Send className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>发送</TooltipContent>
          </Tooltip>
        ) : (
          <Button size="icon" disabled aria-label="发送">
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </footer>
    </TooltipProvider>
  );
}
