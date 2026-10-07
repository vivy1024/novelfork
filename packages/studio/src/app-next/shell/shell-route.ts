import { isRuntimePageSection, type RuntimePageSection } from "../runtime/runtime-page-sections";

export const STUDIO_NEXT_BASE_PATH = "/next";

export type ShellRoute =
  | { readonly kind: "home" }
  | { readonly kind: "narrator"; readonly sessionId: string }
  | { readonly kind: "books" }
  | { readonly kind: "book"; readonly bookId: string }
  | { readonly kind: "sessions"; readonly create?: boolean }
  | RuntimePageRoute
  | RoutinesNovelPanelRoute
  | SettingsNovelPanelRoute
  | { readonly kind: "market" };

/**
 * 嵌入的 Runtime 原页（搜索、套路、知识库、定时任务、学习）。`path` 是 Runtime 路径（含查询串），
 * 缺省为入口根路径；Studio 地址是 `/next` + 这个路径。
 */
export type RuntimePageRoute = {
  readonly [Section in RuntimePageSection]: { readonly kind: Section; readonly path?: string };
}[RuntimePageSection];

/** 套路页里 NovelFork 自己的面板（Runtime 原页没有的小说专属设置）。 */
export const ROUTINES_NOVEL_PANELS = ["book", "subagent-tools"] as const;
export type RoutinesNovelPanel = (typeof ROUTINES_NOVEL_PANELS)[number];

/**
 * 这些面板不在 Runtime 路由树里，地址单独占 `/next/routines/novelfork/…` 一段，
 * 免得与 Runtime 套路页的子路径（如 `/routines/tool-permissions`）混在一起。
 */
export const ROUTINES_NOVEL_PANEL_SEGMENT = "novelfork";

export interface RoutinesNovelPanelRoute {
  readonly kind: "routines";
  readonly panel: RoutinesNovelPanel;
}

/**
 * 设置页里 NovelFork 自己的面板（Runtime 原页没有的小说专属或产品级设置）：
 * embedding 向量模型、appearance 书房主题与明暗、users 用户管理（带删除兜底）、about 产品版本。
 */
export const SETTINGS_NOVEL_PANELS = ["embedding", "appearance", "users", "about"] as const;
export type SettingsNovelPanel = (typeof SETTINGS_NOVEL_PANELS)[number];

/** 与套路页同理：产品面板地址单独占 `/next/settings/novelfork/…`，免得撞 Runtime 设置子路径。 */
export const SETTINGS_NOVEL_PANEL_SEGMENT = "novelfork";

export interface SettingsNovelPanelRoute {
  readonly kind: "settings";
  readonly panel: SettingsNovelPanel;
}

/**
 * v0.0.4 起 Embedding 就是独立子页（Runtime 没有同名路径），旧地址继续直达产品面板；
 * appearance / users / about 的旧地址让给 Runtime 原页的同名子页，
 * 产品面板经「设置」页签或 `/next/settings/novelfork/<panel>` 到达。
 */
export const LEGACY_SETTINGS_PANEL_IDS: Readonly<Record<string, SettingsNovelPanel>> = {
  embedding: "embedding",
};

/**
 * 旧版设置子页地址（`/next/settings/<section>`）到 Runtime 设置路径的映射；
 * 没列在表里的段与 Runtime 设置子路径同名，直接直通。
 */
export const LEGACY_SETTINGS_SECTION_PATHS: Readonly<Record<string, string>> = {
  agents: "/settings/agent",
  "agent-hardening": "/settings/agent",
  "custom-subagents": "/settings/agent",
  mcp: "/settings/agent",
  skills: "/settings/agent",
  data: "/settings/storage",
  resources: "/settings/runtime",
  monitoring: "/settings/runtime",
  history: "/settings/models",
  config: "/settings/models",
};

/** 某个原页入口的路由；`path` 缺省为入口根路径。 */
export function runtimePageRoute(section: RuntimePageSection, path?: string): RuntimePageRoute {
  // section 是入口联合类型，逐个入口展开的对象类型 TypeScript 推不出来，这里一次性收窄。
  return (path === undefined ? { kind: section } : { kind: section, path }) as RuntimePageRoute;
}

/** 套路入口：通用部分是 Runtime 原页（带 Runtime 子路径），或 NovelFork 自己的面板。 */
export type RoutinesRoute = Extract<ShellRoute, { readonly kind: "routines" }>;

