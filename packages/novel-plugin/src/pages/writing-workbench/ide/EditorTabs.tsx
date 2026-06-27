import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, FileText, FileEdit, FileCheck2, Scroll, File as FileIcon, Wrench, Pin, MoreHorizontal, Brain } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { TabKind, TabView } from "./use-ide-tabs";

export interface EditorTab {
  id: string;
  nodeId: string;
  title: string;
  dirty: boolean;
  pinned?: boolean;
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
  onTogglePin?: (tabId: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  actionsSlotRef?: RefObject<HTMLDivElement | null>;
}

function tabIcon(kind: TabKind, view?: TabView) {
  if (view === "narrative-memory") return { Icon: Brain, color: "text-pink-500" };
  switch (kind) {
    case "chapter": return { Icon: FileText, color: "text-sky-500" };
    case "jingwei-entry": return { Icon: Scroll, color: "text-violet-500" };
    case "file": return { Icon: FileIcon, color: "text-sky-600" };
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
  onTogglePin,
  onReorder,
  actionsSlotRef,
}: EditorTabsProps) {
  const tabs = rawTabs.filter(t => t.view === activeView);
  if (tabs.length === 0) return null;

  return (
    <div className="flex h-[35px] items-center border-b border-border bg-secondary/40">
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
        onTogglePin={onTogglePin}
        onReorder={onReorder}
      />
      {actionsSlotRef && <div ref={actionsSlotRef} className="flex items-center gap-1 px-2 shrink-0" />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 mr-1" aria-label="编辑器更多操作">
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onCloseSaved?.()} disabled={!onCloseSaved}>关闭已保存</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCloseAll?.()} disabled={!onCloseAll}>全部关闭</DropdownMenuItem>
          <DropdownMenuItem disabled>全部折叠</DropdownMenuItem>
          <DropdownMenuItem disabled>全部展开</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
  onTogglePin,
  onReorder,
}: Omit<EditorTabsProps, "actionsSlotRef" | "activeView">) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = tabs.findIndex((t) => t.id === active.id);
    const toIndex = tabs.findIndex((t) => t.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) onReorder?.(fromIndex, toIndex);
  };

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
      if (left < container.scrollLeft) container.scrollLeft = left;
      else if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth;
    };
    const raf = requestAnimationFrame(scrollActiveIntoView);
    const observer = new ResizeObserver(() => scrollActiveIntoView());
    observer.observe(container);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [activeTabId, tabs.length]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div ref={scrollRef} className="flex flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden" onWheel={(e) => { if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY; }}>
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
              onTogglePin={onTogglePin}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

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
  onTogglePin,
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
  onTogglePin?: (tabId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 10 : undefined };
  const { Icon, color } = tabIcon(tab.kind, tab.view);

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
          className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 h-full border-r border-border/60 text-[13px] transition-colors pl-2.5 pr-2 ${isActive ? "bg-background text-foreground" : "bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground"} ${tab.pinned ? "border-l-2 border-l-primary" : ""}`}
          onMouseDown={(e) => { if (e.button === 1 && !tab.pinned) { e.preventDefault(); onClose(tab.id); } }}
          onClick={() => onActivate(tab.id)}
        >
          {isActive && <span className={`absolute inset-x-0 top-0 h-[2px] ${tab.dirty ? "bg-amber-500" : "bg-primary"}`} />}
          {tab.pinned ? <Pin className="size-3 text-primary" /> : <Icon className={`size-3.5 shrink-0 ${color}`} />}
          <span className="truncate max-w-[120px]">{tab.title}</span>
          <span role="button" tabIndex={-1} className="relative flex size-5 items-center justify-center rounded hover:bg-muted cursor-pointer" onClick={(e) => { e.stopPropagation(); if (!tab.pinned) onClose(tab.id); }}>
            {tab.dirty ? <><span className="text-amber-500 text-[10px] group-hover:hidden">●</span><X className="size-3 hidden group-hover:block" /></> : <X className={`size-3 transition-opacity ${tab.pinned ? "opacity-30" : "opacity-0 group-hover:opacity-100"}`} />}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => onTogglePin?.(tab.id)} disabled={!onTogglePin}>{tab.pinned ? "取消固定" : "固定"}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onClose(tab.id)} disabled={tab.pinned}>关闭</ContextMenuItem>
        <ContextMenuItem onClick={() => onCloseOthers?.(tab.id)} disabled={!onCloseOthers || tabs.length <= 1}>关闭其他</ContextMenuItem>
        <ContextMenuItem onClick={() => onCloseRight?.(tab.id)} disabled={!onCloseRight || tabs[tabs.length - 1]?.id === tab.id}>关闭右侧</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onSplitRight?.(tab.nodeId)} disabled={!onSplitRight}>拆分到右侧</ContextMenuItem>
        <ContextMenuItem disabled>在新窗口打开</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCloseSaved?.()} disabled={!onCloseSaved}>关闭已保存</ContextMenuItem>
        <ContextMenuItem onClick={() => onCloseAll?.()} disabled={!onCloseAll}>全部关闭</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
