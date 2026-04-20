import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ResponsiveGridLayout, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { LayoutGrid, Plus } from "lucide-react";

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
  const activeWindowId = useWindowStore((state) => state.activeWindowId);
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

  const activeWindow = useMemo(
    () => windows.find((window) => window.id === activeWindowId) ?? windows[0] ?? null,
    [activeWindowId, windows],
  );

  const connectedCount = useMemo(
    () => windows.filter((window) => window.wsConnected).length,
    [windows],
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
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-muted/20"
      style={{ backgroundColor: c.bg }}
      data-testid="card-container"
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/40 bg-background/70 px-4 py-3 backdrop-blur">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <LayoutGrid className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">会话工作台</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            窗格排布会继续保留，但每个窗口都被当成独立对象来管理，聚焦、折叠和连接状态都更明显。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SummaryPill label="总数" value={String(windows.length)} />
          <SummaryPill label="在线" value={String(connectedCount)} />
          {activeWindow ? <SummaryPill label="聚焦" value={activeWindow.title} /> : <SummaryPill label="聚焦" value="暂无" />}
          <Button onClick={onCreateWindow} className="h-9 gap-2 px-3" data-testid="new-card-btn">
            <Plus className="size-4" />
            新建会话
          </Button>
        </div>
      </div>

      {windows.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-hidden p-3">
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
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <PageEmptyState
            title="还没有会话对象"
            description="先创建一个 Writer、Planner 或 Auditor 会话，再开始排布多窗口工作台。"
            action={<Button onClick={onCreateWindow}>创建第一个会话</Button>}
          />
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-left shadow-sm">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="max-w-[160px] truncate text-xs font-medium text-foreground">{value}</div>
    </div>
  );
}
