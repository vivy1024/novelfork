import { BookOpen, MessageSquareText, Search, Settings, Wrench, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { getShellNavItems, isShellNavItemActive, type ShellBookItem, type ShellRoute, type ShellSessionItem } from "./shell-route";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export interface ShellSidebarProps {
  readonly route: ShellRoute;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly onNavigate: (route: ShellRoute) => void;
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

export function ShellSidebar({ route, books, sessions, onNavigate, collapsed = false, onToggleCollapse }: ShellSidebarProps) {
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
          <section className="space-y-1" aria-label="叙事线">
            {!collapsed && (
              <h2 className="flex items-center gap-1.5 px-2 text-xs font-semibold text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" />
                叙事线
              </h2>
            )}
            {collapsed && (
              <Tooltip>
                <TooltipTrigger className="flex w-full items-center justify-center rounded-md p-1.5 text-muted-foreground">
                  <BookOpen className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">叙事线</TooltipContent>
              </Tooltip>
            )}
            {bookItems.length > 0
              ? bookItems.map((item) => <NavButton key={item.id} label={item.label} active={isShellNavItemActive(item, route)} onClick={() => onNavigate(item.route)} collapsed={collapsed} />)
              : !collapsed && <p className="px-2 py-1 text-xs text-muted-foreground">暂无叙事线</p>
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
          <section className="space-y-1" aria-label="叙述者">
            {!collapsed && (
              <h2 className="flex items-center gap-1.5 px-2 text-xs font-semibold text-muted-foreground">
                <MessageSquareText className="h-3.5 w-3.5" />
                叙述者
              </h2>
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
              ? visibleNarratorItems.map((item) => <NavButton key={item.id} label={item.label} active={isShellNavItemActive(item, route)} onClick={() => onNavigate(item.route)} collapsed={collapsed} />)
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
