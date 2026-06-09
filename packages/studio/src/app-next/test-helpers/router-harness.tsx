import type { ReactNode } from "react";
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
} from "@tanstack/react-router";

/**
 * 测试用真实 Router 包裹。
 *
 * 不 mock @tanstack/react-router —— 用真实 router + memory history，
 * 让被测组件在真实路由上下文中渲染（useRouterState/useNavigate 真实工作）。
 *
 * 用法：renderWithRouter(StudioNextApp, "/next/routines")
 * 组件作为 root 的 defaultComponent 渲染，与生产 main.tsx 一致。
 */
export function createTestRouter(component: () => ReactNode, initialPath = "/next") {
  const rootRoute = createRootRoute({ component: component as never });
  const nextRoute = createRoute({ getParentRoute: () => rootRoute, path: "/next" });
  const splatRoute = createRoute({ getParentRoute: () => nextRoute, path: "$" });
  const indexRoute = createRoute({ getParentRoute: () => nextRoute, path: "/" });
  const catchAll = createRoute({ getParentRoute: () => rootRoute, path: "$" });
  const routeTree = rootRoute.addChildren([
    nextRoute.addChildren([indexRoute, splatRoute]),
    catchAll,
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

/** 返回一个可直接 render 的 <RouterProvider>，包裹真实 router。 */
export function RouterTestHarness({ component, initialPath }: { component: () => ReactNode; initialPath?: string }) {
  const router = createTestRouter(component, initialPath);
  return <RouterProvider router={router} />;
}
