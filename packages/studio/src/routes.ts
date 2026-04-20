export type Route =
  | { page: "dashboard" }
  | { page: "workflow" }
  | { page: "sessions" }
  | { page: "book"; bookId: string }
  | { page: "book-create" }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "truth"; bookId: string }
  | { page: "daemon" }
  | { page: "logs" }
  | { page: "genres" }
  | { page: "style" }
  | { page: "import" }
  | { page: "radar" }
  | { page: "doctor" }
  | { page: "diff"; bookId: string; chapterNumber: number }
  | { page: "search" }
  | { page: "backup" }
  | { page: "detect"; bookId: string }
  | { page: "intent"; bookId: string }
  | { page: "state"; bookId: string }
  | { page: "pipeline"; runId?: string }
  | { page: "settings" }
  | { page: "worktree" }
  | { page: "admin" };

export interface PersistedTabSession {
  readonly tabs: ReadonlyArray<{ route: unknown; id: string }>;
  readonly activeTabId: string;
}

export interface SanitizedTabSession {
  readonly tabs: ReadonlyArray<{ route: Route; id: string }>;
  readonly activeTabId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: unknown, key: string): boolean {
  return isRecord(value) && typeof value[key] === "string";
}

function hasNumber(value: unknown, key: string): boolean {
  return isRecord(value) && typeof value[key] === "number";
}

export function isRoute(value: unknown): value is Route {
  if (!isRecord(value) || typeof value.page !== "string") {
    return false;
  }

  switch (value.page) {
    case "dashboard":
    case "workflow":
    case "sessions":
    case "daemon":
    case "logs":
    case "genres":
    case "style":
    case "import":
    case "radar":
    case "doctor":
    case "search":
    case "backup":
    case "settings":
    case "worktree":
    case "admin":
    case "book-create":
      return true;
    case "book":
    case "analytics":
    case "truth":
    case "detect":
    case "intent":
    case "state":
      return hasString(value, "bookId");
    case "chapter":
    case "diff":
      return hasString(value, "bookId") && hasNumber(value, "chapterNumber");
    case "pipeline":
      return value.runId === undefined || typeof value.runId === "string";
    default:
      return false;
  }
}

export function sanitizeRestoredTabSession(
  session: PersistedTabSession | undefined,
): SanitizedTabSession | undefined {
  if (!session || !Array.isArray(session.tabs) || typeof session.activeTabId !== "string") {
    return undefined;
  }

  const tabs = session.tabs.filter(
    (tab): tab is { route: Route; id: string } =>
      isRecord(tab) && typeof tab.id === "string" && isRoute(tab.route),
  );

  if (tabs.length === 0) {
    return undefined;
  }

  const activeTabId = tabs.some((tab) => tab.id === session.activeTabId)
    ? session.activeTabId
    : tabs[0]!.id;

  return {
    tabs,
    activeTabId,
  };
}
