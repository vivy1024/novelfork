/**
 * CommandPalette — VS Code 风格命令面板
 *
 * 支持两种模式：
 * - commands: Ctrl+Shift+P，列出所有 IDE 命令
 * - files: Ctrl+P，快速打开文件/经纬/章节
 */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  category?: string;
  shortcut?: string;
  execute: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  placeholder?: string;
}

export function CommandPalette({ open, onClose, commands, placeholder }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter commands by query (simple includes match)
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        (cmd.category?.toLowerCase().includes(q) ?? false)
    );
  }, [commands, query]);

  // Reset state on open/close
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Auto-focus input after mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeSelected = useCallback(() => {
    const cmd = filtered[selectedIndex];
    if (cmd) {
      onClose();
      cmd.execute();
    }
  }, [filtered, selectedIndex, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % Math.max(1, filtered.length));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
          break;
        case "Enter":
          e.preventDefault();
          executeSelected();
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered.length, executeSelected, onClose]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-lg bg-popover border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? "输入命令..."}
          className="w-full px-4 py-3 text-sm bg-transparent border-b border-border outline-none text-foreground placeholder:text-muted-foreground"
        />

        {/* List */}
        <div ref={listRef} className="max-h-[300px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              无匹配结果
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                data-active={i === selectedIndex}
                className={`px-4 py-2 flex items-center justify-between text-sm cursor-pointer ${
                  i === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/50"
                }`}
                onClick={() => {
                  onClose();
                  cmd.execute();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{cmd.label}</span>
                  {cmd.category && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {cmd.category}
                    </span>
                  )}
                </div>
                {cmd.shortcut && (
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0 ml-3">
                    {cmd.shortcut}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
