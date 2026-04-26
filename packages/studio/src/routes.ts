export type WorkflowSection =
  | "project"
  | "agents"
  | "toolchain"
  | "mcp"
  | "plugins"
  | "advanced"
  | "scheduler"
  | "detection"
  | "hooks"
  | "diagnostics"
  | "notify";

export type SettingsSection =
  | "profile"
  | "appearance"
  | "editor"
  | "shortcuts"
  | "notifications"
  | "monitoring"
  | "data"
  | "about"
  | "advanced";

export type AdminSection =
  | "overview"
  | "providers"
  | "resources"
  | "requests"
  | "sessions"
  | "daemon"
  | "logs"
  | "worktrees"
  | "container";

export type Route =
  | { page: "dashboard" }
  | { page: "workflow"; section?: WorkflowSection }
  | { page: "sessions" }
  | { page: "book"; bookId: string }
  | { page: "bible"; bookId: string }
  | { page: "book-create" }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "truth"; bookId: string }
  | { page: "genres" }
  | { page: "presets"; bookId?: string }
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
  | { page: "settings"; section?: SettingsSection }
  | { page: "admin"; section?: AdminSection };

export interface PersistedTabSession {
  readonly tabs: ReadonlyArray<{ route: unknown; id: string }>;
  readonly activeTabId: string;
}

export interface PersistedTabSessionState {
  readonly tabs: ReadonlyArray<{ route: Route; id: string }>;
  readonly activeTabId: string;
}

const WORKFLOW_SECTIONS = new Set<WorkflowSection>([
  "project",
  "agents",
  "toolchain",
  "mcp",
  "plugins",
  "advanced",
  "scheduler",
  "detection",
  "hooks",
  "diagnostics",
  "notify",
]);

const SETTINGS_SECTIONS = new Set<SettingsSection>([
  "profile",
  "appearance",
  "editor",
  "shortcuts",
  "notifications",
  "monitoring",
  "data",
  "about",
  "advanced",
]);

