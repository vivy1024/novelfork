import { Minimize2, Maximize2, X } from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";

interface WindowControlsProps {
  theme: Theme;
  minimized: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

export function WindowControls({ theme, minimized, onMinimize, onMaximize, onClose }: WindowControlsProps) {
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
        title="收起工作台 · 不结束会话，仍可在会话中心重开"
      >
        <X size={14} style={{ color: c.text }} />
      </button>
    </div>
  );
}
