import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import type { NarratorSessionRecord } from "../../shared/session-types";

const useWindowStoreMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("SessionCenterPage must not use windowStore");
}));

vi.mock("../../stores/windowStore", () => ({
  useWindowStore: useWindowStoreMock,
}));

vi.mock("../../components/sessions/SessionCenter", () => ({
  SessionCenter: ({ onOpenSession }: { readonly onOpenSession: (session: NarratorSessionRecord) => void }) => (
    <button
      type="button"
      onClick={() => onOpenSession({
        id: "session 1",
        title: "测试会话",
        agentId: "writer",
        kind: "standalone",
        sessionMode: "chat",
        status: "active",
        createdAt: "2026-05-06T00:00:00.000Z",
        lastModified: "2026-05-06T00:00:00.000Z",
        messageCount: 0,
        sortOrder: 0,
        sessionConfig: {
          providerId: "sub2api",
          modelId: "gpt-5.4",
          permissionMode: "edit",
          reasoningEffort: "medium",
        },
      })}
    >
      打开测试会话
    </button>
  ),
}));

import { SessionCenterPage } from "./SessionCenterPage";

// 用真实 router（浏览器 history）挂载 SessionCenterPage —— 不 mock @tanstack/react-router。
// 该用例断言 window.location.pathname，因此必须用 browser history（memory history 不会改写 window.location）。
function renderWithBrowserRouter(initialPath: string) {
  window.history.replaceState(null, "", initialPath);
  const rootRoute = createRootRoute();
  const nextRoute = createRoute({ getParentRoute: () => rootRoute, path: "/next" });
  const sessionsRoute = createRoute({ getParentRoute: () => nextRoute, path: "/sessions", component: SessionCenterPage });
  const splatRoute = createRoute({ getParentRoute: () => nextRoute, path: "$" });
  const indexRoute = createRoute({ getParentRoute: () => nextRoute, path: "/" });
  const catchAll = createRoute({ getParentRoute: () => rootRoute, path: "$" });
  const routeTree = rootRoute.addChildren([
    nextRoute.addChildren([indexRoute, sessionsRoute, splatRoute]),
    catchAll,
  ]);
  const router = createRouter({ routeTree, history: createBrowserHistory() });
  return render(<RouterProvider router={router} />);
}

describe("SessionCenterPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/next");
  });

  it("opens sessions through the live narrator route instead of windowStore shell windows", async () => {
    renderWithBrowserRouter("/next/sessions");

    fireEvent.click(await screen.findByRole("button", { name: "打开测试会话" }));

    expect(useWindowStoreMock).not.toHaveBeenCalled();
    await waitFor(() => expect(window.location.pathname).toBe("/next/narrators/session%201"));
  });
});
