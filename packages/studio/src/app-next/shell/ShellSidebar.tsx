import { useCallback, useEffect, useMemo, useState } from "react";
import { BookMarked, BookOpen, CalendarClock, ChevronDown, ChevronUp, GripVertical, LogOut, MessageSquareText, PackageMinus, Search, Settings, Wrench, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Pin, Trash2, X } from "lucide-react";

import { getShellNavItems, isShellNavItemActive, recentTabKey, type ShellBookItem, type ShellNavItem, type ShellRecentTabItem, type ShellRoute, type ShellSessionItem } from "./shell-route";
import { resolveRecentNarrators } from "./NarratorWorkspaceDrawer";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ShellSidebarProps {
  readonly route: ShellRoute;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly onNavigate: (route: ShellRoute) => void;
  readonly onDeleteBook?: (bookId: string) => void;
  readonly recentTabs?: readonly ShellRecentTabItem[];
  readonly onRemoveRecentTab?: (tab: ShellRecentTabItem) => void;
  readonly onPinRecentTab?: (tab: ShellRecentTabItem, pinned: boolean) => void;
  readonly onMoveRecentTab?: (tab: ShellRecentTabItem, target: ShellRecentTabItem) => void;
  readonly onClearInactiveRecentTabs?: () => void;
  readonly onLogout?: () => void;
  readonly onOpenSessionDrawer?: () => void;
  readonly collapsed?: boolean;
  readonly onToggleCollapse?: () => void;
  readonly mode?: "desktop" | "mobile";
  readonly onCloseMobile?: () => void;
}

function NavButton({ label, active, onClick, collapsed }: { readonly label: string; readonly active: boolean; readonly onClick: () => void; readonly collapsed?: boolean }) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          className={cn(
            "flex w-full items-center justify-center rounded-md p-1.5 text-xs transition",
            active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          onClick={onClick}
        >
          <BookOpen className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      variant="ghost"
      size="xs"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center rounded-md px-2 py-1 text-left text-xs transition",
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
    </Button>
  );
}

