/**
 * Admin 管理面板 API
 * 用户管理、API 供应商管理、资源监控、请求历史
 */

import { Hono } from "hono";
import type { Server } from "node:http";
import * as os from "node:os";
import { join, relative, resolve } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { statfs as statfsCallback } from "node:fs";
import { promisify } from "node:util";
import { WebSocketServer, type WebSocket } from "ws";

import type { BunWebSocketConnection, BunWebSocketRegistrar, StartedHttpServer } from "../start-http-server.js";
import { ProviderRuntimeStore } from "../lib/provider-runtime-store.js";
import { getWorktreeStatus, isPathInsideRoot, listWorktrees } from "../lib/git-utils.js";
import { buildUnsupportedCapabilityResponse } from "../../lib/runtime-capabilities.js";
import { buildStartupFailureDecisions, type StartupFailureDecision, type StartupFailureDecisionAction, type StartupHealthCheck, type StartupOrchestratorFailurePhase } from "../lib/startup-orchestrator.js";
import {
  getRequestLogs,
  logRequest,
  mergeRequestLogs,
  resetRequestHistory,
  summarizeRequests,
  type RequestCacheMeta,
  type RequestLog,
  type RequestSummary,
  type RequestTokenUsage,
} from "../lib/request-observability.js";

const statfs = promisify(statfsCallback);
const MAX_REQUEST_QUERY_LIMIT = 1000;
const MAX_ADMIN_LOG_LINES = 500;
const ADMIN_LOG_REFRESH_HINT_MS = 5_000;
const STORAGE_SCAN_TTL_MS = 30_000;
const STORAGE_TARGETS = [
  { id: "books", label: "书籍目录", relativePath: "books" },
  { id: "assets", label: "素材资源", relativePath: "assets" },
  { id: "packages", label: "工作台源码", relativePath: "packages" },
  { id: "dist", label: "构建产物", relativePath: "dist" },
  { id: "test-project", label: "测试工程", relativePath: "test-project" },
] as const;

// --- 用户管理 ---

const ADMIN_USERS_UNSUPPORTED = buildUnsupportedCapabilityResponse("admin.users.crud", {
  status: "planned",
  reason: "NovelFork Studio 当前按本地单用户工具运行，用户管理 CRUD 尚未接入持久化用户系统。",
});

// --- 请求日志 ---

interface StartupActionSummary {
  kind: string;
  scope: "book" | "library";
  status: "success" | "skipped" | "failed";
  reason: string;
  note?: string;
  bookId?: string;
}

interface StartupSummarySnapshot {
  delivery: {
    staticMode: "embedded" | "filesystem" | "missing";
    indexHtmlReady: boolean;
    compileSmokeStatus: "success" | "skipped" | "failed" | "unknown";
    compileCommand?: string;
    expectedArtifactPath?: string;
    embeddedAssetsReady?: boolean;
    singleFileReady?: boolean;
    excludedDeliveryScopes?: readonly string[];
  };
  recoveryReport: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    actions: readonly StartupActionSummary[];
    counts: {
      success: number;
      skipped: number;
      failed: number;
    };
  };
  failures: readonly {
    bookId?: string;
    phase: StartupOrchestratorFailurePhase;
    message: string;
  }[];
  healthChecks?: readonly StartupHealthCheck[];
  decisions?: readonly StartupFailureDecision[];
}

interface AdminLogMeta {
  requestKind?: string;
  narrator?: string;
  provider?: string;
  model?: string;
  tokens?: RequestTokenUsage;
  ttftMs?: number;
  costUsd?: number;
  cache?: RequestCacheMeta;
  details?: string;
}

interface AdminRunFilter {
  runId: string | null;
}

interface ResourceRequestMeta {
  narrator: string;
  requestKind: string;
  cache: RequestCacheMeta;
  details: string;
}

interface AdminLogEntry {
  timestamp?: string;
  level?: string;
  tag?: string;
  message: string;
  raw: string;
  source: "json" | "text";
  eventType?: string;
  narrator?: string;
  requestKind?: string;
  provider?: string;
  model?: string;
  runId?: string;
  endpoint?: string;
  method?: string;
  durationMs?: number;
  status?: string | number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokenSource?: "actual" | "estimated";
  tokensEstimated?: boolean;
  ttftMs?: number;
  errorSummary?: string;
  bookId?: string;
  sessionId?: string;
  chapterNumber?: number;
  costUsd?: number;
  requestDomain?: "admin" | "ai" | "system";
}

interface AdminLogsSnapshot {
  sourcePath: string;
  exists: boolean;
  refreshedAt: string;
  updatedAt: string | null;
  sizeBytes: number;
  limit: number;
  totalEntries: number;
  refreshHintMs: number;
  entries: AdminLogEntry[];
  filters?: AdminRunFilter;
  requestMeta?: {
    narrator: string;
    requestKind: string;
  };
}

