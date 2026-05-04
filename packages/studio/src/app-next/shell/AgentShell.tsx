import type { ReactNode } from "react";

import { ShellSidebar } from "./ShellSidebar";
import type { ShellBookItem, ShellRoute, ShellSessionItem } from "./shell-route";

export interface AgentShellProps {
  readonly route: ShellRoute;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly onNavigate: (route: ShellRoute) => void;
  readonly children: ReactNode;
}

export function AgentShell({ route, books, sessions, onNavigate, children }: AgentShellProps) {
  return (
    <div className="flex h-screen bg-background text-foreground" data-testid="agent-shell">
      <ShellSidebar route={route} books={books} sessions={sessions} onNavigate={onNavigate} />
      <main className="flex min-w-0 flex-1 overflow-hidden" data-testid="shell-main">
        {children}
      </main>
    </div>
  );
}
