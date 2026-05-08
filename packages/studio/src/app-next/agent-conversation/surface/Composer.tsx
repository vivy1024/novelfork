import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Paperclip, Square, Play } from "lucide-react";

import {
  createDefaultSlashCommandRegistry,
  executeSlashCommandInput,
  getSlashCommandSuggestions,
  parseSlashCommandInput,
  type SlashCommandExecutionContext,
  type SlashCommandExecutionResult,
} from "../slash-command-registry";

export interface ComposerModelOption {
  value: string;
  label: string;
}

export interface ComposerProps {
  onSend: (content: string) => void;
  onAbort: () => void;
  onContinue?: () => void;
  onSlashCommandResult?: (result: SlashCommandExecutionResult) => void;
  onModelChange?: (modelValue: string) => void;
  onPermissionChange?: (mode: string) => void;
  onAttach?: (files: FileList) => void;
  slashCommandContext?: SlashCommandExecutionContext;
  isRunning?: boolean;
  isInterrupted?: boolean;
  disabledReason?: string;
  settingsHref?: string;
  /** 当前会话模型值（provider:model 格式） */
  modelValue?: string;
  /** 可选模型列表 */
  modelOptions?: ComposerModelOption[];
  /** 当前权限模式 */
  permissionMode?: string;
  /** 权限模式选项 */
  permissionOptions?: readonly { value: string; label: string }[];
}

export function Composer({
  onSend,
  onAbort,
  onContinue,
  onSlashCommandResult,
  onModelChange,
  onPermissionChange,
  onAttach,
  slashCommandContext,
  isRunning = false,
  isInterrupted = false,
  disabledReason,
  settingsHref,
  modelValue,
  modelOptions,
  permissionMode,
  permissionOptions,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [commandStatus, setCommandStatus] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const registry = useMemo(() => slashCommandContext?.registry ?? createDefaultSlashCommandRegistry(), [slashCommandContext?.registry]);
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
        // Novel commands (unhandled_command) → send as regular message to let agent handle
        if (!result.ok && result.code === "unhandled_command" && content.startsWith("/novel:")) {
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
    <footer className="shrink-0 border-t border-border bg-background px-4 py-3" aria-label="会话输入区">
      {/* Slash command suggestions */}
      {showSlashSuggestions && (
        <div className="mb-2 rounded-lg border border-border bg-card p-2 shadow-sm">
          {slashSuggestions.map((command) => (
            <button
              key={command.name}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => { setValue(`/${command.name} `); textareaRef.current?.focus(); }}
            >
              <code className="text-xs font-mono text-primary">/{command.name}</code>
              <span className="text-muted-foreground">{command.description}</span>
            </button>
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

      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* Attachment button */}
        <button type="button" className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" title="附件" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="size-4" />
        </button>
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

        {/* Right side: model + permission + action button */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Model selector */}
          {modelOptions && modelOptions.length > 0 ? (
            <select
              className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground border-none outline-none cursor-pointer"
              title="当前模型"
              value={modelValue ?? ""}
              onChange={(e) => onModelChange?.(e.target.value)}
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : modelValue ? (
            <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground" title="当前模型">
              {modelValue}
            </span>
          ) : null}

          {/* Permission selector */}
          {permissionOptions && permissionOptions.length > 0 ? (
            <select
              className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary border-none outline-none cursor-pointer"
              title="权限模式"
              value={permissionMode ?? ""}
              onChange={(e) => onPermissionChange?.(e.target.value)}
            >
              {permissionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : permissionMode ? (
            <span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary" title="权限模式">
              {permissionMode}
            </span>
          ) : null}

          {/* Action button: interrupt / send / continue */}
          {isRunning ? (
            <button
              type="button"
              onClick={onAbort}
              className="rounded-lg bg-destructive p-2 text-destructive-foreground hover:bg-destructive/90"
              title="中断"
            >
              <Square className="size-4" />
            </button>
          ) : value.trim() ? (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={Boolean(disabledReason)}
              className="rounded-lg bg-primary p-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              title="发送"
            >
              <Send className="size-4" />
            </button>
          ) : (isInterrupted || onContinue) ? (
            <button
              type="button"
              onClick={() => onContinue?.()}
              className="rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-700"
              title="继续"
            >
              <Play className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={Boolean(disabledReason) || !value.trim()}
              className="rounded-lg bg-primary p-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              title="发送"
            >
              <Send className="size-4" />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
