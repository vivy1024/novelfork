import { createRouter, createRootRoute, createRoute, redirect } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Root route — 渲染由 main.tsx defaultComponent (StudioNextApp) 处理
// StudioNextApp 内部通过 useRouterState/useNavigate 与 router 交互
// ---------------------------------------------------------------------------

const rootRoute = createRootRoute();

// ---------------------------------------------------------------------------
// 路由定义（类型安全的路由参数）
// ---------------------------------------------------------------------------

const nextRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/next",
});

const homeRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/",
});

const narratorRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/narrators/$sessionId",
});

const bookRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/books/$bookId",
});

const sessionsRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/sessions",
});

const searchRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/search",
});

const routinesRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/routines",
});

const settingsRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/settings",
});

// Catch-all: redirect to /next
const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  beforeLoad: () => { throw redirect({ to: "/next" }); },
});

// ---------------------------------------------------------------------------
// Route tree + Router instance
// ---------------------------------------------------------------------------

const routeTree = rootRoute.addChildren([
  nextRoute.addChildren([
    homeRoute,
    narratorRoute,
    bookRoute,
    sessionsRoute,
    searchRoute,
    routinesRoute,
    settingsRoute,
  ]),
  catchAllRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

// Type registration for type-safe navigation
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export { rootRoute, nextRoute, homeRoute, narratorRoute, bookRoute, sessionsRoute, searchRoute, routinesRoute, settingsRoute };