function resolveRequestKind(endpoint: string): string {
  if (endpoint.startsWith("/providers")) return "provider-admin";
  if (endpoint.startsWith("/resources")) return "resource-monitor";
  if (endpoint.startsWith("/requests")) return "request-audit";
  if (endpoint.startsWith("/users")) return "user-admin";
  return "admin";
}

function resolveNarrator(endpoint: string): string {
  const segment = endpoint.split("/").filter(Boolean)[0] ?? "root";
  return `admin.${segment}`;
}

interface AdminWorktreeSnapshot {
  rootPath: string;
  refreshedAt: string;
  refreshHintMs: number;
  status: "ready" | "error";
  error?: string;
  summary: {
    total: number;
    dirty: number;
    clean: number;
    bare: number;
  };
  worktrees: Array<{
    path: string;
    relativePath: string;
    branch: string;
    head: string;
    shortHead: string;
    bare: boolean;
    isPrimary: boolean;
    isExternal: boolean;
    dirty: boolean;
    changeCount: number;
    status: {
      modified: number;
      added: number;
      deleted: number;
      untracked: number;
    };
  }>;
}

function normalizeStartupSummary(startup: StartupSummarySnapshot | null): StartupSummarySnapshot | null {
  if (!startup) {
    return null;
  }

  const delivery = {
    ...startup.delivery,
    compileCommand: startup.delivery.compileCommand ?? "pnpm bun:compile",
    expectedArtifactPath: startup.delivery.expectedArtifactPath ?? "dist/novelfork",
    embeddedAssetsReady: startup.delivery.embeddedAssetsReady ?? (startup.delivery.staticMode === "embedded" && startup.delivery.indexHtmlReady),
    singleFileReady: startup.delivery.singleFileReady
      ?? ((startup.delivery.embeddedAssetsReady ?? (startup.delivery.staticMode === "embedded" && startup.delivery.indexHtmlReady))
        && startup.delivery.compileSmokeStatus === "success"),
    excludedDeliveryScopes: startup.delivery.excludedDeliveryScopes ?? ["installer", "signing", "auto-update", "first-launch UX"],
  };

  return {
    ...startup,
    delivery,
    healthChecks: startup.healthChecks ?? [],
    decisions: startup.decisions ?? buildStartupFailureDecisions({ failures: startup.failures, delivery }),
  };
}

function readRunFilter(runId?: string | null): AdminRunFilter {
  const normalizedRunId = typeof runId === "string" && runId.trim() ? runId.trim() : null;
  return { runId: normalizedRunId };
}

function buildRequestMeta(meta: { narrator: string; requestKind: string }) {
  return {
    narrator: meta.narrator,
    requestKind: meta.requestKind,
  };
}

function buildResourceRequestMeta({
  cache,
  details,
}: {
  cache: RequestCacheMeta;
  details: string;
}): ResourceRequestMeta {
  return {
    narrator: "admin.resources",
    requestKind: "resource-monitor",
    cache,
    details,
  };
}

function matchesRunFilter(value: string | undefined, filter: AdminRunFilter) {
  if (!filter.runId) {
    return true;
  }
  return typeof value === "string" && value.includes(filter.runId);
}

function parseAdminLogLine(line: string): AdminLogEntry {
  const raw = line.replace(/\r$/, "");
  if (!raw.trim()) {
    return { message: "", raw, source: "text" };
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const ctx = typeof record.ctx === "object" && record.ctx !== null
        ? record.ctx as Record<string, unknown>
        : undefined;
      return {
        ...record,
        ...(ctx ?? {}),
        ctx,
        tag: typeof record.tag === "string" ? record.tag : undefined,
        message: typeof record.message === "string" && record.message.trim().length > 0 ? record.message : raw,
        raw,
        source: "json",
      } as AdminLogEntry;
    }
  } catch {
    // ignore and fall through to text mode
  }

  const tagMatch = raw.match(/\[(.*?)\]/);
  return {
    tag: tagMatch?.[1],
    message: raw.replace(/^\[[^\]]+\]\s*/, ""),
    raw,
    source: "text",
  };
}

