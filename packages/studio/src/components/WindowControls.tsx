import { Minimize2, Maximize2, X } from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";

interface WindowControlsProps {
  theme: Theme;
  minimized: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  /** Optional override for the close button tooltip (5.7.2 / 5.7.3). */
  closeTooltip?: string;
}

export function WindowControls({ theme, minimized, onMinimize, onMaximize, onClose, closeTooltip }: WindowControlsProps) {
  const c = useColors(theme);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMinimize();
        }}
        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        title={minimized ? "展开工作台 · 会话保持不变" : "最小化工作台 · 会话仍在后台运行"}
      >
        <Minimize2 size={14} style={{ color: c.text }} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMaximize();
        }}
        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        title="最大化工作台"
      >
        <Maximize2 size={14} style={{ color: c.text }} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
        title={closeTooltip ?? "关闭窗口 · 会话仍保留在会话中心"}
        aria-label="关闭窗口"
      >
        <X size={14} style={{ color: c.text }} />
      </button>
    </div>
  );
}