/** 设置入口：通用部分是 Runtime 原页（带 Runtime 子路径），或 NovelFork 自己的面板。 */
export type SettingsRoute = Extract<ShellRoute, { readonly kind: "settings" }>;

function isRoutinesNovelPanel(value: string | undefined): value is RoutinesNovelPanel {
  return (ROUTINES_NOVEL_PANELS as readonly string[]).includes(value ?? "");
}

function isSettingsNovelPanel(value: string | undefined): value is SettingsNovelPanel {
  return (SETTINGS_NOVEL_PANELS as readonly string[]).includes(value ?? "");
}

export type ShellRouteKind = ShellRoute["kind"];

export interface ShellBookItem {
  readonly id: string;
  readonly title: string;
}

export interface ShellSessionItem {
  readonly id: string;
  readonly title: string;
  readonly status: "active" | "archived";
  readonly projectId?: string;
  readonly projectName?: string;
  readonly agentId?: string;
  readonly lastModified?: string;
  readonly unread?: boolean;
  readonly working?: boolean;
  readonly pinned?: boolean;
}

export interface ShellRecentTabItem {
  // Mirrors Runtime's persisted RecentTabType. "group" is retained for data
  // compatibility with historical recent-tab rows only — the group chat feature
  // is gone and the shell exposes no route or nav entry for it.
  readonly type: "chapter" | "narrator" | "project" | "workspace" | "subagent" | "group";
  readonly id: string;
  readonly narratorId?: string;
  readonly title: string;
  readonly status?: string;
  readonly substatus?: readonly string[];
  readonly lastVisitedAt: number;
  readonly pinned?: boolean;
}

export function recentTabNarratorId(tab: ShellRecentTabItem): string | null {
  if (tab.type === "chapter") return tab.narratorId ?? null;
  if (tab.type === "narrator" || tab.type === "subagent") return tab.id;
  return null;
}

export function recentTabKey(tab: Pick<ShellRecentTabItem, "type" | "id">): string {
  return `${tab.type}:${tab.id}`;
}

export type ShellNavItem =
  | { readonly id: string; readonly label: string; readonly group: "books"; readonly route: Extract<ShellRoute, { kind: "book" }> }
  | { readonly id: string; readonly label: string; readonly group: "narrators"; readonly route: Extract<ShellRoute, { kind: "narrator" }>; readonly unread?: boolean; readonly working?: boolean; readonly pinned?: boolean }
  | { readonly id: string; readonly label: string; readonly group: "global"; readonly route: ShellRoute };

function normalizePathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/** `href` 可带查询串与锚点；只有 Runtime 原页用得上它们（原样交给 Runtime）。 */
export function parseShellRoute(href = globalThis.location?.pathname ?? STUDIO_NEXT_BASE_PATH): ShellRoute {
  const normalized = normalizePathname(href);
  const parts = normalized.split("/").filter(Boolean);
  if (parts[0] !== STUDIO_NEXT_BASE_PATH.slice(1)) return { kind: "home" };

  const [, section, id] = parts;
  if (!section) return { kind: "home" };
  if (section === "routines" && id === ROUTINES_NOVEL_PANEL_SEGMENT) {
    const panel = decodeSegment(parts[3] ?? "");
    return isRoutinesNovelPanel(panel) ? { kind: "routines", panel } : { kind: "routines" };
  }
  if (section === "settings") {
    if (id === SETTINGS_NOVEL_PANEL_SEGMENT) {
      const panel = decodeSegment(parts[3] ?? "");
      return isSettingsNovelPanel(panel) ? { kind: "settings", panel } : { kind: "settings" };
    }
    const decodedId = id ? decodeSegment(id) : undefined;
    // 没有 Runtime 同名子页的 NovelFork 面板旧地址（仅 Embedding）仍直达对应面板。
    const legacyPanel = decodedId ? LEGACY_SETTINGS_PANEL_IDS[decodedId] : undefined;
    if (legacyPanel !== undefined) return { kind: "settings", panel: legacyPanel };
    const legacyPath = decodedId ? LEGACY_SETTINGS_SECTION_PATHS[decodedId] : undefined;
    if (legacyPath !== undefined) {
      const suffix = href.slice(href.search(/[?#]|$/u));
      return runtimePageRoute("settings", `${legacyPath}${suffix}`);
    }
    const suffix = href.slice(href.search(/[?#]|$/u));
    const runtimePath = `/${parts.slice(1).join("/")}${suffix}`;
    return runtimePageRoute("settings", runtimePath === "/settings" ? undefined : runtimePath);
  }
  if (isRuntimePageSection(section)) {
    const suffix = href.slice(href.search(/[?#]|$/u));
    const runtimePath = `/${parts.slice(1).join("/")}${suffix}`;
    return runtimePageRoute(section, runtimePath === `/${section}` ? undefined : runtimePath);
  }
  if (section === "narrators" && id) return { kind: "narrator", sessionId: decodeSegment(id) };
  if (section === "books" && !id) return { kind: "books" };
  if (section === "books" && id) return { kind: "book", bookId: decodeSegment(id) };
  if (section === "sessions") return { kind: "sessions", ...(id === "new" ? { create: true } : {}) };
  if (section === "market") return { kind: "market" };
  return { kind: "home" };
}

export function toShellPath(route: ShellRoute): string {
  switch (route.kind) {
    case "narrator":
      return `${STUDIO_NEXT_BASE_PATH}/narrators/${encodeSegment(route.sessionId)}`;
    case "books":
      return `${STUDIO_NEXT_BASE_PATH}/books`;
    case "book":
      return `${STUDIO_NEXT_BASE_PATH}/books/${encodeSegment(route.bookId)}`;
    case "sessions":
      return route.create ? `${STUDIO_NEXT_BASE_PATH}/sessions/new` : `${STUDIO_NEXT_BASE_PATH}/sessions`;
    case "routines":
      if ("panel" in route) {
        return `${STUDIO_NEXT_BASE_PATH}/routines/${ROUTINES_NOVEL_PANEL_SEGMENT}/${encodeSegment(route.panel)}`;
      }
      return `${STUDIO_NEXT_BASE_PATH}${route.path ?? "/routines"}`;
    case "settings":
      if ("panel" in route) {
        return `${STUDIO_NEXT_BASE_PATH}/settings/${SETTINGS_NOVEL_PANEL_SEGMENT}/${encodeSegment(route.panel)}`;
      }
      return `${STUDIO_NEXT_BASE_PATH}${route.path ?? "/settings"}`;
    case "search":
    case "knowledge":
    case "scheduled-tasks":
    case "learn":
      return `${STUDIO_NEXT_BASE_PATH}${route.path ?? `/${route.kind}`}`;
    case "market":
      return `${STUDIO_NEXT_BASE_PATH}/market`;
    case "home":
    default:
      return STUDIO_NEXT_BASE_PATH;
  }
}

export function getShellNavItems({
  books,
  sessions,
}: {
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
}): ShellNavItem[] {
  return [
    ...books.map((book) => ({ id: `book:${book.id}`, label: book.title, group: "books" as const, route: { kind: "book" as const, bookId: book.id } })),
    ...sessions
      .filter((session) => session.status === "active" && !session.projectId)
      .slice()
      .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))
      .map((session) => ({ id: `narrator:${session.id}`, label: session.title, group: "narrators" as const, route: { kind: "narrator" as const, sessionId: session.id }, unread: session.unread, working: session.working, pinned: session.pinned })),
    { id: "search", label: "搜索", group: "global", route: { kind: "search" } },
    { id: "routines", label: "套路", group: "global", route: { kind: "routines" } },
    { id: "knowledge", label: "知识库", group: "global", route: { kind: "knowledge" } },
    { id: "scheduled-tasks", label: "定时任务", group: "global", route: { kind: "scheduled-tasks" } },
    { id: "learn", label: "学习", group: "global", route: { kind: "learn" } },
    { id: "market", label: "市场", group: "global", route: { kind: "market" } },
    { id: "settings", label: "设置", group: "global", route: { kind: "settings" } },
  ];
}

export function isShellNavItemActive(item: ShellNavItem, route: ShellRoute): boolean {
  if (item.route.kind !== route.kind) return false;
  if (item.route.kind === "book" && route.kind === "book") return item.route.bookId === route.bookId;
  if (item.route.kind === "narrator" && route.kind === "narrator") return item.route.sessionId === route.sessionId;
  return true;
}
