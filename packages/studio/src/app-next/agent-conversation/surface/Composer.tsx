import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Paperclip, ListPlus, Loader2, Square, RotateCcw, X } from "lucide-react";

import {
  createDefaultSlashCommandRegistry,
  executeSlashCommandInput,
  executeUserCommandViaApi,
  getSlashCommandSuggestions,
  parseSlashCommandInput,
  expandUserCommandPrompt,
  type SlashCommandExecutionContext,
  type SlashCommandExecutionResult,
} from "../slash-command-registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

// ── HoldAbortButton — 长按确认中断 ──

function HoldAbortButton({ onAbort, aborting }: { onAbort: () => void; aborting: boolean }) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const firedRef = useRef(false);

  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startHold = () => {
    firedRef.current = false;
    setHolding(true);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(elapsed / 800, 1); // 800ms hold time
      setProgress(pct);
      if (pct >= 1 && !firedRef.current) {
        firedRef.current = true;
        cleanup();
        setHolding(false);
        setProgress(0);
        onAbort();
      }
    }, 30);
  };

  const cancelHold = () => {
    if (firedRef.current) return; // Already fired, don't reset
    setHolding(false);
    setProgress(0);
    cleanup();
  };

  useEffect(() => () => cleanup(), []);

  if (aborting) {
    return (
      <Button variant="destructive" size="sm" className="font-medium text-sm px-4 shrink-0 gap-1.5" disabled>
        <Loader2 className="size-3 animate-spin" /> 中断中...
      </Button>
    );
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      className="font-medium text-sm px-4 shrink-0 gap-1.5 relative overflow-hidden"
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      aria-label="中断（长按确认）"
    >
      {holding && (
        <div
          className="absolute inset-0 bg-red-800/30 transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      )}
      <Square className="size-3 fill-current relative z-10" />
      <span className="relative z-10">{holding ? "松开取消" : "长按中断"}</span>
    </Button>
  );
}

export interface ComposerProps {
  onSend: (content: string, attachments?: Array<{ type: "image"; mimeType: string; data: string; fileName?: string }>) => void;
  onAbort: () => void;
  onContinue?: () => void;
  onRetry?: () => void;
  onSlashCommandResult?: (result: SlashCommandExecutionResult) => void;
  onAttach?: (files: FileList) => void;
  slashCommandContext?: SlashCommandExecutionContext;
  isRunning?: boolean;
  isInterrupted?: boolean;
  lastTurnFailed?: boolean;
  disabledReason?: string;
  settingsHref?: string;
}

export function Composer({
  onSend,
  onAbort,
  onContinue,
  onRetry,
  onSlashCommandResult,
  onAttach,
  slashCommandContext,
  isRunning = false,
  isInterrupted = false,
  lastTurnFailed = false,
  disabledReason,
  settingsHref,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [commandStatus, setCommandStatus] = useState<string | null>(null);
  const [aborting, setAborting] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
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
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [value]);

  const handleSend = useCallback(async () => {
    const content = value.trim();
    if (!content && attachedFiles.length === 0) return;

    // Convert attached files to base64
    let imageAttachments: Array<{ type: "image"; mimeType: string; data: string; fileName?: string }> | undefined;
    if (attachedFiles.length > 0) {
      imageAttachments = await Promise.all(
        attachedFiles.map(
          (file) =>
            new Promise<{ type: "image"; mimeType: string; data: string; fileName?: string }>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const base64 = (reader.result as string).split(",")[1] || "";
                resolve({ type: "image", mimeType: file.type || "image/png", data: base64, fileName: file.name });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );
      setAttachedFiles([]);
    }

    const effectiveContent = content || "[图片]";
    const slash = parseSlashCommandInput(effectiveContent);
    if (slash.ok) {
      try {
        const result = await executeSlashCommandInput(effectiveContent, { ...slashCommandContext, registry });
        // 后端执行的命令（novel:* 等）：前端 registry 无 handler，发送到后端处理
        if (!result.ok && result.code === "unhandled_command") {
          // 检查是否是用户自定义命令（handler 为 "user-command"）
          const parsed = parseSlashCommandInput(effectiveContent);
          if (parsed.ok) {
            const userCmd = registry.commands.find(c => c.name === parsed.name && (c as { handler?: string }).handler === "user-command");
            if (userCmd) {
              // 从已加载的 userCommands 中取 prompt 模板（避免重复 API 请求）
              const fullCmd = slashCommandContext?.userCommands?.find(c => c.name === parsed.name && c.enabled);
              if (fullCmd?.prompt) {
                // 如果命令有 preCommand，通过后端 API 执行（需要 shell 环境）
                if (fullCmd.preCommand) {
                  const apiResult = await executeUserCommandViaApi(parsed.name, { input: parsed.args });
                  if (apiResult.ok) {
                    onSend(apiResult.prompt, imageAttachments);
                  } else {
                    setCommandStatus(`命令执行失败: ${apiResult.error}`);
                  }
                  setValue("");
                  return;
                }
                const expanded = expandUserCommandPrompt(fullCmd.prompt, parsed.args);
                onSend(expanded, imageAttachments);
                setValue("");
                setCommandStatus(null);
                return;
              }
            }
          }
          onSend(effectiveContent, imageAttachments);
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
    onSend(effectiveContent, imageAttachments);
    setValue("");
    setCommandStatus(null);
  }, [value, attachedFiles, onSend, onSlashCommandResult, slashCommandContext, registry]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      setAttachedFiles((prev) => [...prev, ...imageFiles]);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files?.length) {
      setAttachedFiles((prev) => [...prev, ...Array.from(files)]);
    }
    e.target.value = "";
  }

  function removeAttachment(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
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
      <div className="flex flex-col gap-2">
        {/* Attachment preview */}
        {attachedFiles.length > 0 && (
          <div className="flex items-center gap-2 px-1 flex-wrap">
            {attachedFiles.map((file, i) => (
              <div key={`${file.name}-${i}`} className="relative group">
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="size-14 rounded-md border border-border object-cover"
                />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

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
          accept="image/*"
          className="hidden"
          onChange={handleFileInput}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="min-h-[40px] max-h-[400px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          aria-label="对话输入框"
          placeholder="发送消息... (Enter 发送, Shift+Enter 换行)"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
        />

        {/* Action button — 优先级：
            1. running + 无输入 → 长按中断（hold-to-confirm）
            2. idle + 无输入 + lastTurnFailed → 重试（橙色）
            3. idle + 无输入 + 可继续 → 继续（蓝色文字）
            4. running + 有输入 → 队列发送（排队）
            5. 默认（有输入） → 发送
        */}
        {isRunning && !value.trim() ? (
          <HoldAbortButton onAbort={() => { setAborting(true); onAbort(); }} aborting={aborting} />
        ) : !isRunning && !value.trim() && lastTurnFailed && onRetry ? (
          <Button
            size="sm"
            className="bg-orange-600 hover:bg-orange-700 text-white font-medium text-sm px-4 shrink-0 gap-1.5"
            onClick={onRetry}
            aria-label="重试"
          >
            <RotateCcw className="size-3.5" />
            重试
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
      </div>
    </footer>
    </TooltipProvider>
  );
}
