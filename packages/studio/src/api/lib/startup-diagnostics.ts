import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isPathInsideRoot } from "./git-utils.js";

const STARTUP_DIAGNOSTICS_STATE_PATH = [".novelfork", "startup-diagnostics.json"] as const;

export type StartupDiagnosticKind =
  | "unclean-shutdown"
  | "git-worktree-pollution"
  | "session-store"
  | "provider-availability";

export interface StartupDiagnostic {
  readonly kind: StartupDiagnosticKind;
  readonly scope: "library";
  readonly status: "success" | "skipped" | "failed";
  readonly reason: string;
  readonly note?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RunningProcessMarker {
  readonly pid: number;
  readonly startedAt: string;
}

export interface WorktreeDiagnosticEntry {
  readonly path: string;
}

export interface ProviderDiagnosticEntry {
  readonly id: string;
  readonly enabled?: boolean;
  readonly apiKeyConfigured?: boolean;
}

export interface SessionStoreConsistencyInspection {
  readonly sessionStoreDir: string;
  readonly sessionsPath: string;
  readonly historyDir: string;
  readonly sessionIds: readonly string[];
  readonly historyIds: readonly string[];
  readonly orphanHistoryIds: readonly string[];
  readonly danglingSessionIds: readonly string[];
  readonly parseError?: string;
}

export interface CleanupOrphanSessionHistoryResult {
  readonly sessionStoreDir: string;
  readonly removedHistoryIds: readonly string[];
}

function success(
  kind: StartupDiagnosticKind,
  reason: string,
  note?: string,
  details?: Readonly<Record<string, unknown>>,
): StartupDiagnostic {
  return { kind, scope: "library", status: "success", reason, ...(note ? { note } : {}), ...(details ? { details } : {}) };
}

function failed(
  kind: StartupDiagnosticKind,
  reason: string,
  note?: string,
  details?: Readonly<Record<string, unknown>>,
): StartupDiagnostic {
  return { kind, scope: "library", status: "failed", reason, ...(note ? { note } : {}), ...(details ? { details } : {}) };
}

function skipped(
  kind: StartupDiagnosticKind,
  reason: string,
  note?: string,
  details?: Readonly<Record<string, unknown>>,
): StartupDiagnostic {
  return { kind, scope: "library", status: "skipped", reason, ...(note ? { note } : {}), ...(details ? { details } : {}) };
}

function normalizeDiagnosticPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function getStartupDiagnosticsStatePath(projectRoot: string): string {
  return join(projectRoot, ...STARTUP_DIAGNOSTICS_STATE_PATH);
}

async function readStartupDiagnosticsState(projectRoot: string): Promise<{ ignoredExternalWorktrees: string[] }> {
  const statePath = getStartupDiagnosticsStatePath(projectRoot);
  if (!existsSync(statePath)) {
    return { ignoredExternalWorktrees: [] };
  }

  try {
    const parsed = JSON.parse(await readFile(statePath, "utf-8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { ignoredExternalWorktrees?: unknown }).ignoredExternalWorktrees)) {
      return {
        ignoredExternalWorktrees: ((parsed as { ignoredExternalWorktrees: unknown[] }).ignoredExternalWorktrees)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map(normalizeDiagnosticPath),
      };
    }
  } catch {
    return { ignoredExternalWorktrees: [] };
  }

  return { ignoredExternalWorktrees: [] };
}

async function writeStartupDiagnosticsState(
  projectRoot: string,
  state: { readonly ignoredExternalWorktrees: readonly string[] },
): Promise<void> {
  const statePath = getStartupDiagnosticsStatePath(projectRoot);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify({
    ignoredExternalWorktrees: [...new Set(state.ignoredExternalWorktrees.map(normalizeDiagnosticPath))].sort((left, right) => left.localeCompare(right, "en")),
  }, null, 2)}\n`, "utf-8");
}

export async function loadIgnoredExternalWorktreePaths(projectRoot: string): Promise<readonly string[]> {
  const state = await readStartupDiagnosticsState(projectRoot);
  return state.ignoredExternalWorktrees;
}

export async function ignoreExternalWorktreePollution(
  projectRoot: string,
  worktrees: ReadonlyArray<WorktreeDiagnosticEntry>,
): Promise<readonly string[]> {
  const normalizedProjectRoot = normalizeDiagnosticPath(projectRoot);
  const state = await readStartupDiagnosticsState(projectRoot);
  const externalWorktrees = worktrees
    .map((entry) => normalizeDiagnosticPath(entry.path))
    .filter((path) => !isPathInsideRoot(path, normalizedProjectRoot));
  const ignoredExternalWorktrees = [...new Set([...state.ignoredExternalWorktrees, ...externalWorktrees])];
  await writeStartupDiagnosticsState(projectRoot, { ignoredExternalWorktrees });
  return ignoredExternalWorktrees;
}

export async function prepareUncleanShutdownMarker(
  markerPath: string,
  current: RunningProcessMarker = { pid: process.pid, startedAt: new Date().toISOString() },
): Promise<StartupDiagnostic> {
  const hadExistingMarker = existsSync(markerPath);
  const previousMarker = hadExistingMarker ? await readFile(markerPath, "utf-8").catch(() => "") : "";
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${JSON.stringify(current, null, 2)}\n`, "utf-8");

