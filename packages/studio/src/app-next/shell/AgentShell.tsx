import { type ReactNode, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { ShellSidebar } from "./ShellSidebar";
import type { ShellBookItem, ShellRoute, ShellSessionItem } from "./shell-route";

export interface AgentShellProps {
  readonly route: ShellRoute;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly onNavigate: (route: ShellRoute) => void;
  readonly onDeleteBook?: (bookId: string) => void;
  readonly children: ReactNode;
}

export function AgentShell({ route, books, sessions, onNavigate, onDeleteBook, children }: AgentShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen bg-background text-foreground" data-testid="agent-shell">
      <ShellSidebar
        route={route}
        books={books}
        sessions={sessions}
        onNavigate={onNavigate}
        onDeleteBook={onDeleteBook}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />
      <main className="flex h-full min-w-0 flex-1 overflow-hidden" data-testid="shell-main">
        {children}
      </main>
    </div>
  );
}
