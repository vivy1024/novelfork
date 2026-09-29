import { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserHistory, createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { useWorkbenchNavigationGuard } from "./use-workbench-navigation-guard";

const dispose: Array<() => void> = [];
beforeEach(() => { vi.spyOn(window, "scrollTo").mockImplementation(() => undefined); });
afterEach(() => { cleanup(); dispose.splice(0).forEach((close) => close()); vi.restoreAllMocks(); });

function setup(guard: () => Promise<boolean>, browserHistory = false) {
  const root = createRootRoute({ component: Outlet });
  const book = createRoute({ getParentRoute: () => root, path: "/books/$bookId", component: () => {
    const { bookId } = book.useParams();
    const register = useWorkbenchNavigationGuard(bookId);
    useEffect(() => { register(guard); return () => register(null); }, [register, bookId]);
    return <div>正在编辑 {bookId}</div>;
  } });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <div>书架</div> });
  if (browserHistory) {
    window.history.replaceState({ __TSR_index: 0, key: "start" }, "", "/");
    window.history.pushState({ __TSR_index: 1, key: "book" }, "", "/books/a");
  }
  // Memory history 不执行 POP 守卫；后退必须用浏览器历史实现验证。
  const history = browserHistory ? createBrowserHistory() : createMemoryHistory({ initialEntries: ["/", "/books/a"], initialIndex: 1 });
  dispose.push(() => history.destroy());
  const router = createRouter({ routeTree: root.addChildren([home, book]), history });
  render(<RouterProvider router={router} />);
  return { router, history };
}

describe("Studio 离开书籍前的草稿保护", () => {
  it("切书等待工作台确认，取消不会换页，确认才进入另一书", async () => {
    let decide!: (accepted: boolean) => void;
    const guard = vi.fn(() => new Promise<boolean>((resolve) => { decide = resolve; }));
    const { router } = setup(guard);
    await screen.findByText("正在编辑 a");
    act(() => { void router.navigate({ href: "/books/b" }); });
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
    expect(screen.getByText("正在编辑 a")).toBeTruthy();
    await act(async () => { decide(false); });
    expect(router.state.location.pathname).toBe("/books/a");
    act(() => { void router.navigate({ href: "/books/b" }); });
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(2));
    await act(async () => { decide(true); });
    await screen.findByText("正在编辑 b");
  });

  it("浏览器历史后退受同一守卫保护，同页查询参数切换不弹确认", async () => {
    const guard = vi.fn(async () => false);
    const { router, history } = setup(guard, true);
    await screen.findByText("正在编辑 a");
    await act(async () => { history.back(); });
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.pathname).toBe("/books/a"));
    expect(router.state.location.pathname).toBe("/books/a");
    await act(async () => { await router.navigate({ href: "/books/a?view=write" }); });
    expect(guard).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/books/a");
  });
});
