export const STUDIO_NEXT_BASE_PATH = "/next";

export type ShellRoute =
  | { readonly kind: "home" }
  | { readonly kind: "narrator"; readonly sessionId: string }
  | { readonly kind: "book"; readonly bookId: string }
  | { readonly kind: "sessions" }
  | { readonly kind: "search" }
  | { readonly kind: "routines" }
  | { readonly kind: "settings" };

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
}

export type ShellNavItem =
  | { readonly id: string; readonly label: string; readonly group: "books"; readonly route: Extract<ShellRoute, { kind: "book" }> }
  | { readonly id: string; readonly label: string; readonly group: "narrators"; readonly route: Extract<ShellRoute, { kind: "narrator" }> }
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

export function parseShellRoute(pathname = globalThis.location?.pathname ?? STUDIO_NEXT_BASE_PATH): ShellRoute {
  const normalized = normalizePathname(pathname);
  const parts = normalized.split("/").filter(Boolean);
  if (parts[0] !== STUDIO_NEXT_BASE_PATH.slice(1)) return { kind: "home" };

  const [, section, id] = parts;
  if (!section) return { kind: "home" };
  if (section === "narrators" && id) return { kind: "narrator", sessionId: decodeSegment(id) };
  if (section === "books" && id) return { kind: "book", bookId: decodeSegment(id) };
  if (section === "sessions") return { kind: "sessions" };
  if (section === "search") return { kind: "search" };
  if (section === "routines") return { kind: "routines" };
  if (section === "settings") return { kind: "settings" };
  return { kind: "home" };
}

export function toShellPath(route: ShellRoute): string {
  switch (route.kind) {
    case "narrator":
      return `${STUDIO_NEXT_BASE_PATH}/narrators/${encodeSegment(route.sessionId)}`;
    case "book":
      return `${STUDIO_NEXT_BASE_PATH}/books/${encodeSegment(route.bookId)}`;
    case "sessions":
      return `${STUDIO_NEXT_BASE_PATH}/sessions`;
    case "search":
      return `${STUDIO_NEXT_BASE_PATH}/search`;
    case "routines":
      return `${STUDIO_NEXT_BASE_PATH}/routines`;
    case "settings":
      return `${STUDIO_NEXT_BASE_PATH}/settings`;
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
      .filter((session) => session.status === "active")
      .map((session) => ({ id: `narrator:${session.id}`, label: session.title, group: "narrators" as const, route: { kind: "narrator" as const, sessionId: session.id } })),
    { id: "search", label: "搜索", group: "global", route: { kind: "search" } },
    { id: "routines", label: "套路", group: "global", route: { kind: "routines" } },
    { id: "settings", label: "设置", group: "global", route: { kind: "settings" } },
  ];
}

export function isShellNavItemActive(item: ShellNavItem, route: ShellRoute): boolean {
  if (item.route.kind !== route.kind) return false;
  if (item.route.kind === "book" && route.kind === "book") return item.route.bookId === route.bookId;
  if (item.route.kind === "narrator" && route.kind === "narrator") return item.route.sessionId === route.sessionId;
  return true;
}
