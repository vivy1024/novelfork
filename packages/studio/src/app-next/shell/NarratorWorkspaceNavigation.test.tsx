import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RouterProvider, useNavigate, useRouterState } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";

import { AgentShell } from "./AgentShell";
import { parseShellRoute, toShellPath, type ShellRoute } from "./shell-route";
import { createTestRouter } from "../test-helpers/router-harness";

const sessions = [
  { id: "session-a", title: "会话 A", status: "active" as const },
  { id: "session-b", title: "会话 B", status: "active" as const },
];
const recentTabs = [
  { type: "narrator" as const, id: "session-b", title: "会话 B", lastVisitedAt: 20 },
  { type: "narrator" as const, id: "session-a", title: "会话 A", lastVisitedAt: 10 },
];

afterEach(() => cleanup());

function WorkspaceRouteHarness() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const route = parseShellRoute(pathname);
  const navigate = useNavigate();
  const onNavigate = (next: ShellRoute) => { void navigate({ to: toShellPath(next) }); };
  return (
    <AgentShell
      route={route}
      books={[]}
      sessions={sessions}
      recentTabs={recentTabs}
      onNavigate={onNavigate}
    >
      <div data-testid="active-workspace-route">{route.kind === "narrator" ? route.sessionId : route.kind}</div>
    </AgentShell>
  );
}

describe("Narrator workspace route restoration", () => {
  it("restores the URL on refresh and follows browser back/forward between narrators", async () => {
    const router = createTestRouter(WorkspaceRouteHarness, "/next/narrators/session-a");
    render(<RouterProvider router={router} />);

    expect((await screen.findByTestId("active-workspace-route")).textContent).toBe("session-a");
    fireEvent.click(screen.getByRole("button", { name: "会话 B" }));
    expect((await screen.findByTestId("active-workspace-route")).textContent).toBe("session-b");

    await act(async () => {
      router.history.back();
      await router.load();
    });
    expect(screen.getByTestId("active-workspace-route").textContent).toBe("session-a");

    await act(async () => {
      router.history.forward();
      await router.load();
    });
    expect(screen.getByTestId("active-workspace-route").textContent).toBe("session-b");
  });
});
