import { type ReactNode, useEffect, useRef, useState } from "react";
import { MessageSquareText, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NarratorWorkspaceDrawer } from "./NarratorWorkspaceDrawer";
import { ShellSidebar } from "./ShellSidebar";
import { recentTabNarratorId, type ShellBookItem, type ShellRecentTabItem, type ShellRoute, type ShellSessionItem } from "./shell-route";

export interface AgentShellProps {
  readonly route: ShellRoute;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly recentTabs?: readonly ShellRecentTabItem[];
  readonly onNavigate: (route: ShellRoute) => void;
  readonly onDeleteBook?: (bookId: string) => void;
  readonly onRemoveRecentTab?: (tab: ShellRecentTabItem) => void;
  readonly onPinRecentTab?: (tab: ShellRecentTabItem, pinned: boolean) => void;
  readonly onMoveRecentTab?: (tab: ShellRecentTabItem, target: ShellRecentTabItem) => void;
  readonly onClearInactiveRecentTabs?: () => void;
  readonly onLogout?: () => void;
  readonly children: ReactNode;
}

function useRecentNarratorKeyboardNavigation({
  route,
  recentTabs,
  sessions,
  onNavigate,
}: {
  readonly route: ShellRoute;
  readonly recentTabs: readonly ShellRecentTabItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly onNavigate: (route: ShellRoute) => void;
}): void {
  const pendingNarratorIdRef = useRef<string | null>(null);
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT"
        || target?.tagName === "TEXTAREA"
        || target?.tagName === "SELECT"
        || target?.isContentEditable
      ) return;

      const activeSessionIds = new Set(
        sessions.filter((session) => session.status === "active").map((session) => session.id),
      );
      const narratorIds: string[] = [];
      const seen = new Set<string>();
      for (const tab of recentTabs) {
        const narratorId = recentTabNarratorId(tab);
        if (!narratorId || seen.has(narratorId) || !activeSessionIds.has(narratorId)) continue;
        seen.add(narratorId);
        narratorIds.push(narratorId);
      }
      if (narratorIds.length === 0) return;

      const currentId = pendingNarratorIdRef.current ?? (route.kind === "narrator" ? route.sessionId : null);
      const currentIndex = currentId ? narratorIds.indexOf(currentId) : -1;
      const nextIndex = event.key === "ArrowDown"
        ? currentIndex < 0 ? 0 : (currentIndex + 1) % narratorIds.length
        : currentIndex < 0 ? narratorIds.length - 1 : (currentIndex - 1 + narratorIds.length) % narratorIds.length;
      const nextNarratorId = narratorIds[nextIndex];
      if (!nextNarratorId) return;

      event.preventDefault();
      pendingNarratorIdRef.current = nextNarratorId;
      if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = setTimeout(() => {
        navigationTimerRef.current = null;
        const pendingId = pendingNarratorIdRef.current;
        pendingNarratorIdRef.current = null;
        if (pendingId) onNavigate({ kind: "narrator", sessionId: pendingId });
      }, 400);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = null;
      pendingNarratorIdRef.current = null;
    };
  }, [onNavigate, recentTabs, route, sessions]);
}

export function AgentShell({
  route,
  books,
  sessions,
  recentTabs = [],
  onNavigate,
  onDeleteBook,
  onRemoveRecentTab,
  onPinRecentTab,
  onMoveRecentTab,
  onClearInactiveRecentTabs,
  onLogout,
  children,
}: AgentShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const desktopQuery = window.matchMedia("(min-width: 768px)");
    const closeMobileNavigation = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setMobileNavigationOpen(false);
    };
    closeMobileNavigation(desktopQuery);
    desktopQuery.addEventListener("change", closeMobileNavigation);
    return () => desktopQuery.removeEventListener("change", closeMobileNavigation);
  }, []);

  const navigateFromMobile = (nextRoute: ShellRoute) => {
    setMobileNavigationOpen(false);
    onNavigate(nextRoute);
  };

  useRecentNarratorKeyboardNavigation({ route, recentTabs, sessions, onNavigate });

  return (
    <div className="flex h-dvh bg-background text-foreground" data-slot="agent-shell" data-testid="agent-shell">
      <div className="hidden h-full shrink-0 md:block">
        <ShellSidebar
          route={route}
          books={books}
          sessions={sessions}
          onNavigate={onNavigate}
          onDeleteBook={onDeleteBook}
          recentTabs={recentTabs}
          onRemoveRecentTab={onRemoveRecentTab}
          onPinRecentTab={onPinRecentTab}
          onMoveRecentTab={onMoveRecentTab}
          onClearInactiveRecentTabs={onClearInactiveRecentTabs}
          onLogout={onLogout}
          onOpenSessionDrawer={() => setSessionDrawerOpen(true)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((current) => !current)}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-slot="mobile-shell-header"
          className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:hidden"
        >
          <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="打开主导航"
                aria-expanded={mobileNavigationOpen}
              >
                <PanelLeftOpen />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-[min(20rem,calc(100vw-3rem))] gap-0 p-0 sm:max-w-none"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>NovelFork 主导航</SheetTitle>
                <SheetDescription>访问书籍、叙述者、学习中心与设置。</SheetDescription>
              </SheetHeader>
              <ShellSidebar
                mode="mobile"
                route={route}
                books={books}
                sessions={sessions}
                onNavigate={navigateFromMobile}
                onDeleteBook={onDeleteBook}
                recentTabs={recentTabs}
        onRemoveRecentTab={onRemoveRecentTab}
        onPinRecentTab={onPinRecentTab}
        onMoveRecentTab={onMoveRecentTab}
        onClearInactiveRecentTabs={onClearInactiveRecentTabs}
      />
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">NovelFork Studio</p>
            <p className="truncate text-[10px] text-muted-foreground">Agent Shell</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="打开会话抽屉"
            aria-expanded={sessionDrawerOpen}
            onClick={() => setSessionDrawerOpen(true)}
          >
            <MessageSquareText />
          </Button>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="shell-main">
          {children}
        </main>
      </div>

      <NarratorWorkspaceDrawer
        open={sessionDrawerOpen}
        onOpenChange={setSessionDrawerOpen}
        activeNarratorId={route.kind === "narrator" ? route.sessionId : undefined}
        recentTabs={recentTabs}
        sessions={sessions}
        onOpenNarrator={(narratorId) => onNavigate({ kind: "narrator", sessionId: narratorId })}
        onRemoveRecentTab={onRemoveRecentTab}
        onPinRecentTab={onPinRecentTab}
        onMoveRecentTab={onMoveRecentTab}
        onClearInactiveRecentTabs={onClearInactiveRecentTabs}
      />
    </div>
  );
}