function toRuntimeRequestLog(entry: AdminLogEntry): RequestLog | null {
  if (entry.eventType !== "ai.request") {
    return null;
  }

  const numericStatus = typeof entry.status === "number"
    ? entry.status
    : entry.status === "error"
      ? 500
      : 200;
  const tokens = (typeof entry.promptTokens === "number" || typeof entry.completionTokens === "number" || typeof entry.totalTokens === "number")
    ? {
        input: typeof entry.promptTokens === "number" ? entry.promptTokens : undefined,
        output: typeof entry.completionTokens === "number" ? entry.completionTokens : undefined,
        total: typeof entry.totalTokens === "number"
          ? entry.totalTokens
          : (entry.promptTokens ?? 0) + (entry.completionTokens ?? 0) > 0
            ? (entry.promptTokens ?? 0) + (entry.completionTokens ?? 0)
            : undefined,
        estimated: entry.tokensEstimated,
        source: entry.tokenSource,
      }
    : undefined;

  return {
    id: `${entry.timestamp ?? "runtime"}:${entry.endpoint ?? entry.tag ?? "ai.request"}:${entry.runId ?? entry.bookId ?? entry.sessionId ?? "scope"}`,
    timestamp: entry.timestamp ?? new Date(0).toISOString(),
    method: entry.method ?? "AI",
    endpoint: entry.endpoint ?? entry.tag ?? "ai.request",
    status: numericStatus,
    duration: Math.max(1, Math.round(entry.durationMs ?? 0)),
    userId: "system",
    requestKind: entry.requestKind,
    narrator: entry.narrator,
    provider: entry.provider,
    model: entry.model,
    tokens,
    ttftMs: entry.ttftMs,
    costUsd: typeof entry.costUsd === "number" ? entry.costUsd : undefined,
    details: entry.message,
    runId: entry.runId,
    requestDomain: entry.requestDomain ?? "ai",
    source: "runtime-log",
    aiStatus: typeof entry.status === "string" ? entry.status as RequestLog["aiStatus"] : undefined,
    errorSummary: entry.errorSummary,
    bookId: entry.bookId,
    sessionId: entry.sessionId,
    chapterNumber: entry.chapterNumber,
  };
}

async function readRuntimeRequestLogs(rootPath: string, filter: AdminRunFilter): Promise<RequestLog[]> {
  const logPath = join(rootPath, "novelfork.log");
  try {
    const content = await readFile(logPath, "utf-8");
    const entries = content
      .split(/\r?\n/)
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.trim().length > 0)
      .map((line) => parseAdminLogLine(line))
      .filter((entry) => !filter.runId || matchesRunFilter(entry.raw, filter) || matchesRunFilter(entry.runId, filter) || matchesRunFilter(entry.message, filter))
      .map((entry) => toRuntimeRequestLog(entry))
      .filter((entry): entry is RequestLog => entry !== null);
    return entries;
  } catch {
    return [];
  }
}

async function readAdminLogsSnapshot(rootPath: string, limit: number, filter: AdminRunFilter) {
  const logPath = join(rootPath, "novelfork.log");
  try {
    const content = await readFile(logPath, "utf-8");
    const allEntries = content
      .split(/\r?\n/)
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.trim().length > 0)
      .map((line) => parseAdminLogLine(line));
    const filteredEntries = filter.runId
      ? allEntries.filter((entry) => matchesRunFilter(entry.tag, filter) || matchesRunFilter(entry.message, filter) || matchesRunFilter(entry.raw, filter) || matchesRunFilter(entry.runId, filter))
      : allEntries;
    const entries = filteredEntries.slice(-limit).reverse();
    const fileStats = await stat(logPath);

    return {
      sourcePath: logPath.replace(/\\/g, "/"),
      exists: true,
      refreshedAt: new Date().toISOString(),
      updatedAt: fileStats.mtime.toISOString(),
      sizeBytes: fileStats.size,
      limit,
      totalEntries: filteredEntries.length,
      refreshHintMs: ADMIN_LOG_REFRESH_HINT_MS,
      entries,
      filters: filter,
      requestMeta: buildRequestMeta({ narrator: "admin.logs", requestKind: "runtime-log" }),
    };
  } catch {
    return {
      sourcePath: logPath.replace(/\\/g, "/"),
      exists: false,
      refreshedAt: new Date().toISOString(),
      updatedAt: null,
      sizeBytes: 0,
      limit,
      totalEntries: 0,
      refreshHintMs: ADMIN_LOG_REFRESH_HINT_MS,
      entries: [],
      filters: filter,
      requestMeta: buildRequestMeta({ narrator: "admin.logs", requestKind: "runtime-log" }),
    };
  }
}

// --- 资源监控 ---

interface ResourceStats {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; free: number; usagePercent: number };
  disk: { used: number; total: number; free: number; usagePercent: number };
  network: { sent: number; received: number; available: boolean };
  sampledAt: string;
}

interface StorageTargetChild {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  totalBytes: number;
}

interface StorageTargetSnapshot {
  id: string;
  label: string;
  relativePath: string;
  absolutePath: string;
  status: "ready" | "missing" | "error";
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
  lastModifiedAt: string | null;
  largestChildren: StorageTargetChild[];
  error?: string;
}

interface StorageSummary {
  scannedTargets: number;
  existingTargets: number;
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
  largestTargetId: string | null;
  largestTargetLabel: string | null;
  largestTargetBytes: number;
}