const ADMIN_SECTIONS = new Set<AdminSection>([
  "overview",
  "providers",
  "resources",
  "requests",
  "sessions",
  "daemon",
  "logs",
  "worktrees",
  "container",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: unknown, key: string): boolean {
  return isRecord(value) && typeof value[key] === "string";
}

function hasNumber(value: unknown, key: string): boolean {
  return isRecord(value) && typeof value[key] === "number";
}

function parseOptionalString<T extends string>(
  value: unknown,
  key: string,
  allowed: ReadonlySet<T>,
): T | undefined {
  if (!isRecord(value) || value[key] === undefined) return undefined;
  const raw = value[key];
  if (typeof raw !== "string") return undefined;
  // Defense: persisted routes occasionally stringify `undefined`/`null` — reject
  // these literal sentinels so they never flow into label formatters.
  if (raw === "" || raw === "undefined" || raw === "null") return undefined;
  return allowed.has(raw as T) ? (raw as T) : undefined;
}

export function canonicalRouteId(route: Route): string {
  switch (route.page) {
    case "dashboard":
      return "dashboard";
    case "workflow":
      return route.section ? `workflow:${route.section}` : "workflow";
    case "sessions":
      return "sessions";
    case "book":
      return `book:${route.bookId}`;
    case "bible":
      return `bible:${route.bookId}`;
    case "book-create":
      return "book-create";
    case "chapter":
      return `chapter:${route.bookId}:${route.chapterNumber}`;
    case "analytics":
      return `analytics:${route.bookId}`;
    case "truth":
      return `truth:${route.bookId}`;
    case "genres":
      return "genres";
    case "presets":
      return route.bookId ? `presets:${route.bookId}` : "presets";
    case "style":
      return "style";
    case "import":
      return "import";
    case "radar":
      return "radar";
    case "doctor":
      return "doctor";
    case "diff":
      return `diff:${route.bookId}:${route.chapterNumber}`;
    case "search":
      return "search";
    case "backup":
      return "backup";
    case "detect":
      return `detect:${route.bookId}`;
    case "intent":
      return `intent:${route.bookId}`;
    case "state":
      return `state:${route.bookId}`;
    case "pipeline":
      return route.runId ? `pipeline:${route.runId}` : "pipeline";
    case "settings":
      return route.section ? `settings:${route.section}` : "settings";
    case "admin":
      return route.section ? `admin:${route.section}` : "admin";
    default: {
      const unreachable: never = route;
      throw new Error(`Unhandled route identity: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function normalizeRoute(value: unknown): Route | undefined {
  if (!isRecord(value) || typeof value.page !== "string") {
    return undefined;
  }

  switch (value.page) {
    case "dashboard":
    case "sessions":
    case "genres":
    case "style":
    case "import":
    case "radar":
    case "doctor":
    case "search":
    case "backup":
    case "book-create":
      return { page: value.page };
    case "presets":
      return {
        page: "presets",
        ...(hasString(value, "bookId") ? { bookId: value.bookId as string } : {}),
      };
    case "workflow":
      return {
        page: "workflow",
        section: parseOptionalString(value, "section", WORKFLOW_SECTIONS),
      };
    case "settings":
      return {
        page: "settings",
        section: parseOptionalString(value, "section", SETTINGS_SECTIONS),
      };
    case "admin":
      return {
        page: "admin",
        section: parseOptionalString(value, "section", ADMIN_SECTIONS),
      };
    case "book":
      return hasString(value, "bookId") ? { page: "book", bookId: value.bookId as string } : undefined;
    case "bible":
      return hasString(value, "bookId") ? { page: "bible", bookId: value.bookId as string } : undefined;
    case "analytics":
      return hasString(value, "bookId") ? { page: "analytics", bookId: value.bookId as string } : undefined;
    case "truth":
      return hasString(value, "bookId") ? { page: "truth", bookId: value.bookId as string } : undefined;
    case "detect":
      return hasString(value, "bookId") ? { page: "detect", bookId: value.bookId as string } : undefined;
    case "intent":
      return hasString(value, "bookId") ? { page: "intent", bookId: value.bookId as string } : undefined;
    case "state":
      return hasString(value, "bookId") ? { page: "state", bookId: value.bookId as string } : undefined;
    case "chapter":
      return hasString(value, "bookId") && hasNumber(value, "chapterNumber")
        ? { page: "chapter", bookId: value.bookId as string, chapterNumber: value.chapterNumber as number }
        : undefined;
    case "diff":
      return hasString(value, "bookId") && hasNumber(value, "chapterNumber")
        ? { page: "diff", bookId: value.bookId as string, chapterNumber: value.chapterNumber as number }
        : undefined;
    case "pipeline":
      return typeof value.runId === "string" || value.runId === undefined
        ? { page: "pipeline", runId: value.runId as string | undefined }
        : undefined;
    default:
      return undefined;
  }
}

export function isRoute(value: unknown): value is Route {
  return normalizeRoute(value) !== undefined;
}

export function validatePersistedTabSession(
  session: PersistedTabSession | undefined,
): PersistedTabSessionState | undefined {
  if (!session || !Array.isArray(session.tabs) || typeof session.activeTabId !== "string") {
    return undefined;
  }

  const tabs = session.tabs.flatMap((tab) => {
    if (!isRecord(tab) || typeof tab.id !== "string") return [];
    const route = normalizeRoute(tab.route);
    if (!route) return [];
    return [{ route, id: canonicalRouteId(route) }];
  });

  if (tabs.length === 0) {
    return undefined;
  }

  const activeCandidate = session.tabs.find(
    (tab) => isRecord(tab) && typeof tab.id === "string" && tab.id === session.activeTabId,
  );
  const normalizedActive = activeCandidate ? normalizeRoute(activeCandidate.route) : undefined;
  const activeTabId = normalizedActive && tabs.some((tab) => tab.id === canonicalRouteId(normalizedActive))
    ? canonicalRouteId(normalizedActive)
    : tabs[0]!.id;

  return { tabs, activeTabId };
}
