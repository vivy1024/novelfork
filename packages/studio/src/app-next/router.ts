import { createRouter, createRootRoute, createRoute, redirect } from "@tanstack/react-router";
import { resolvePrimaryNarratorForChapter } from "./runtime/primary-narrator";
import { STUDIO_NEXT_BASE_PATH } from "./shell/shell-route";

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

// 嵌入的 Runtime 原页在本入口内的子路径（知识条目、定时任务详情、套路页的工具权限、设置的二级页……），
// 见 shell-route 的 RuntimePageRoute；套路页与设置页的 NovelFork 面板（/next/<入口>/novelfork/…）也落在这里，
// 由 shell-route 区分。
const runtimePageSubRoutes = ["search", "routines", "knowledge", "scheduled-tasks", "learn", "settings"].map((section) =>
  createRoute({
    getParentRoute: () => nextRoute,
    path: `/${section}/$`,
  }),
);

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

const marketRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/market",
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

// Runtime 设置的二级路径（如 /settings/plugins/<id>）整页打开时转到产品入口的对应地址。
const nativeSettingsDeepRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$",
  beforeLoad: ({ location }) => {
    throw redirect({ href: `${STUDIO_NEXT_BASE_PATH}${location.href}`, replace: true });
  },
});

// Runtime 原页的路径整页打开时（新标签页、没经过嵌入路由的链接）转到对应的产品入口。
const nativeRuntimePageRoutes = ["search", "knowledge", "scheduled-tasks", "learn", "routines"].flatMap((section) =>
  [`/${section}`, `/${section}/$`].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      beforeLoad: ({ location }) => {
        throw redirect({ href: `${STUDIO_NEXT_BASE_PATH}${location.href}`, replace: true });
      },
    }),
  ),
);

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
    marketRoute,
    ...runtimePageSubRoutes,
  ]),
  nativeNarratorRoute,
  nativeNarratorsRoute,
  nativeChapterRoute,
  nativeSettingsRoute,
  nativeSettingsSectionRoute,
  nativeSettingsDeepRoute,
  ...nativeRuntimePageRoutes,
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

export { rootRoute, nextRoute, homeRoute, narratorRoute, bookRoute, booksListRoute, sessionsRoute, searchRoute, routinesRoute, knowledgeRoute, scheduledTasksRoute, settingsRoute, settingsSectionRoute, learnRoute, marketRoute };
