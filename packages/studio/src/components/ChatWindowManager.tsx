import { useCallback } from "react";
import { Responsive, WidthProvider, Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Plus } from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";
import { ChatWindow } from "./ChatWindow";
import { useWindowStore } from "../stores/windowStore";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface ChatWindowManagerProps {
  theme: Theme;
}

export function ChatWindowManager({ theme }: ChatWindowManagerProps) {
  const c = useColors(theme);
  const windows = useWindowStore((state) => state.windows);
  const addWindow = useWindowStore((state) => state.addWindow);
  const updateLayout = useWindowStore((state) => state.updateLayout);

  const handleLayoutChange = useCallback(
    (layout: Layout[]) => {
      layout.forEach((item) => {
        const window = windows.find((w) => w.id === item.i);
        if (window) {
          const newPos = { x: item.x, y: item.y, w: item.w, h: item.h };
          if (
            window.position.x !== newPos.x ||
            window.position.y !== newPos.y ||
            window.position.w !== newPos.w ||
            window.position.h !== newPos.h
          ) {
            updateLayout(item.i, newPos);
          }
        }
      });
    },
    [windows, updateLayout]
  );

  const handleAddWindow = () => {
    const agentId = prompt("输入 Agent ID (例如: writer, planner, auditor):");
    if (!agentId) return;
    const title = prompt("输入窗口标题:", `${agentId} Agent`) || `${agentId} Agent`;
    addWindow(agentId, title);
  };

  const layouts = {
    lg: windows.map((w) => ({
      i: w.id,
      x: w.position.x,
      y: w.position.y,
      w: w.minimized ? 4 : w.position.w,
      h: w.minimized ? 1 : w.position.h,
      minW: 3,
      minH: w.minimized ? 1 : 4,
    })),
  };

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: c.bg }}>
      {/* 添加窗口按钮 */}
      <button
        onClick={handleAddWindow}
        className="absolute top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg transition-transform hover:scale-105"
        style={{ backgroundColor: c.accent, color: "#fff" }}
      >
        <Plus size={16} />
        <span className="text-sm font-medium">新建对话窗口</span>
      </button>

      {/* 网格布局 */}
      {windows.length > 0 ? (
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={60}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".cursor-move"
          compactType={null}
          preventCollision={false}
        >
          {windows.map((window) => (
            <div key={window.id} className="overflow-hidden">
              <ChatWindow windowId={window.id} theme={theme} />
            </div>
          ))}
        </ResponsiveGridLayout>
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-lg mb-4" style={{ color: c.textSecondary }}>
              暂无对话窗口
            </p>
            <button
              onClick={handleAddWindow}
              className="px-6 py-3 rounded-lg shadow-lg transition-transform hover:scale-105"
              style={{ backgroundColor: c.accent, color: "#fff" }}
            >
              创建第一个窗口
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
