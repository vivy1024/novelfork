import { BookOpen, MessageSquareText, Search, Settings, Wrench } from "lucide-react";

import { getShellNavItems, isShellNavItemActive, type ShellBookItem, type ShellRoute, type ShellSessionItem } from "./shell-route";

export interface ShellSidebarProps {
  readonly route: ShellRoute;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly onNavigate: (route: ShellRoute) => void;
}

function NavButton({ label, active, onClick }: { readonly label: string; readonly active: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center rounded-md px-2 py-1 text-left text-xs transition ${
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

export function ShellSidebar({ route, books, sessions, onNavigate }: ShellSidebarProps) {
  const items = getShellNavItems({ books, sessions });
  const bookItems = items.filter((item) => item.group === "books");
  const narratorItems = items.filter((item) => item.group === "narrators");
  const visibleNarratorItems = narratorItems.slice(0, 5);
  const hiddenNarratorCount = Math.max(0, narratorItems.length - visibleNarratorItems.length);
  const globalItems = items.filter((item) => item.group === "global");

  return (
    <aside className="flex h-full w-[250px] shrink-0 flex-col border-r border-border bg-card" data-testid="shell-sidebar">
      <div className="border-b border-border px-3 py-2" role="banner">
        <p className="text-sm font-semibold">NovelFork Studio</p>
        <p className="text-[10px] text-muted-foreground">Agent Shell</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <section className="space-y-1" aria-label="叙事线">
          <h2 className="flex items-center gap-1.5 px-2 text-xs font-semibold text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            叙事线
          </h2>
          {bookItems.length > 0 ? bookItems.map((item) => <NavButton key={item.id} label={item.label} active={isShellNavItemActive(item, route)} onClick={() => onNavigate(item.route)} />) : <p className="px-2 py-1 text-xs text-muted-foreground">暂无叙事线</p>}
        </section>

        <section className="space-y-1" aria-label="叙述者">
          <h2 className="flex items-center gap-1.5 px-2 text-xs font-semibold text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5" />
            叙述者
          </h2>
          {visibleNarratorItems.length > 0 ? visibleNarratorItems.map((item) => <NavButton key={item.id} label={item.label} active={isShellNavItemActive(item, route)} onClick={() => onNavigate(item.route)} />) : <p className="px-2 py-1 text-xs text-muted-foreground">暂无活跃会话</p>}
          {hiddenNarratorCount > 0 ? <p className="px-2 py-1 text-[11px] text-muted-foreground">还有 {hiddenNarratorCount} 个会话</p> : null}
          <button
            type="button"
            className="mt-1 flex w-full items-center rounded-md px-2 py-1 text-left text-xs font-medium text-primary hover:bg-primary/10"
            onClick={() => onNavigate({ kind: "sessions" })}
          >
            查看全部叙述者
          </button>
        </section>
      </div>

      <nav className="space-y-0.5 border-t border-border px-2 py-2" aria-label="全局入口">
        {globalItems.map((item) => {
          const Icon = item.route.kind === "search" ? Search : item.route.kind === "routines" ? Wrench : Settings;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isShellNavItemActive(item, route) ? "page" : undefined}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
              onClick={() => onNavigate(item.route)}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