interface StorageSnapshot {
  rootPath: string;
  scannedAt: string;
  scanDurationMs: number;
  mode: "fresh" | "cached";
  ageMs: number;
  ttlMs: number;
  summary: StorageSummary;
  targets: StorageTargetSnapshot[];
}

let networkStats = { sent: 0, received: 0 };
let storageSnapshotCache:
  | {
      createdAt: number;
      rootPath: string;
      scannedAt: string;
      scanDurationMs: number;
      summary: StorageSummary;
      targets: StorageTargetSnapshot[];
    }
  | null = null;

function getAdminProjectRoot(root?: string): string {
  return resolve(root || process.env.NOVELFORK_ADMIN_ROOT?.trim() || process.cwd());
}

async function getDiskUsage(path: string): Promise<ResourceStats["disk"]> {
  try {
    const stats = await statfs(path);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bfree) * Number(stats.bsize);
    const used = Math.max(0, total - free);
    const usagePercent = total === 0 ? 0 : Math.round((used / total) * 1000) / 10;
    return { used, total, free, usagePercent };
  } catch {
    return { used: 0, total: 0, free: 0, usagePercent: 0 };
  }
}

async function getResourceStats(root?: string): Promise<ResourceStats> {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }

  const cpuUsage = totalTick === 0 ? 0 : 100 - (100 * totalIdle) / totalTick;
  const memoryUsagePercent = totalMem === 0 ? 0 : Math.round((usedMem / totalMem) * 1000) / 10;
  const disk = await getDiskUsage(getAdminProjectRoot(root));

  return {
    cpu: { usage: Math.round(cpuUsage * 10) / 10, cores: cpus.length },
    memory: { used: usedMem, total: totalMem, free: freeMem, usagePercent: memoryUsagePercent },
    disk,
    network: { ...networkStats, available: false },
    sampledAt: new Date().toISOString(),
  };
}

async function inspectPath(targetPath: string): Promise<{
  kind: "file" | "directory";
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
  lastModifiedAt: string | null;
  children: StorageTargetChild[];
}> {
  const stats = await stat(targetPath);
  const lastModifiedAt = stats.mtime.toISOString();

  if (!stats.isDirectory()) {
    return {
      kind: "file",
      totalBytes: stats.size,
      fileCount: 1,
      directoryCount: 0,
      lastModifiedAt,
      children: [],
    };
  }

  let totalBytes = 0;
  let fileCount = 0;
  let directoryCount = 1;
  const children: StorageTargetChild[] = [];

  const entries = await readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.isSymbolicLink()) {
      continue;
    }

    const childPath = join(targetPath, entry.name);
    const childStats = await inspectPath(childPath);

    totalBytes += childStats.totalBytes;
    fileCount += childStats.fileCount;
    directoryCount += childStats.directoryCount;
    children.push({
      name: entry.name,
      relativePath: childPath,
      kind: childStats.kind,
      totalBytes: childStats.totalBytes,
    });
  }

  return {
    kind: "directory",
    totalBytes,
    fileCount,
    directoryCount,
    lastModifiedAt,
    children,
  };
}

async function scanStorageTarget(rootPath: string, target: (typeof STORAGE_TARGETS)[number]): Promise<StorageTargetSnapshot> {
  const absolutePath = join(rootPath, target.relativePath);

  try {
    const stats = await inspectPath(absolutePath);
    const largestChildren = stats.children
      .map((child) => ({
        ...child,
        relativePath: relative(rootPath, child.relativePath).replace(/\\/g, "/"),
      }))
      .sort((left, right) => right.totalBytes - left.totalBytes)
      .slice(0, 3);

    return {
      id: target.id,
      label: target.label,
      relativePath: target.relativePath,
      absolutePath,
      status: "ready",
      totalBytes: stats.totalBytes,
      fileCount: stats.fileCount,
      directoryCount: stats.directoryCount,
      lastModifiedAt: stats.lastModifiedAt,
      largestChildren,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        id: target.id,
        label: target.label,
        relativePath: target.relativePath,
        absolutePath,
        status: "missing",
        totalBytes: 0,
        fileCount: 0,
        directoryCount: 0,
        lastModifiedAt: null,
        largestChildren: [],
      };
    }

    return {
      id: target.id,
      label: target.label,
      relativePath: target.relativePath,
      absolutePath,
      status: "error",
      totalBytes: 0,
      fileCount: 0,
      directoryCount: 0,
      lastModifiedAt: null,
      largestChildren: [],
      error: error instanceof Error ? error.message : "扫描失败",
    };
  }
}

