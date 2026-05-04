import { useState } from "react";

export interface ComposerProps {
  onSend: (content: string) => void;
  onAbort: () => void;
  isRunning?: boolean;
  disabledReason?: string;
  settingsHref?: string;
}

export function Composer({ onSend, onAbort, isRunning = false, disabledReason, settingsHref }: ComposerProps) {
  const [value, setValue] = useState("");

  function handleSend() {
    const content = value.trim();
    if (!content) return;
    onSend(content);
    setValue("");
  }

  return (
    <footer className="composer">
      <textarea aria-label="对话输入框" value={value} onChange={(event) => setValue(event.currentTarget.value)} />
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
        <button type="button" onClick={handleSend} disabled={Boolean(disabledReason)}>
          发送
        </button>
      )}
    </footer>
  );
}
