import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isPathInsideRoot } from "./git-utils.js";

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

function success(kind: StartupDiagnosticKind, reason: string, note?: string): StartupDiagnostic {
  return { kind, scope: "library", status: "success", reason, ...(note ? { note } : {}) };
}

function failed(kind: StartupDiagnosticKind, reason: string, note?: string): StartupDiagnostic {
  return { kind, scope: "library", status: "failed", reason, ...(note ? { note } : {}) };
}

function skipped(kind: StartupDiagnosticKind, reason: string, note?: string): StartupDiagnostic {
  return { kind, scope: "library", status: "skipped", reason, ...(note ? { note } : {}) };
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
    return failed("unclean-shutdown", "检测到上次运行未干净退出", previousMarker.trim() || markerPath);
  }

  return success("unclean-shutdown", "运行标记已写入", `pid=${current.pid}`);
}

export async function clearUncleanShutdownMarker(markerPath: string): Promise<void> {
  await rm(markerPath, { force: true });
}

export async function checkSessionStoreConsistency(sessionStoreDir: string): Promise<StartupDiagnostic> {
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
      return failed("session-store", "sessions.json 解析失败", error instanceof Error ? error.message : String(error));
    }
  }

  const historyFiles = existsSync(historyDir)
    ? (await readdir(historyDir)).filter((entry) => entry.endsWith(".json"))
    : [];
  const historyIds = new Set(historyFiles.map((entry) => entry.replace(/\.json$/, "")));
  const orphanHistoryIds = [...historyIds].filter((id) => !sessionIds.has(id));
  const danglingSessionIds = [...sessionIds].filter((id) => !historyIds.has(id));

  if (orphanHistoryIds.length > 0) {
    return failed("session-store", "会话存储存在孤儿历史文件", `orphan=${orphanHistoryIds.join(",")}`);
  }

  if (danglingSessionIds.length > 0) {
    return skipped("session-store", "部分会话暂无历史文件", `dangling=${danglingSessionIds.join(",")}`);
  }

  return success("session-store", "会话存储一致", `sessions=${sessionIds.size};history=${historyIds.size}`);
}

export function buildWorktreePollutionDiagnostics(
  projectRoot: string,
  worktrees: ReadonlyArray<WorktreeDiagnosticEntry>,
): StartupDiagnostic {
  const externalWorktrees = worktrees.filter((entry) => !isPathInsideRoot(entry.path, projectRoot));

  if (externalWorktrees.length > 0) {
    return failed(
      "git-worktree-pollution",
      "检测到外部项目 worktree",
      externalWorktrees.map((entry) => entry.path).join(" | "),
    );
  }

  return success("git-worktree-pollution", "未检测到外部项目 worktree", `worktrees=${worktrees.length}`);
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
    );
  }

  return success("provider-availability", "启用供应商均已配置", `configured=${configured.join(",") || "none"}`);
}