async function getAdminWorktreeSnapshot(root?: string): Promise<AdminWorktreeSnapshot> {
  const rootPath = getAdminProjectRoot(root);
  const refreshedAt = new Date().toISOString();

  try {
    const entries = await listWorktrees(rootPath);
    const primaryPath = entries.find((entry) => !entry.bare)?.path ?? entries[0]?.path ?? rootPath;
    const worktrees = await Promise.all(entries.map(async (entry) => {
      const rawStatus = await getWorktreeStatus(entry.path).catch(() => ({
        modified: [],
        added: [],
        deleted: [],
        untracked: [],
        hasChanges: false,
      }));
      const status = {
        modified: rawStatus.modified.length,
        added: rawStatus.added.length,
        deleted: rawStatus.deleted.length,
        untracked: rawStatus.untracked.length,
      };
      const changeCount = status.modified + status.added + status.deleted + status.untracked;
      return {
        path: entry.path,
        relativePath: relative(rootPath, entry.path).replace(/\\/g, "/") || ".",
        branch: entry.branch,
        head: entry.head,
        shortHead: entry.head.slice(0, 7),
        bare: entry.bare,
        isPrimary: resolve(entry.path) === resolve(primaryPath),
        isExternal: !isPathInsideRoot(entry.path, rootPath),
        dirty: changeCount > 0,
        changeCount,
        status,
      };
    }));

    return {
      rootPath,
      refreshedAt,
      refreshHintMs: ADMIN_LOG_REFRESH_HINT_MS,
      status: "ready",
      summary: {
        total: worktrees.length,
        dirty: worktrees.filter((entry) => entry.dirty).length,
        clean: worktrees.filter((entry) => !entry.dirty).length,
        bare: worktrees.filter((entry) => entry.bare).length,
      },
      worktrees,
    };
  } catch (error) {
    return {
      rootPath,
      refreshedAt,
      refreshHintMs: ADMIN_LOG_REFRESH_HINT_MS,
      status: "error",
      error: error instanceof Error ? error.message : "读取 worktree 列表失败",
      summary: { total: 0, dirty: 0, clean: 0, bare: 0 },
      worktrees: [],
    };
  }
}

async function getStorageSnapshot(forceRefresh: boolean, root?: string): Promise<StorageSnapshot> {
  const rootPath = getAdminProjectRoot(root);
  const now = Date.now();

  if (!forceRefresh && storageSnapshotCache && storageSnapshotCache.rootPath === rootPath) {
    const ageMs = now - storageSnapshotCache.createdAt;
    if (ageMs < STORAGE_SCAN_TTL_MS) {
      return {
        rootPath: storageSnapshotCache.rootPath,
        scannedAt: storageSnapshotCache.scannedAt,
        scanDurationMs: storageSnapshotCache.scanDurationMs,
        summary: storageSnapshotCache.summary,
        targets: storageSnapshotCache.targets,
        ttlMs: STORAGE_SCAN_TTL_MS,
        mode: "cached",
        ageMs,
      };
    }
  }

  const startedAt = performance.now();
  const targets = await Promise.all(STORAGE_TARGETS.map((target) => scanStorageTarget(rootPath, target)));
  const finishedAt = Date.now();
  const existingTargets = targets.filter((target) => target.status === "ready");
  const largestTarget = existingTargets.slice().sort((left, right) => right.totalBytes - left.totalBytes)[0];

  const summary: StorageSummary = {
    scannedTargets: targets.length,
    existingTargets: existingTargets.length,
    totalBytes: existingTargets.reduce((sum, target) => sum + target.totalBytes, 0),
    fileCount: existingTargets.reduce((sum, target) => sum + target.fileCount, 0),
    directoryCount: existingTargets.reduce((sum, target) => sum + target.directoryCount, 0),
    largestTargetId: largestTarget?.id ?? null,
    largestTargetLabel: largestTarget?.label ?? null,
    largestTargetBytes: largestTarget?.totalBytes ?? 0,
  };

  const scanDurationMs = Math.max(1, Math.round(performance.now() - startedAt));

  storageSnapshotCache = {
    createdAt: finishedAt,
    rootPath,
    scannedAt: new Date(finishedAt).toISOString(),
    scanDurationMs,
    summary,
    targets,
  };

  return {
    rootPath,
    scannedAt: storageSnapshotCache.scannedAt,
    scanDurationMs,
    summary,
    targets,
    ttlMs: STORAGE_SCAN_TTL_MS,
    mode: "fresh",
    ageMs: 0,
  };
}

export function resetAdminState() {
  resetRequestHistory();
  networkStats = { sent: 0, received: 0 };
  storageSnapshotCache = null;
}

// --- Router ---

