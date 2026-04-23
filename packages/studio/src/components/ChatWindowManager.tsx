import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { ResponsiveGridLayout, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Plus } from "lucide-react";

import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";
import { ChatWindow } from "./ChatWindow";
import { useWindowStore } from "../stores/windowStore";
import { Button } from "./ui/button";
import { PageEmptyState } from "./layout/PageEmptyState";

interface ChatWindowManagerProps {
  readonly theme: Theme;
  readonly onCreateWindow: () => void;
}

export function ChatWindowManager({ theme, onCreateWindow }: ChatWindowManagerProps) {
  const c = useColors(theme);
  const GridLayoutComponent = ResponsiveGridLayout as unknown as ComponentType<any>;
  const windows = useWindowStore((state) => state.windows);
  const updateLayout = useWindowStore((state) => state.updateLayout);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });

    observer.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth);

    return () => observer.disconnect();
  }, []);

  const handleLayoutChange = useCallback(
    (layout: Layout) => {
      layout.forEach((item: LayoutItem) => {
        const window = windows.find((candidate) => candidate.id === item.i);
        if (!window) return;

        const nextPosition = { x: item.x, y: item.y, w: item.w, h: item.h };
        if (
          window.position.x !== nextPosition.x ||
          window.position.y !== nextPosition.y ||
          window.position.w !== nextPosition.w ||
          window.position.h !== nextPosition.h
        ) {
          updateLayout(item.i, nextPosition);
        }
      });
    },
    [windows, updateLayout],
  );

  const layout = windows.map((window) => ({
    i: window.id,
    x: window.position.x,
    y: window.position.y,
    w: window.minimized ? 4 : window.position.w,
    h: window.minimized ? 1 : window.position.h,
    minW: 3,
    minH: window.minimized ? 1 : 4,
  }));

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-xl border border-border/60 bg-muted/20"
      style={{ backgroundColor: c.bg }}
      data-testid="card-container"
    >
      <Button
        onClick={onCreateWindow}
        className="absolute top-4 right-4 z-50"
        data-testid="new-card-btn"
      >
        <Plus className="size-4" />
        新建会话
      </Button>

      {windows.length > 0 ? (
        <GridLayoutComponent
          className="layout h-full"
          layouts={{ lg: layout }}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={60}
          width={width}
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
        </GridLayoutComponent>
      ) : (
        <div className="flex h-full items-center justify-center px-6">
          <PageEmptyState
            title="还没有打开的工作台"
            description="会话仍保留在下方列表里 · 工作台只是会话的视图，可随时从会话卡重新打开。"
            action={<Button onClick={onCreateWindow}>新建会话并打开工作台</Button>}
          />
        </div>
      )}
    </div>
  );
}
