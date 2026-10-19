import { isRuntimePageSection, type RuntimePageSection } from "../runtime/runtime-page-sections";

export const STUDIO_NEXT_BASE_PATH = "/next";

export type ShellRoute =
  | { readonly kind: "home" }
  | { readonly kind: "narrator"; readonly sessionId: string }
  | { readonly kind: "books" }
  | { readonly kind: "book"; readonly bookId: string }
  | { readonly kind: "sessions"; readonly create?: boolean }
  | RuntimePageRoute
  | { readonly kind: "market" };

/**
 * 嵌入的 Runtime 原页（搜索、套路、知识库、定时任务、学习）。`path` 是 Runtime 路径（含查询串），
 * 缺省为入口根路径；Studio 地址是 `/next` + 这个路径。
 */
export type RuntimePageRoute = {
  readonly [Section in RuntimePageSection]: { readonly kind: Section; readonly path?: string };
}[RuntimePageSection];

/**
 * 旧版 `/next/routines/novelfork/…` 的段名。
 *
 * 套路页曾经有 Studio 自己的「本书设置」面板，那一层已经删掉（按书的设置只剩写作台 › 本书设置，
 * 那里嵌的是 Runtime 自己的项目设置）。这个段名保留下来只是为了把老地址收回套路页，不再有合法面板。
 */
export const ROUTINES_NOVEL_PANEL_SEGMENT = "novelfork";

/**
 * 旧的 Studio 设置面板地址（段名即原面板 id）映射到产品侧栏页的 Runtime 路径。
 */
export const LEGACY_SETTINGS_HOST_PATHS: Readonly<Record<string, string>> = {
  embedding: "/settings/host/embedding",
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

/** 套路入口：只有 Runtime 原页一层（按书的设置已归写作台 › 本书设置）。 */
export type RoutinesRoute = Extract<ShellRoute, { readonly kind: "routines" }>;

/** 设置入口：Runtime 原页（带 Runtime 子路径）；产品设置并入其侧栏，不另设地址。 */
export type SettingsRoute = Extract<ShellRoute, { readonly kind: "settings" }>;

export type ShellRouteKind = ShellRoute["kind"];

export interface ShellBookItem {
  readonly id: string;
  readonly title: string;
  /**
   * The Runtime project this book is bound to, when provisioning has got that far.
   *
   * Carried through so the writing workbench can embed Runtime's own project settings
   * for this book; it grants nothing by itself.
   */
  readonly runtimeProjectId?: string | null;
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
  // 老地址 `/next/routines/novelfork/<已删面板>` 收回套路页本身。
  if (section === "routines" && id === ROUTINES_NOVEL_PANEL_SEGMENT) return { kind: "routines" };
  if (section === "settings") {
    const decodedId = id ? decodeSegment(id) : undefined;
    const legacyHostPath = decodedId ? LEGACY_SETTINGS_HOST_PATHS[decodedId] : undefined;
    if (legacyHostPath !== undefined) {
      const suffix = href.slice(href.search(/[?#]|$/u));
      return runtimePageRoute("settings", `${legacyHostPath}${suffix}`);
    }
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
      return `${STUDIO_NEXT_BASE_PATH}${route.path ?? "/routines"}`;
    case "settings":
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