  if (hadExistingMarker) {
    return failed(
      "unclean-shutdown",
      "检测到上次运行未干净退出",
      previousMarker.trim() || markerPath,
      { markerPath, currentPid: current.pid },
    );
  }

  return success("unclean-shutdown", "运行标记已写入", `pid=${current.pid}`, { markerPath, currentPid: current.pid });
}

export async function clearUncleanShutdownMarker(markerPath: string): Promise<void> {
  await rm(markerPath, { force: true });
}

export function clearUncleanShutdownMarkerSync(markerPath: string): void {
  rmSync(markerPath, { force: true });
}

export async function inspectSessionStoreConsistency(sessionStoreDir: string): Promise<SessionStoreConsistencyInspection> {
  const sessionsPath = join(sessionStoreDir, "sessions.json");
  const historyDir = join(sessionStoreDir, "session-history");
  const sessionIds = new Set<string>();

  if (existsSync(sessionsPath)) {
    try {
      const parsed = JSON.parse(await readFile(sessionsPath, "utf-8")) as unknown;
      if (Array.isArray(parsed)) {
        for (const record of parsed) {
          if (typeof record === "object" && record !== null && typeof (record as { id?: unknown }).id === "string") {
            sessionIds.add((record as { id: string }).id);
          }
        }
      }
    } catch (error) {
      return {
        sessionStoreDir,
        sessionsPath,
        historyDir,
        sessionIds: [],
        historyIds: [],
        orphanHistoryIds: [],
        danglingSessionIds: [],
        parseError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const historyFiles = existsSync(historyDir)
    ? (await readdir(historyDir)).filter((entry) => entry.endsWith(".json"))
    : [];
  const historyIds = historyFiles.map((entry) => entry.replace(/\.json$/, ""));
  const historyIdSet = new Set(historyIds);
  const orphanHistoryIds = historyIds.filter((id) => !sessionIds.has(id));
  const danglingSessionIds = [...sessionIds].filter((id) => !historyIdSet.has(id));

  return {
    sessionStoreDir,
    sessionsPath,
    historyDir,
    sessionIds: [...sessionIds].sort((left, right) => left.localeCompare(right, "en")),
    historyIds: historyIds.slice().sort((left, right) => left.localeCompare(right, "en")),
    orphanHistoryIds: orphanHistoryIds.slice().sort((left, right) => left.localeCompare(right, "en")),
    danglingSessionIds: danglingSessionIds.slice().sort((left, right) => left.localeCompare(right, "en")),
  };
}

export async function cleanupOrphanSessionHistoryFiles(sessionStoreDir: string): Promise<CleanupOrphanSessionHistoryResult> {
  const inspection = await inspectSessionStoreConsistency(sessionStoreDir);
  if (inspection.parseError) {
    throw new Error(`sessions.json 解析失败：${inspection.parseError}`);
  }

  await Promise.all(
    inspection.orphanHistoryIds.map((sessionId) => rm(join(inspection.historyDir, `${sessionId}.json`), { force: true })),
  );

  return {
    sessionStoreDir,
    removedHistoryIds: inspection.orphanHistoryIds,
  };
}

export async function checkSessionStoreConsistency(sessionStoreDir: string): Promise<StartupDiagnostic> {
  const inspection = await inspectSessionStoreConsistency(sessionStoreDir);

  if (inspection.parseError) {
    return failed(
      "session-store",
      "sessions.json 解析失败",
      inspection.parseError,
      {
        sessionStoreDir,
        sessionsPath: inspection.sessionsPath,
      },
    );
  }

  if (inspection.orphanHistoryIds.length > 0) {
    return failed(
      "session-store",
      "会话存储存在孤儿历史文件",
      `orphan=${inspection.orphanHistoryIds.join(",")}`,
      {
        sessionStoreDir,
        orphanHistoryIds: inspection.orphanHistoryIds,
      },
    );
  }

  if (inspection.danglingSessionIds.length > 0) {
    return skipped(
      "session-store",
      "部分会话暂无历史文件",
      `dangling=${inspection.danglingSessionIds.join(",")}`,
      {
        sessionStoreDir,
        danglingSessionIds: inspection.danglingSessionIds,
      },
    );
  }

  return success(
    "session-store",
    "会话存储一致",
    `sessions=${inspection.sessionIds.length};history=${inspection.historyIds.length}`,
    {
      sessionStoreDir,
      sessions: inspection.sessionIds.length,
      history: inspection.historyIds.length,
    },
  );
}

export function buildWorktreePollutionDiagnostics(
  projectRoot: string,
  worktrees: ReadonlyArray<WorktreeDiagnosticEntry>,
  options?: { readonly ignoredPaths?: ReadonlyArray<string> },
): StartupDiagnostic {
  const normalizedProjectRoot = normalizeDiagnosticPath(projectRoot);
  const ignoredPaths = new Set((options?.ignoredPaths ?? []).map(normalizeDiagnosticPath));
  const externalWorktrees = worktrees
    .map((entry) => normalizeDiagnosticPath(entry.path))
    .filter((path) => !isPathInsideRoot(path, normalizedProjectRoot));
  const ignoredExternalWorktrees = externalWorktrees.filter((path) => ignoredPaths.has(path));
  const actionableExternalWorktrees = externalWorktrees.filter((path) => !ignoredPaths.has(path));

  if (actionableExternalWorktrees.length > 0) {
    return failed(
      "git-worktree-pollution",
      "检测到外部项目 worktree",
      actionableExternalWorktrees.join(" | "),
      {
        externalWorktrees: actionableExternalWorktrees,
        ignoredExternalWorktrees,
      },
    );
  }

  if (ignoredExternalWorktrees.length > 0) {
    return skipped(
      "git-worktree-pollution",
      "检测到的外部项目 worktree 已标记忽略",
      ignoredExternalWorktrees.join(" | "),
      {
        ignoredExternalWorktrees,
      },
    );
  }

  return success("git-worktree-pollution", "未检测到外部项目 worktree", `worktrees=${worktrees.length}`, {
    worktrees: worktrees.length,
  });
}

export function buildProviderAvailabilityDiagnostics(providers: ReadonlyArray<ProviderDiagnosticEntry>): StartupDiagnostic {
  const enabledProviders = providers.filter((provider) => provider.enabled !== false);
  const configured = enabledProviders.filter((provider) => provider.apiKeyConfigured === true).map((provider) => provider.id);
  const missing = enabledProviders.filter((provider) => provider.apiKeyConfigured !== true).map((provider) => provider.id);

  if (missing.length > 0) {
    return skipped(
      "provider-availability",
      "部分启用供应商缺少 API Key",
      `configured=${configured.join(",") || "none"};missing=${missing.join(",")}`,
      { configured, missing },
    );
  }

  return success("provider-availability", "启用供应商均已配置", `configured=${configured.join(",") || "none"}`, {
    configured,
  });
}
