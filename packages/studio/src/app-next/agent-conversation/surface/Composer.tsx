import { useState } from "react";

export function Composer({ onSend, onAbort, isRunning = false }: { onSend: (content: string) => void; onAbort: () => void; isRunning?: boolean }) {
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
      {isRunning ? (
        <button type="button" onClick={onAbort}>
          中断
        </button>
      ) : (
        <button type="button" onClick={handleSend}>
          发送
        </button>
      )}
    </footer>
  );
}
