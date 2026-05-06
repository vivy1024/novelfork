import { useMemo, useState } from "react";

import {
  createDefaultSlashCommandRegistry,
  executeSlashCommandInput,
  getSlashCommandSuggestions,
  parseSlashCommandInput,
  type SlashCommandExecutionContext,
  type SlashCommandExecutionResult,
} from "../slash-command-registry";

export interface ComposerProps {
  onSend: (content: string) => void;
  onAbort: () => void;
  onSlashCommandResult?: (result: SlashCommandExecutionResult) => void;
  slashCommandContext?: SlashCommandExecutionContext;
  isRunning?: boolean;
  disabledReason?: string;
  settingsHref?: string;
}

export function Composer({ onSend, onAbort, onSlashCommandResult, slashCommandContext, isRunning = false, disabledReason, settingsHref }: ComposerProps) {
  const [value, setValue] = useState("");
  const [commandStatus, setCommandStatus] = useState<string | null>(null);
  const registry = useMemo(() => slashCommandContext?.registry ?? createDefaultSlashCommandRegistry(), [slashCommandContext?.registry]);
  const slashSuggestions = getSlashCommandSuggestions(value, registry);
  const showSlashSuggestions = parseSlashCommandInput(value).ok && slashSuggestions.length > 0;

  async function handleSend() {
    const content = value.trim();
    if (!content) return;
    const slash = parseSlashCommandInput(content);
    if (slash.ok) {
      try {
        const result = await executeSlashCommandInput(content, { ...slashCommandContext, registry });
        setCommandStatus(result.message);
        onSlashCommandResult?.(result);
        if (result.ok) setValue("");
      } catch (error) {
        const result = { ok: false as const, kind: "error" as const, code: "command_failed", message: error instanceof Error ? error.message : "命令执行失败" };
        setCommandStatus(result.message);
        onSlashCommandResult?.(result);
      }
      return;
    }
    onSend(content);
    setValue("");
    setCommandStatus(null);
  }

  return (
    <footer className="composer">
      <textarea aria-label="对话输入框" value={value} onChange={(event) => setValue(event.currentTarget.value)} />
      {showSlashSuggestions ? (
        <div role="listbox" aria-label="斜杠命令建议">
          {slashSuggestions.map((command) => (
            <div key={command.name} role="option" aria-selected="false">
              <strong>/{command.name}</strong> <span>{command.description}</span>
            </div>
          ))}
        </div>
      ) : null}
      {commandStatus ? <p role="status">{commandStatus}</p> : null}
      {disabledReason ? (
        <p role="alert">
          {disabledReason}
          {settingsHref ? <a href={settingsHref}>打开设置</a> : null}
        </p>
      ) : null}
      {isRunning ? (
        <button type="button" onClick={onAbort}>
          中断
        </button>
      ) : (
        <button type="button" onClick={() => void handleSend()} disabled={Boolean(disabledReason)}>
          发送
        </button>
      )}
    </footer>
  );
}
