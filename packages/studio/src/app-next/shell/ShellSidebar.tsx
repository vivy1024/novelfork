import { BookOpen, MessageSquareText, Search, Settings, Wrench, PanelLeftClose, PanelLeftOpen, Pin } from "lucide-react";

import { getShellNavItems, isShellNavItemActive, type ShellBookItem, type ShellNavItem, type ShellRoute, type ShellSessionItem } from "./shell-route";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export interface ShellSidebarProps {
  readonly route: ShellRoute;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly onNavigate: (route: ShellRoute) => void;
  readonly onDeleteBook?: (bookId: string) => void;
  readonly collapsed?: boolean;
  readonly onToggleCollapse?: () => void;
}

function NavButton({ label, active, onClick, collapsed }: { readonly label: string; readonly active: boolean; readonly onClick: () => void; readonly collapsed?: boolean }) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          className={`flex w-full items-center justify-center rounded-md p-1.5 text-xs transition ${
            active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          onClick={onClick}
        >
          <span className="text-[10px] font-bold">{label.charAt(0).toUpperCase()}</span>
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
      className={`flex w-full items-center rounded-md px-2 py-1 text-left text-xs transition ${
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
    </Button>
  );
}

function NarratorNavButton({ item, active, onClick, collapsed }: { readonly item: ShellNavItem & { group: "narrators" }; readonly active: boolean; readonly onClick: () => void; readonly collapsed?: boolean }) {
  const { label, unread, working, pinned } = item;

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          className={`relative flex w-full items-center justify-center rounded-md p-1.5 text-xs transition ${
            active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          onClick={onClick}
        >
          <span className="text-[10px] font-bold">{label.charAt(0).toUpperCase()}</span>
          {(unread || working) && (
            <span className={`absolute right-0.5 top-0.5 size-1.5 rounded-full ${working ? "bg-green-500 animate-pulse" : "bg-blue-500"}`} />
          )}
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
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition ${
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      onClick={onClick}
    >
      {pinned && <Pin className="size-3 shrink-0 text-amber-500" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {working && <span className="size-2 shrink-0 rounded-full bg-green-500 animate-pulse" aria-label="工作中" />}
      {!working && unread && <span className="size-2 shrink-0 rounded-full bg-blue-500" aria-label="未读" />}
    </Button>
  );
}

export function ShellSidebar({ route, books, sessions, onNavigate, onDeleteBook, collapsed = false, onToggleCollapse }: ShellSidebarProps) {
  const items = getShellNavItems({ books, sessions });
  const bookItems = items.filter((item) => item.group === "books");
  const narratorItems = items.filter((item) => item.group === "narrators");
  const visibleNarratorItems = narratorItems.slice(0, 5);
  const hiddenNarratorCount = Math.max(0, narratorItems.length - visibleNarratorItems.length);
  const globalItems = items.filter((item) => item.group === "global");

  return (
    <TooltipProvider>
      <aside
        className={`flex h-full shrink-0 flex-col border-r border-border bg-card transition-all duration-200 ${collapsed ? "w-12" : "w-[250px]"}`}
        data-testid="shell-sidebar"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-2 py-2" role="banner">
          {!collapsed && (
            <div className="min-w-0 px-1">
              <p className="text-sm font-semibold truncate">NovelFork Studio</p>
              <p className="text-[10px] text-muted-foreground">Agent Shell</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapse}
            title={collapsed ? "展开侧栏" : "折叠侧栏"}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto px-1.5 py-3">
          {/* Books section */}
          <section className="space-y-1" aria-label="叙事线（书籍）" data-tour-id="sidebar-books">
            {!collapsed && (
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors"
                onClick={() => onNavigate({ kind: "books" })}
              >
                <BookOpen className="h-3.5 w-3.5" />
                叙事线（书籍）
              </button>
            )}
            {collapsed && (
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
                const bookId = item.route.bookId;
                // Show bound Agent sessions when book is active OR when viewing one of its agents
                const allBookAgents = sessions.filter((s) => s.projectId === bookId && s.status === "active");
                const isViewingBookAgent = route.kind === "narrator" && allBookAgents.some((s) => s.id === route.sessionId);
                const shouldExpand = isActive || isViewingBookAgent;
                const bookAgents = shouldExpand ? allBookAgents : [];
                return (
                  <div key={item.id}>
                    <NavButton label={item.label} active={isActive || isViewingBookAgent} onClick={() => onNavigate(item.route)} collapsed={collapsed} />
                    {!collapsed && bookAgents.length > 0 && (
                      <div className="ml-3 space-y-0.5 border-l border-border pl-2">
                        {bookAgents.map((agent) => (
                          <button
                            key={agent.id}
                            type="button"
                            className={`w-full truncate rounded px-2 py-0.5 text-left text-[11px] ${
                              route.kind === "narrator" && route.sessionId === agent.id
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                            onClick={() => onNavigate({ kind: "narrator", sessionId: agent.id })}
                          >
                            {agent.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
              : !collapsed && <p className="px-2 py-1 text-xs text-muted-foreground">暂无书籍</p>
            }
            {!collapsed && (
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
          <section className="space-y-1" aria-label="叙述者" data-tour-id="sidebar-narrators">
            {!collapsed && (
              <div className="flex items-center justify-between px-2">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  叙述者
                </h2>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-5 text-muted-foreground hover:text-primary"
                  onClick={() => onNavigate({ kind: "sessions" })}
                  title="新建叙述者"
                >
                  <span className="text-sm leading-none">+</span>
                </Button>
              </div>
            )}
            {collapsed && (
              <Tooltip>
                <TooltipTrigger className="flex w-full items-center justify-center rounded-md p-1.5 text-muted-foreground">
                  <MessageSquareText className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">叙述者</TooltipContent>
              </Tooltip>
            )}
            {visibleNarratorItems.length > 0
              ? visibleNarratorItems.map((item) => <NarratorNavButton key={item.id} item={item as ShellNavItem & { group: "narrators" }} active={isShellNavItemActive(item, route)} onClick={() => onNavigate(item.route)} collapsed={collapsed} />)
              : !collapsed && <p className="px-2 py-1 text-xs text-muted-foreground">暂无活跃会话</p>
            }
            {!collapsed && hiddenNarratorCount > 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground">还有 {hiddenNarratorCount} 个会话</p>}
            {!collapsed && (
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
        <nav className="space-y-0.5 border-t border-border px-1.5 py-2" aria-label="全局入口">
          {globalItems.map((item) => {
            const Icon = item.route.kind === "search" ? Search : item.route.kind === "routines" ? Wrench : Settings;
            const isActive = isShellNavItemActive(item, route);

            if (collapsed) {
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger
                    className={`flex w-full items-center justify-center rounded-md p-1.5 transition-colors ${
                      isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
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
                data-tour-id={item.route.kind === "learn" ? "sidebar-learn" : undefined}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Button>
            );
          })}
        </nav>
      </aside>
    </TooltipProvider>
  );
}
