import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, FileText, FileEdit, FileCheck2, Scroll, File as FileIcon, Wrench } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { TabKind, TabView } from "./use-ide-tabs";

export interface EditorTab {
  id: string;
  nodeId: string;
  title: string;
  dirty: boolean;
  kind: TabKind;
  view: TabView;
}

interface EditorTabsProps {
  tabs: readonly EditorTab[];
  activeTabId: string | null;
  activeView: TabView;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseOthers?: (tabId: string) => void;
  onCloseAll?: () => void;
  onCloseSaved?: () => void;
  onCloseRight?: (tabId: string) => void;
  onSplitRight?: (tabId: string) => void;
  /** Tab 拖拽排序回调 */
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /** 外部容器 ref，WorkbenchCanvas 通过 portal 把操作按钮渲染到这里 */
  actionsSlotRef?: RefObject<HTMLDivElement | null>;
}

/** Tab 类型 → 图标 + 颜色（VS Code 文件类型图标语义） */
function tabIcon(kind: TabKind) {
  switch (kind) {
    case "chapter": return { Icon: FileText, color: "text-sky-500" };
    case "draft": return { Icon: FileEdit, color: "text-amber-500" };
    case "candidate": return { Icon: FileCheck2, color: "text-emerald-500" };
    case "jingwei-entry": return { Icon: Scroll, color: "text-violet-500" };
    case "tool": return { Icon: Wrench, color: "text-muted-foreground" };
    default: return { Icon: FileIcon, color: "text-muted-foreground" };
  }
}

export function EditorTabs({
  tabs: rawTabs,
  activeTabId,
  activeView,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCloseSaved,
  onCloseRight,
  onSplitRight,
  onReorder,
  actionsSlotRef,
}: EditorTabsProps) {
  // 双重保险：只渲染当前视图的 Tab（防止 hook 缓存/Allotment 渲染时序问题）
  const tabs = rawTabs.filter(t => t.view === activeView);
  if (tabs.length === 0) return null;

  return (
    <div className="flex h-[35px] items-center border-b border-border bg-secondary/40">
      {/* Tab 列表（可滚动，鼠标滚轮横向滚动） */}
      <ScrollableTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={onActivate}
        onClose={onClose}
        onCloseOthers={onCloseOthers}
        onCloseAll={onCloseAll}
        onCloseSaved={onCloseSaved}
        onCloseRight={onCloseRight}
        onSplitRight={onSplitRight}
        onReorder={onReorder}
      />
      {/* 操作按钮区域（由 WorkbenchCanvas 通过 portal 渲染） */}
      {actionsSlotRef && <div ref={actionsSlotRef} className="flex items-center gap-1 px-2 shrink-0" />}
    </div>
  );
}

function ScrollableTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCloseSaved,
  onCloseRight,
  onSplitRight,
  onReorder,
}: Omit<EditorTabsProps, "actionsSlotRef" | "activeView">) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 拖拽传感器：设置 5px 激活距离，避免与点击冲突
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = tabs.findIndex((t) => t.id === active.id);
    const toIndex = tabs.findIndex((t) => t.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      onReorder?.(fromIndex, toIndex);
    }
  };

  // 激活 tab 自动滚入可视区域（VS Code 行为）
  // 同时监听容器尺寸变化：操作按钮区（portal）渲染后会压缩 tab 滚动区宽度
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const scrollActiveIntoView = () => {
      const active = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!active) return;
      const cRect = container.getBoundingClientRect();
      const aRect = active.getBoundingClientRect();
      const left = aRect.left - cRect.left + container.scrollLeft;
      const right = left + aRect.width;
      if (left < container.scrollLeft) {
        container.scrollLeft = left;
      } else if (right > container.scrollLeft + container.clientWidth) {
        container.scrollLeft = right - container.clientWidth;
      }
    };

    const raf = requestAnimationFrame(scrollActiveIntoView);
    const observer = new ResizeObserver(() => scrollActiveIntoView());
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [activeTabId, tabs.length]);

  const tabIds = tabs.map((t) => t.id);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        <div
          ref={scrollRef}
          className="flex flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden"
          onWheel={(e) => {
            if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {tabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              tabs={tabs}
              onActivate={onActivate}
              onClose={onClose}
              onCloseOthers={onCloseOthers}
              onCloseAll={onCloseAll}
              onCloseSaved={onCloseSaved}
              onCloseRight={onCloseRight}
              onSplitRight={onSplitRight}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** 单个可排序 Tab */
function SortableTab({
  tab,
  isActive,
  tabs,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCloseSaved,
  onCloseRight,
  onSplitRight,
}: {
  tab: EditorTab;
  isActive: boolean;
  tabs: readonly EditorTab[];
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseOthers?: (tabId: string) => void;
  onCloseAll?: () => void;
  onCloseSaved?: () => void;
  onCloseRight?: (tabId: string) => void;
  onSplitRight?: (tabId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const { Icon, color } = tabIcon(tab.kind);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={isActive}
          tabIndex={0}
          className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 h-full border-r border-border/60 text-[13px] transition-colors pl-2.5 pr-2 ${
            isActive
              ? "bg-background text-foreground"
              : "bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          }`}
          onMouseDown={(e) => {
            if (e.button === 1) { e.preventDefault(); onClose(tab.id); }
          }}
          onClick={() => onActivate(tab.id)}
        >
          {/* 激活 tab 顶部高亮条；dirty 时变警示色（VS Code dirty-border-top） */}
          {isActive && (
            <span
              className={`absolute inset-x-0 top-0 h-[2px] ${tab.dirty ? "bg-amber-500" : "bg-primary"}`}
            />
          )}
          <Icon className={`size-3.5 shrink-0 ${color}`} />
          <span className="truncate max-w-[120px]">{tab.title}</span>
          {/* dirty 时显示圆点，hover 时变关闭按钮（VS Code 行为） */}
          <span
            role="button"
            tabIndex={-1}
            className="relative flex size-5 items-center justify-center rounded hover:bg-muted cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
          >
            {tab.dirty ? (
              <>
                <span className="text-amber-500 text-[10px] group-hover:hidden">●</span>
                <X className="size-3 hidden group-hover:block" />
              </>
            ) : (
              <X className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => onClose(tab.id)}>关闭</ContextMenuItem>
        <ContextMenuItem onClick={() => onCloseOthers?.(tab.id)} disabled={!onCloseOthers || tabs.length <= 1}>
          关闭其他
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onCloseRight?.(tab.id)}
          disabled={!onCloseRight || tabs[tabs.length - 1]?.id === tab.id}
        >
          关闭右侧
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onSplitRight?.(tab.nodeId)} disabled={!onSplitRight}>
          在侧边打开
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCloseSaved?.()} disabled={!onCloseSaved}>
          关闭已保存
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCloseAll?.()} disabled={!onCloseAll}>
          全部关闭
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
