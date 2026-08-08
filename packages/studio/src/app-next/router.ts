import { createRouter, createRootRoute, createRoute, redirect } from "@tanstack/react-router";
import { resolvePrimaryNarratorForChapter } from "./search/runtime-search";

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

const booksListRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/books",
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

const knowledgeRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/knowledge",
});

const scheduledTasksRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/scheduled-tasks",
});

const settingsRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/settings",
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/settings/$section",
});

const learnRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/learn",
});

// Native NarraFork components keep their canonical navigation targets. These
// compatibility routes translate them into the NovelFork product shell instead
// of letting the catch-all discard narrator/settings intent.
const nativeNarratorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/narrators/$narratorId",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/next/narrators/$sessionId", params: { sessionId: params.narratorId } });
  },
});

const nativeNarratorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/narrators",
  beforeLoad: () => { throw redirect({ to: "/next/sessions" }); },
});

const nativeChapterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chapters/$chapterId",
  beforeLoad: async ({ params, location }) => {
    const primaryNarratorId = await resolvePrimaryNarratorForChapter(params.chapterId);
    if (!primaryNarratorId) throw redirect({ to: "/next/sessions" });
    throw redirect({
      to: "/next/narrators/$sessionId",
      params: { sessionId: primaryNarratorId },
      hash: location.hash,
      replace: true,
    });
  },
});

const nativeSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/next/settings/$section",
      params: { section: "profile" },
      search: location.search as never,
      hash: location.hash,
    });
  },
});

const nativeSettingsSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/next/settings/$section",
      params: { section: params.section },
      search: location.search as never,
      hash: location.hash,
    });
  },
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
    booksListRoute,
    sessionsRoute,
    searchRoute,
    routinesRoute,
    knowledgeRoute,
    scheduledTasksRoute,
    settingsRoute,
    settingsSectionRoute,
    learnRoute,
  ]),
  nativeNarratorRoute,
  nativeNarratorsRoute,
  nativeChapterRoute,
  nativeSettingsRoute,
  nativeSettingsSectionRoute,
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

export { rootRoute, nextRoute, homeRoute, narratorRoute, bookRoute, booksListRoute, sessionsRoute, searchRoute, routinesRoute, knowledgeRoute, scheduledTasksRoute, settingsRoute, settingsSectionRoute, learnRoute };
