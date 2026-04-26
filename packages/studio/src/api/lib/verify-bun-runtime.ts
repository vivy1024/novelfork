export interface RuntimeVerificationCheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly category: "runtime" | "storage" | "frontend" | "websocket" | "provider" | "environment";
  readonly detail?: string;
}

export interface RuntimeVerificationSummary {
  readonly ok: boolean;
  readonly runtime: "bun";
  readonly checks: readonly RuntimeVerificationCheckResult[];
  readonly counts: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
  };
  readonly failureCategories: readonly RuntimeVerificationCheckResult["category"][];
}

export interface StartupSmokeParseResult {
  readonly runtimeCheck: RuntimeVerificationCheckResult;
  readonly storageCheck: RuntimeVerificationCheckResult;
  readonly websocketCheck: RuntimeVerificationCheckResult;
  readonly providerCheck: RuntimeVerificationCheckResult;
  readonly environmentCheck: RuntimeVerificationCheckResult;
}

export function buildRuntimeVerificationSummary(
  checks: readonly RuntimeVerificationCheckResult[],
): RuntimeVerificationSummary {
  const failureCategories = checks.reduce<RuntimeVerificationCheckResult["category"][]>((categories, check) => {
    if (!check.ok && !categories.includes(check.category)) {
      categories.push(check.category);
    }
    return categories;
  }, []);

  return {
    ok: checks.every((check) => check.ok),
    runtime: "bun",
    checks,
    counts: {
      total: checks.length,
      passed: checks.filter((check) => check.ok).length,
      failed: checks.filter((check) => !check.ok).length,
    },
    failureCategories,
  };
}

interface StartupEventLine {
  readonly component?: string;
  readonly ok?: boolean;
  readonly runtime?: string;
  readonly route?: string;
  readonly databasePath?: string;
}

interface StartupRecoveryAction {
  readonly kind?: string;
  readonly status?: "success" | "skipped" | "failed";
  readonly reason?: string;
  readonly note?: string;
}

interface StartupRecoveryReportLine {
  readonly actions?: readonly StartupRecoveryAction[];
}

const STARTUP_RECOVERY_PREFIX = "Startup recovery report:";
const REQUIRED_WEBSOCKET_ROUTES = ["/api/admin/resources/ws", "/api/sessions/:id/chat"] as const;
const ENVIRONMENT_DIAGNOSTIC_KINDS = ["unclean-shutdown", "git-worktree-pollution", "session-store"] as const;

function parseJsonLine<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

function parseStartupRecoveryReport(lines: readonly string[]): StartupRecoveryReportLine | null {
  for (const line of lines) {
    const index = line.indexOf(STARTUP_RECOVERY_PREFIX);
    if (index === -1) continue;
    const payload = line.slice(index + STARTUP_RECOVERY_PREFIX.length).trim();
    const parsed = parseJsonLine<StartupRecoveryReportLine>(payload);
    if (parsed) return parsed;
  }
  return null;
}

export function extractStartupSmokeChecks(lines: readonly string[]): StartupSmokeParseResult {
  const startupEvents = lines
    .map((line) => parseJsonLine<StartupEventLine>(line.trim()))
    .filter((line): line is StartupEventLine => line !== null);
  const recoveryReport = parseStartupRecoveryReport(lines);
  const recoveryActions = recoveryReport?.actions ?? [];

  const runtimeEvent = startupEvents.find((event) => event.component === "server.listen");
  const storageEvent = startupEvents.find((event) => event.component === "storage.sqlite");
  const websocketRoutes = startupEvents
    .filter((event) => event.component === "websocket.register" && event.ok === true && typeof event.route === "string")
    .map((event) => event.route as string);
  const missingRoutes = REQUIRED_WEBSOCKET_ROUTES.filter((route) => !websocketRoutes.includes(route));

  const providerAction = recoveryActions.find((action) => action.kind === "provider-availability");
  const environmentActions = recoveryActions.filter((action) =>
    typeof action.kind === "string" && ENVIRONMENT_DIAGNOSTIC_KINDS.includes(action.kind as (typeof ENVIRONMENT_DIAGNOSTIC_KINDS)[number]),
  );
  const environmentFailures = environmentActions.filter((action) => action.status === "failed");

  return {
    runtimeCheck: runtimeEvent?.ok === true && runtimeEvent.runtime === "bun"
      ? { name: "startup runtime", ok: true, category: "runtime", detail: `runtime=${runtimeEvent.runtime}` }
      : {
          name: "startup runtime",
          ok: false,
          category: "runtime",
          detail: runtimeEvent?.runtime ? `runtime=${runtimeEvent.runtime}` : "missing",
        },
    storageCheck: storageEvent?.ok === true
      ? {
          name: "startup storage",
          ok: true,
          category: "storage",
          detail: storageEvent.databasePath ? `databasePath=${storageEvent.databasePath}` : JSON.stringify(storageEvent),
        }
      : {
          name: "startup storage",
          ok: false,
          category: "storage",
          detail: storageEvent ? JSON.stringify(storageEvent) : "missing",
        },
    websocketCheck: missingRoutes.length === 0 && websocketRoutes.length >= REQUIRED_WEBSOCKET_ROUTES.length
      ? {
          name: "startup websocket",
          ok: true,
          category: "websocket",
          detail: REQUIRED_WEBSOCKET_ROUTES.join(", "),
        }
      : {
          name: "startup websocket",
          ok: false,
          category: "websocket",
          detail: missingRoutes.length > 0 ? `missing=${missingRoutes.join(",")}` : "missing",
        },
    providerCheck: providerAction && providerAction.status !== "failed"
      ? {
          name: "startup provider gate",
          ok: true,
          category: "provider",
          detail: providerAction.note ?? providerAction.reason ?? providerAction.status,
        }
      : {
          name: "startup provider gate",
          ok: false,
          category: "provider",
          detail: providerAction?.note ?? providerAction?.reason ?? "missing",
        },
    environmentCheck: environmentActions.length > 0 && environmentFailures.length === 0
      ? {
          name: "startup environment diagnostics",
          ok: true,
          category: "environment",
          detail: environmentActions.map((action) => `${action.kind}:${action.status}`).join(", "),
        }
      : {
          name: "startup environment diagnostics",
          ok: false,
          category: "environment",
          detail: environmentActions.length > 0
            ? environmentActions.map((action) => `${action.kind}:${action.status}`).join(", ")
            : "missing",
        },
  };
}