function NarratorNavButton({
  item,
  active,
  onClick,
  onClose,
  onPin,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDropTarget,
  collapsed,
}: {
  readonly item: ShellNavItem & { group: "narrators" };
  readonly active: boolean;
  readonly onClick: () => void;
  readonly onClose?: () => void;
  readonly onPin?: () => void;
  readonly onDragStart?: () => void;
  readonly onDragOver?: () => void;
  readonly onDrop?: () => void;
  readonly onDragEnd?: () => void;
  readonly isDragging?: boolean;
  readonly isDropTarget?: boolean;
  readonly collapsed?: boolean;
}) {
  const { label, unread, working, pinned } = item;

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          className={cn(
            "relative flex w-full items-center justify-center rounded-md p-1.5 text-xs transition",
            active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          onClick={onClick}
        >
          <span className="text-[10px] font-bold">{label.charAt(0).toUpperCase()}</span>
          {(unread || working) && (
            <span
              className={cn(
                "absolute right-0.5 top-0.5 size-1.5 rounded-full",
                working ? "animate-pulse bg-primary" : "bg-muted-foreground",
              )}
            />
          )}
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center rounded-md transition",
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        isDragging && "opacity-50",
        isDropTarget && "ring-1 ring-primary/60",
      )}
      draggable={Boolean(onDragStart)}
      onDragStart={(event) => {
        if (!onDragStart) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", label);
        onDragStart();
      }}
      onDragOver={(event) => {
        if (!onDragOver) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(event) => {
        if (!onDrop) return;
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      {onDragStart ? <GripVertical className="ml-1 size-3 shrink-0 cursor-grab text-muted-foreground/70" aria-hidden="true" /> : null}
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-xs"
        onClick={onClick}
      >
        {pinned && <Pin className="size-3 shrink-0 text-primary" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {working && <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" aria-label="工作中" />}
        {!working && unread && <span className="size-2 shrink-0 rounded-full bg-muted-foreground" aria-label="未读" />}
      </button>
      {onPin ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-5 shrink-0 text-muted-foreground hover:text-primary"
          aria-label={`${pinned ? "取消置顶" : "置顶"}最近项 ${label}`}
          title={pinned ? "取消置顶" : "置顶"}
          onClick={onPin}
        >
          <Pin className={cn("size-3", pinned && "fill-current")} />
        </Button>
      ) : null}
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="mr-0.5 size-5 shrink-0 text-muted-foreground"
          aria-label={`关闭最近项 ${label}`}
          onClick={onClose}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}

function globalNavIcon(kind: ShellRoute["kind"]) {
  switch (kind) {
    case "search": return Search;
    case "routines": return Wrench;
    case "knowledge": return BookMarked;
    case "scheduled-tasks": return CalendarClock;
    case "learn": return BookOpen;
    default: return Settings;
  }
}

export function ShellSidebar({
  route,
  books,
  sessions,
  onNavigate,
  onDeleteBook,
  recentTabs = [],
  onRemoveRecentTab,
  onPinRecentTab,
  onMoveRecentTab,
  onClearInactiveRecentTabs,
  onLogout,
  onOpenSessionDrawer,
  collapsed = false,
  onToggleCollapse,
  mode = "desktop",
  onCloseMobile,
}: ShellSidebarProps) {
  const isMobile = mode === "mobile";
  const isCollapsed = !isMobile && collapsed;
  const [draggedRecentTabKey, setDraggedRecentTabKey] = useState<string | null>(null);
  const [dropTargetRecentTabKey, setDropTargetRecentTabKey] = useState<string | null>(null);
  const items = getShellNavItems({ books, sessions });
  const bookItems = items.filter((item) => item.group === "books");
  const narratorItems = items.filter((item) => item.group === "narrators");
  const resolvedRecentNarrators = resolveRecentNarrators(recentTabs, sessions)
    .filter((entry) => entry.session?.status === "active");
  const recentNarratorItems = resolvedRecentNarrators.map(({ tab, narratorId, session }) => ({
    id: `recent:${tab.type}:${tab.id}`,
    label: tab.title || session?.title || "未命名叙述者",
    group: "narrators" as const,
    route: { kind: "narrator" as const, sessionId: narratorId },
    unread: session?.unread,
    working: session?.working ?? tab.status === "working",
    pinned: tab.pinned,
  }));
  const effectiveNarratorItems = recentTabs.length > 0 ? recentNarratorItems : narratorItems;
  const visibleNarratorItems = effectiveNarratorItems.slice(0, 5);
  const hiddenNarratorCount = Math.max(0, effectiveNarratorItems.length - visibleNarratorItems.length);
  const recentTabByNarratorId = new Map(
    resolvedRecentNarrators.map((entry) => [entry.narratorId, entry.tab]),
  );
  const recentTabsByKey = new Map(recentTabs.map((tab) => [recentTabKey(tab), tab]));
  const clearRecentDrag = () => {
    setDraggedRecentTabKey(null);
    setDropTargetRecentTabKey(null);
  };
  const globalItems = items.filter((item) => item.group === "global");

  // 侧栏底部可配置显示/收纳
  const SIDEBAR_COLLAPSED_KEY = "novelfork-sidebar-collapsed";
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [showCollapsed, setShowCollapsed] = useState(false);

  const persistCollapsed = useCallback((next: Set<string>) => {
    setCollapsedIds(next);
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify([...next])); } catch {}
  }, []);

  const toggleItemCollapsed = useCallback((itemId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      persistCollapsed(next);
      return next;
    });
  }, [persistCollapsed]);

  const visibleGlobalItems = useMemo(() => globalItems.filter((item) => !collapsedIds.has(item.id)), [globalItems, collapsedIds]);
  const collapsedGlobalItems = useMemo(() => globalItems.filter((item) => collapsedIds.has(item.id)), [globalItems, collapsedIds]);

  return (
    <TooltipProvider>
      <aside
        aria-label="NovelFork 主导航"
        className={cn(
          "flex h-full shrink-0 flex-col bg-card transition-[width] duration-200",
          isMobile ? "w-full" : "border-r border-border",
          !isMobile && (isCollapsed ? "w-12" : "w-[250px]"),
        )}
        data-slot="shell-sidebar"
        data-testid="shell-sidebar"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-2 py-2" role="banner">
          {!isCollapsed && (
            <div className="min-w-0 px-1">
              <p className="truncate text-sm font-semibold">NovelFork Studio</p>
              <p className="text-[10px] text-muted-foreground">Agent Shell</p>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={isMobile ? onCloseMobile : onToggleCollapse}
            aria-label={isMobile ? "关闭主导航" : isCollapsed ? "展开侧栏" : "折叠侧栏"}
          >
            {isMobile || !isCollapsed ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-1.5 py-3">
          {/* Books section */}
          <section className="flex flex-col gap-1" aria-label="叙事线（书籍）" data-tour-id="sidebar-books">
            {!isCollapsed && (
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors"
                onClick={() => onNavigate({ kind: "books" })}
              >
                <BookOpen className="h-3.5 w-3.5" />
                叙事线（书籍）
              </button>
            )}
            {isCollapsed && (
              <Tooltip>
                <TooltipTrigger
                  className="flex w-full items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => onNavigate({ kind: "books" })}
                >
                  <BookOpen className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">叙事线（书籍）</TooltipContent>
              </Tooltip>
            )}
            {bookItems.length > 0
              ? bookItems.map((item) => {
                const isActive = isShellNavItemActive(item, route);
                return (
                  <div key={item.id}>
                    <NavButton label={item.label} active={isActive} onClick={() => onNavigate(item.route)} collapsed={isCollapsed} />
                  </div>
                );
              })
              : !isCollapsed && <p className="px-2 py-1 text-xs text-muted-foreground">暂无书籍</p>
            }
            {!isCollapsed && (
              <Button
                variant="link"
                size="xs"
                className="mt-1 flex w-full items-center rounded-md px-2 py-1 text-left text-xs font-medium text-primary hover:bg-primary/10"
                onClick={() => onNavigate({ kind: "home" })}
              >
                新建作品
              </Button>
            )}
          </section>

          {/* Narrators section */}
          <section className="flex flex-col gap-1" aria-label="叙述者" data-tour-id="sidebar-narrators">
            {!isCollapsed && (
              <div className="flex items-center justify-between px-2">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  最近会话
                </h2>
                <div className="flex items-center gap-0.5">
                  {recentNarratorItems.length > 0 && onClearInactiveRecentTabs ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-5 text-muted-foreground hover:text-primary"
                      onClick={onClearInactiveRecentTabs}
                      title="清理不活跃最近标签"
                      aria-label="清理不活跃最近标签"
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                  {onOpenSessionDrawer ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-5 text-muted-foreground hover:text-primary"
                      onClick={onOpenSessionDrawer}
                      title="打开会话抽屉"
                      aria-label="打开会话抽屉"
                    >
                      <PanelRightOpen />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 text-muted-foreground hover:text-primary"
                    onClick={() => onNavigate({ kind: "sessions", create: true })}
                    title="新建叙述者"
                  >
                    <span className="text-sm leading-none">+</span>
                  </Button>
                </div>
              </div>
            )}
            {isCollapsed && (
              <Tooltip>
                <TooltipTrigger
                  className="flex w-full items-center justify-center rounded-md p-1.5 text-muted-foreground"
                  onClick={onOpenSessionDrawer}
                  aria-label="打开会话抽屉"
                >
                  <MessageSquareText className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">打开会话抽屉</TooltipContent>
              </Tooltip>
            )}
            {visibleNarratorItems.length > 0
              ? visibleNarratorItems.map((item) => {
                const tab = recentTabByNarratorId.get(item.route.sessionId);
                return (
                  <NarratorNavButton
                    key={item.id}
                    item={item as ShellNavItem & { group: "narrators" }}
                    active={isShellNavItemActive(item, route)}
                    onClick={() => onNavigate(item.route)}
                    onClose={tab && onRemoveRecentTab ? () => onRemoveRecentTab(tab) : undefined}
                    onPin={tab && onPinRecentTab ? () => onPinRecentTab(tab, !tab.pinned) : undefined}
                    onDragStart={tab && onMoveRecentTab ? () => setDraggedRecentTabKey(recentTabKey(tab)) : undefined}
                    onDragOver={tab && onMoveRecentTab ? () => {
                      const source = draggedRecentTabKey ? recentTabsByKey.get(draggedRecentTabKey) : undefined;
                      if (source && source.pinned === tab.pinned) setDropTargetRecentTabKey(recentTabKey(tab));
                      else setDropTargetRecentTabKey(null);
                    } : undefined}
                    onDrop={tab && onMoveRecentTab ? () => {
                      const source = draggedRecentTabKey ? recentTabsByKey.get(draggedRecentTabKey) : undefined;
                      if (source && source.pinned === tab.pinned && recentTabKey(source) !== recentTabKey(tab)) onMoveRecentTab(source, tab);
                      clearRecentDrag();
                    } : undefined}
                    onDragEnd={clearRecentDrag}
                    isDragging={Boolean(tab && draggedRecentTabKey === recentTabKey(tab))}
                    isDropTarget={Boolean(tab && dropTargetRecentTabKey === recentTabKey(tab))}
                    collapsed={isCollapsed}
                  />
                );
              })
              : !isCollapsed && <p className="px-2 py-1 text-xs text-muted-foreground">暂无最近会话</p>
            }
            {!isCollapsed && hiddenNarratorCount > 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground">还有 {hiddenNarratorCount} 个会话</p>}
            {!isCollapsed && (
              <Button
                variant="link"
                size="xs"
                className="mt-1 flex w-full items-center rounded-md px-2 py-1 text-left text-xs font-medium text-primary hover:bg-primary/10"
                onClick={() => onNavigate({ kind: "sessions" })}
              >
                查看全部叙述者
              </Button>
            )}
          </section>
        </div>

        {/* Bottom nav */}
        <nav className="flex flex-col gap-0.5 border-t border-border px-1.5 py-2" aria-label="全局入口">
          {visibleGlobalItems.map((item) => {
            const Icon = globalNavIcon(item.route.kind);
            const isActive = isShellNavItemActive(item, route);

            if (isCollapsed) {
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger
                    className={cn(
                      "flex w-full items-center justify-center rounded-md p-1.5 transition-colors",
                      isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    onClick={() => onNavigate(item.route)}
                  >
                    <Icon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Button
                key={item.id}
                variant="ghost"
                size="sm"
                aria-current={isActive ? "page" : undefined}
                className="w-full justify-start gap-2 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
                onClick={() => onNavigate(item.route)}
                onContextMenu={(e) => { e.preventDefault(); toggleItemCollapsed(item.id); }}
                data-tour-id={item.route.kind === "learn" ? "sidebar-learn" : undefined}
              >
                <Icon data-icon="inline-start" />
                {item.label}
              </Button>
            );
          })}
          {!isCollapsed && collapsedGlobalItems.length > 0 && (
            <div className="mt-1">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                onClick={() => setShowCollapsed((v) => !v)}
              >
                <PackageMinus className="size-3" />
                已收纳 ({collapsedGlobalItems.length})
                {showCollapsed ? <ChevronUp className="ml-auto size-3" /> : <ChevronDown className="ml-auto size-3" />}
              </button>
              {showCollapsed && (
                <div className="mt-0.5 flex flex-col gap-0.5 pl-1">
                  {collapsedGlobalItems.map((item) => {
                    const Icon = globalNavIcon(item.route.kind);
                    const isActive = isShellNavItemActive(item, route);
                    return (
                      <Button
                        key={item.id}
                        variant="ghost"
                        size="sm"
                        aria-current={isActive ? "page" : undefined}
                        className="w-full justify-start gap-2 text-xs opacity-70 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
                        onClick={() => onNavigate(item.route)}
                        onContextMenu={(e) => { e.preventDefault(); toggleItemCollapsed(item.id); }}
                      >
                        <Icon data-icon="inline-start" />
                        {item.label}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {onLogout ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
              onClick={onLogout}
            >
              <LogOut data-icon="inline-start" />
              {!isCollapsed ? "退出登录" : null}
            </Button>
          ) : null}
        </nav>
      </aside>
    </TooltipProvider>
  );
}