export function createAdminRouter(
  root?: string,
  options?: {
    getStartupSummary?: () => StartupSummarySnapshot | null;
    rerunStartupRecovery?: () => Promise<StartupSummarySnapshot | null>;
    repairRuntimeState?: (bookId: string) => Promise<StartupSummarySnapshot | null>;
    rebuildSearchIndex?: () => Promise<StartupSummarySnapshot | null>;
    cleanupSessionStore?: () => Promise<StartupSummarySnapshot | null>;
    ignoreExternalWorktreePollution?: () => Promise<StartupSummarySnapshot | null>;
    providerStore?: ProviderRuntimeStore;
  },
) {
  const app = new Hono<{ Variables: { adminLogMeta?: AdminLogMeta } }>();

  app.use("*", async (c, next) => {
    const startedAt = performance.now();
    let thrownError: unknown;

    try {
      await next();
    } catch (error) {
      thrownError = error;
      throw error;
    } finally {
      const pathname = new URL(c.req.url).pathname;
      const endpoint = pathname.replace(/\/api\/admin(?=\/|$)/, "") || "/";
      const meta = c.get("adminLogMeta");

      logRequest({
        timestamp: new Date(),
        method: c.req.method,
        endpoint,
        status: thrownError ? 500 : c.res.status,
        duration: Math.max(1, Math.round(performance.now() - startedAt)),
        userId: "system",
        requestKind: meta?.requestKind ?? resolveRequestKind(endpoint),
        narrator: meta?.narrator ?? resolveNarrator(endpoint),
        provider: meta?.provider,
        model: meta?.model,
        tokens: meta?.tokens,
        ttftMs: meta?.ttftMs,
        costUsd: meta?.costUsd,
        cache: meta?.cache,
        details: meta?.details,
      });
    }
  });

  // ===== 用户管理 =====

  app.get("/users", (c) => {
    c.set("adminLogMeta", {
      narrator: "admin.users",
      requestKind: "user-admin",
      details: "mode=local-single-user;crud=unsupported",
    });
    return c.json({
      mode: "local-single-user",
      users: [],
      userManagement: ADMIN_USERS_UNSUPPORTED,
    });
  });

  app.get("/users/:id", (c) => {
    c.set("adminLogMeta", { narrator: "admin.users", requestKind: "user-admin", details: "crud=unsupported" });
    return c.json(ADMIN_USERS_UNSUPPORTED, 501);
  });

  app.post("/users", (c) => {
    c.set("adminLogMeta", { narrator: "admin.users", requestKind: "user-admin", details: "crud=unsupported" });
    return c.json(ADMIN_USERS_UNSUPPORTED, 501);
  });

  app.put("/users/:id", (c) => {
    c.set("adminLogMeta", { narrator: "admin.users", requestKind: "user-admin", details: "crud=unsupported" });
    return c.json(ADMIN_USERS_UNSUPPORTED, 501);
  });

  app.delete("/users/:id", (c) => {
    c.set("adminLogMeta", { narrator: "admin.users", requestKind: "user-admin", details: "crud=unsupported" });
    return c.json(ADMIN_USERS_UNSUPPORTED, 501);
  });

  // ===== API 供应商管理（读取 provider runtime store）=====

  app.get("/providers", async (c) => {
    const providerStore = options?.providerStore ?? new ProviderRuntimeStore();
    const providers = await providerStore.listProviderViews();
    c.set("adminLogMeta", {
      narrator: "admin.providers",
      requestKind: "provider-admin",
      details: `providers=${providers.length}`,
    });
    return c.json({ providers });
  });

  // ===== 资源监控 =====

  app.get("/resources", async (c) => {
    const forceRefresh = c.req.query("refresh") === "1";
    const [stats, storage] = await Promise.all([getResourceStats(root), getStorageSnapshot(forceRefresh, root)]);
    const startup = normalizeStartupSummary(options?.getStartupSummary?.() ?? null);
    const requestMeta = buildResourceRequestMeta({
      cache: {
        status: storage.mode === "cached" ? "hit" : forceRefresh ? "bypass" : "miss",
        scope: "storage-scan",
        ageMs: storage.ageMs,
      },
      details: `storage=${storage.summary.existingTargets}/${storage.summary.scannedTargets};startup=${startup ? startup.delivery.staticMode : "missing"}`,
    });

    c.set("adminLogMeta", requestMeta);
    return c.json({ stats, storage, startup, requestMeta });
  });

  app.post("/resources/recovery", async (c) => {
    if (!options?.rerunStartupRecovery) {
      return c.json({ error: "Startup recovery runner unavailable" }, 503);
    }

    const startup = normalizeStartupSummary(await options.rerunStartupRecovery());
    if (!startup) {
      return c.json({ error: "Startup recovery runner unavailable" }, 503);
    }

    const [stats, storage] = await Promise.all([getResourceStats(root), getStorageSnapshot(true, root)]);
    const requestMeta = buildResourceRequestMeta({
      cache: {
        status: "bypass",
        scope: "startup-recovery",
        ageMs: 0,
      },
      details: `recovery=manual;startup=${startup.delivery.staticMode};failed=${startup.recoveryReport.counts.failed}`,
    });

    c.set("adminLogMeta", requestMeta);

    return c.json({ stats, storage, startup, recoveryTriggered: true, requestMeta });
  });

  app.post("/resources/recovery/runtime-state", async (c) => {
    if (!options?.repairRuntimeState) {
      return c.json({ error: "Runtime-state repair unavailable" }, 503);
    }

    const body = await c.req.json<{ bookId?: string }>();
    const bookId = body.bookId?.trim();
    if (!bookId) {
      return c.json({ error: "bookId is required" }, 400);
    }

    const startup = normalizeStartupSummary(await options.repairRuntimeState(bookId));
    if (!startup) {
      return c.json({ error: "Runtime-state repair unavailable" }, 503);
    }

    const [stats, storage] = await Promise.all([getResourceStats(root), getStorageSnapshot(true, root)]);

    c.set("adminLogMeta", {
      narrator: "admin.resources",
      requestKind: "resource-monitor",
      cache: {
        status: "bypass",
        scope: "runtime-state-repair",
        ageMs: 0,
      },
      details: `repair=runtime-state;book=${bookId};failed=${startup.recoveryReport.counts.failed}`,
    });

    return c.json({ stats, storage, startup, repairTriggered: true });
  });

  app.post("/resources/recovery/search-index", async (c) => {
    if (!options?.rebuildSearchIndex) {
      return c.json({ error: "Search-index rebuild unavailable" }, 503);
    }

    const startup = normalizeStartupSummary(await options.rebuildSearchIndex());
    if (!startup) {
      return c.json({ error: "Search-index rebuild unavailable" }, 503);
    }

    const [stats, storage] = await Promise.all([getResourceStats(root), getStorageSnapshot(true, root)]);

    c.set("adminLogMeta", {
      narrator: "admin.resources",
      requestKind: "resource-monitor",
      cache: {
        status: "bypass",
        scope: "search-index-rebuild",
        ageMs: 0,
      },
      details: `repair=search-index;failed=${startup.recoveryReport.counts.failed}`,
    });

    return c.json({ stats, storage, startup, searchIndexTriggered: true });
  });

  app.post("/resources/recovery/session-store", async (c) => {
    if (!options?.cleanupSessionStore) {
      return c.json({ error: "Session-store quarantine unavailable" }, 503);
    }

    const startup = normalizeStartupSummary(await options.cleanupSessionStore());
    if (!startup) {
      return c.json({ error: "Session-store quarantine unavailable" }, 503);
    }

    const [stats, storage] = await Promise.all([getResourceStats(root), getStorageSnapshot(true, root)]);

    c.set("adminLogMeta", {
      narrator: "admin.resources",
      requestKind: "resource-monitor",
      cache: {
        status: "bypass",
        scope: "session-store-quarantine",
        ageMs: 0,
      },
      details: `quarantine=session-store;failed=${startup.recoveryReport.counts.failed}`,
    });

    return c.json({ stats, storage, startup, sessionStoreQuarantineTriggered: true });
  });

  app.post("/resources/recovery/worktree-pollution", async (c) => {
    if (!options?.ignoreExternalWorktreePollution) {
      return c.json({ error: "Worktree pollution ignore unavailable" }, 503);
    }

    const startup = normalizeStartupSummary(await options.ignoreExternalWorktreePollution());
    if (!startup) {
      return c.json({ error: "Worktree pollution ignore unavailable" }, 503);
    }

    const [stats, storage] = await Promise.all([getResourceStats(root), getStorageSnapshot(true, root)]);

    c.set("adminLogMeta", {
      narrator: "admin.resources",
      requestKind: "resource-monitor",
      cache: {
        status: "bypass",
        scope: "worktree-pollution-ignore",
        ageMs: 0,
      },
      details: `repair=worktree-pollution;failed=${startup.recoveryReport.counts.failed}`,
    });

    return c.json({ stats, storage, startup, worktreeIgnoreTriggered: true });
  });

  // ===== Worktree =====

  app.get("/worktrees", async (c) => {
    const snapshot = await getAdminWorktreeSnapshot(root);
    c.set("adminLogMeta", {
      narrator: "admin.worktrees",
      requestKind: "worktree-audit",
      details: `total=${snapshot.summary.total};dirty=${snapshot.summary.dirty};status=${snapshot.status}`,
    });
    return c.json(snapshot);
  });

  // ===== 请求历史 =====

  app.get("/requests", async (c) => {
    const rawLimit = Number.parseInt(c.req.query("limit") || "100", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_REQUEST_QUERY_LIMIT) : 100;
    const filter = readRunFilter(c.req.query("runId"));
    const provider = c.req.query("provider")?.trim() || "";
    const model = c.req.query("model")?.trim() || "";
    const status = c.req.query("status")?.trim() || "";
    const scope = c.req.query("scope")?.trim() || "";
    const bookId = c.req.query("bookId")?.trim() || "";
    const sessionId = c.req.query("sessionId")?.trim() || "";

    const runtimeLogs = await readRuntimeRequestLogs(getAdminProjectRoot(root), filter);
    const allLogs = mergeRequestLogs(getRequestLogs(), runtimeLogs);
    const filteredLogs = allLogs.filter((log) => {
      if (filter.runId && ![
        matchesRunFilter(log.details, filter),
        matchesRunFilter(log.endpoint, filter),
        matchesRunFilter(log.narrator, filter),
        matchesRunFilter(log.runId, filter),
      ].some(Boolean)) {
        return false;
      }
      if (provider && log.provider !== provider) return false;
      if (model && log.model !== model) return false;
      if (status) {
        if (status === "success" && log.aiStatus !== "success") return false;
        if (status === "error" && log.aiStatus !== "error") return false;
        if (status === "partial" && log.aiStatus !== "partial") return false;
        if (status === "http-error" && log.status < 400) return false;
      }
      if (scope === "ai" && log.requestDomain !== "ai") return false;
      if (scope === "admin" && log.requestDomain !== "admin") return false;
      if (bookId && log.bookId !== bookId) return false;
      if (sessionId && log.sessionId !== sessionId) return false;
      return true;
    });

    const logs = filteredLogs.slice(-limit).reverse();
    const summary = summarizeRequests(filteredLogs);
    const requestMeta = buildRequestMeta({ narrator: "admin.requests", requestKind: "request-audit" });

    c.set("adminLogMeta", {
      narrator: requestMeta.narrator,
      requestKind: requestMeta.requestKind,
      details: `limit=${limit}${filter.runId ? `;run=${filter.runId}` : ""}${provider ? `;provider=${provider}` : ""}${model ? `;model=${model}` : ""}${status ? `;status=${status}` : ""}${scope ? `;scope=${scope}` : ""}${bookId ? `;book=${bookId}` : ""}${sessionId ? `;session=${sessionId}` : ""}`,
    });

    return c.json({
      logs,
      total: filteredLogs.length,
      summary,
      filters: {
        ...filter,
        provider,
        model,
        status,
        scope,
        bookId,
        sessionId,
      },
      requestMeta,
    });
  });

  app.get("/logs", async (c) => {
    const rawLimit = Number.parseInt(c.req.query("limit") || "200", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
    const filter = readRunFilter(c.req.query("runId"));
    const snapshot = await readAdminLogsSnapshot(getAdminProjectRoot(root), limit, filter);

    c.set("adminLogMeta", {
      narrator: "admin.logs",
      requestKind: "runtime-log",
      details: `limit=${limit}${filter.runId ? `;run=${filter.runId}` : ""}`,
    });

    return c.json(snapshot);
  });

  return app;
}

// --- WebSocket 实时监控 ---

const ADMIN_RESOURCE_WS_PATH = "/api/admin/resources/ws";

export function setupAdminWebSocket(server: StartedHttpServer) {
  if (isBunWebSocketRegistrar(server)) {
    const intervals = new WeakMap<BunWebSocketConnection, ReturnType<typeof setInterval>>();

    server.registerWebSocketRoute({
      path: ADMIN_RESOURCE_WS_PATH,
      upgrade(request, bunServer) {
        return bunServer.upgrade(request, { data: { routePath: ADMIN_RESOURCE_WS_PATH } });
      },
      open(socket) {
        console.log("Admin WebSocket client connected");
        void pushAdminResourceSnapshot(socket);
        intervals.set(
          socket,
          setInterval(() => {
            void pushAdminResourceSnapshot(socket);
          }, 1000),
        );
      },
      close(socket) {
        const interval = intervals.get(socket);
        if (interval) {
          clearInterval(interval);
        }
        console.log("Admin WebSocket client disconnected");
      },
    });

    return null;
  }

  const wss = new WebSocketServer({ server, path: ADMIN_RESOURCE_WS_PATH });

  wss.on("connection", (ws) => {
    console.log("Admin WebSocket client connected");

    void pushAdminResourceSnapshot(ws);

    const interval = setInterval(() => {
      void pushAdminResourceSnapshot(ws);
    }, 1000);

    ws.on("close", () => {
      clearInterval(interval);
      console.log("Admin WebSocket client disconnected");
    });
  });

  return wss;
}

async function pushAdminResourceSnapshot(socket: Pick<BunWebSocketConnection, "send"> | Pick<WebSocket, "send" | "readyState">) {
  if ("readyState" in socket && socket.readyState !== 1) {
    return;
  }

  try {
    const stats = await getResourceStats();
    socket.send(JSON.stringify(stats));
  } catch (error) {
    console.error("Failed to push admin resource snapshot", error);
  }
}

function isBunWebSocketRegistrar(server: StartedHttpServer): server is BunWebSocketRegistrar {
  return typeof server === "object" && server !== null && "runtime" in server && server.runtime === "bun";
}
