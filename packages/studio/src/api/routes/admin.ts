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
import { providerManager } from "../lib/provider-manager.js";
import { buildStartupFailureDecisions, type StartupFailureDecision } from "../lib/startup-orchestrator.js";

const statfs = promisify(statfsCallback);
const MAX_REQUEST_LOGS = 1000;
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

interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "user";
  createdAt: Date;
  lastLogin: Date;
}

const initialUsers: User[] = [
  {
    id: "1",
    username: "admin",
    email: "admin@novelfork.local",
    role: "admin",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastLogin: new Date(),
  },
];

function cloneUser(user: User): User {
  return {
    ...user,
    createdAt: new Date(user.createdAt),
    lastLogin: new Date(user.lastLogin),
  };
}

const users: User[] = initialUsers.map(cloneUser);

// --- 请求日志 ---

type CacheStatus = "hit" | "miss" | "bypass";

interface RequestCacheMeta {
  status: CacheStatus;
  scope?: string;
  ageMs?: number;
}

interface RequestTokenUsage {
  input?: number;
  output?: number;
  total?: number;
}

interface RequestLog {
  id: string;
  timestamp: Date;
  method: string;
  endpoint: string;
  status: number;
  duration: number;
  userId: string;
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

interface RequestSummaryBucket {
  label: string;
  count: number;
}

interface RequestSummary {
  successRate: number;
  slowRequests: number;
  errorRequests: number;
  averageDuration: number;
  averageTtftMs: number | null;
  totalTokens: number;
  totalCostUsd: number;
  cacheHitRate: number | null;
  topEndpoints: RequestSummaryBucket[];
  topNarrators: RequestSummaryBucket[];
}

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
    phase: "project-bootstrap" | "migration" | "search-index" | "static-delivery" | "compile-smoke";
    message: string;
  }[];
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
  narrator?: string;
  requestKind?: string;
  provider?: string;
  model?: string;
  runId?: string;
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

const requestLogs: RequestLog[] = [];
let logIdCounter = 1;

function normalizeTokenUsage(tokens?: RequestTokenUsage) {
  if (!tokens) return undefined;

  const input = typeof tokens.input === "number" ? tokens.input : undefined;
  const output = typeof tokens.output === "number" ? tokens.output : undefined;
  const total =
    typeof tokens.total === "number"
      ? tokens.total
      : (input ?? 0) + (output ?? 0) > 0
        ? (input ?? 0) + (output ?? 0)
        : undefined;

  if (input === undefined && output === undefined && total === undefined) {
    return undefined;
  }

  return { input, output, total };
}

export function logRequest(log: Omit<RequestLog, "id">) {
  requestLogs.push({
    id: String(logIdCounter++),
    ...log,
    tokens: normalizeTokenUsage(log.tokens),
  });

  if (requestLogs.length > MAX_REQUEST_LOGS) {
    requestLogs.shift();
  }
}

function buildTopBuckets(values: Array<string | undefined>, limit = 3): RequestSummaryBucket[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0], "zh-CN");
    })
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function summarizeRequests(logs: RequestLog[]): RequestSummary {
  const successful = logs.filter((log) => log.status >= 200 && log.status < 400).length;
  const slowRequests = logs.filter((log) => log.duration >= 2_000).length;
  const errorRequests = logs.filter((log) => log.status >= 400).length;
  const averageDuration = logs.length === 0 ? 0 : Math.round(logs.reduce((sum, log) => sum + log.duration, 0) / logs.length);

  const ttftLogs = logs.filter((log) => typeof log.ttftMs === "number");
  const averageTtftMs =
    ttftLogs.length === 0 ? null : Math.round(ttftLogs.reduce((sum, log) => sum + (log.ttftMs ?? 0), 0) / ttftLogs.length);

  const totalTokens = logs.reduce((sum, log) => {
    const tokens = log.tokens;
    const total = tokens?.total ?? ((tokens?.input ?? 0) + (tokens?.output ?? 0) || 0);
    return sum + total;
  }, 0);
  const totalCostUsd = Number(
    logs.reduce((sum, log) => sum + (typeof log.costUsd === "number" ? log.costUsd : 0), 0).toFixed(4),
  );

  const cacheableLogs = logs.filter((log) => log.cache?.status === "hit" || log.cache?.status === "miss");
  const cacheHits = cacheableLogs.filter((log) => log.cache?.status === "hit").length;
  const cacheHitRate = cacheableLogs.length === 0 ? null : Math.round((cacheHits / cacheableLogs.length) * 100);

  return {
    successRate: logs.length === 0 ? 0 : Math.round((successful / logs.length) * 100),
    slowRequests,
    errorRequests,
    averageDuration,
    averageTtftMs,
    totalTokens,
    totalCostUsd,
    cacheHitRate,
    topEndpoints: buildTopBuckets(logs.map((log) => log.endpoint)),
    topNarrators: buildTopBuckets(logs.map((log) => log.narrator)),
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
    decisions: startup.decisions ?? buildStartupFailureDecisions({ ...startup, delivery }),
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
      return {
        ...record,
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
  users.splice(0, users.length, ...initialUsers.map(cloneUser));
  requestLogs.splice(0, requestLogs.length);
  logIdCounter = 1;
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
    c.set("adminLogMeta", { narrator: "admin.users", requestKind: "user-admin" });
    return c.json({ users });
  });

  app.get("/users/:id", (c) => {
    const id = c.req.param("id");
    const user = users.find((candidate) => candidate.id === id);
    c.set("adminLogMeta", { narrator: "admin.users", requestKind: "user-admin" });

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json({ user });
  });

  app.post("/users", async (c) => {
    const body = await c.req.json<Omit<User, "id" | "createdAt" | "lastLogin">>();
    const newUser: User = {
      id: String(users.length + 1),
      ...body,
      createdAt: new Date(),
      lastLogin: new Date(),
    };
    users.push(newUser);
    c.set("adminLogMeta", { narrator: "admin.users", requestKind: "user-admin" });
    return c.json({ user: newUser }, 201);
  });

  app.put("/users/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json<Partial<User>>();
    const index = users.findIndex((candidate) => candidate.id === id);
    c.set("adminLogMeta", { narrator: "admin.users", requestKind: "user-admin" });

    if (index === -1) {
      return c.json({ error: "User not found" }, 404);
    }

    users[index] = { ...users[index], ...updates };
    return c.json({ user: users[index] });
  });

  app.delete("/users/:id", (c) => {
    const id = c.req.param("id");
    const index = users.findIndex((candidate) => candidate.id === id);
    c.set("adminLogMeta", { narrator: "admin.users", requestKind: "user-admin" });

    if (index === -1) {
      return c.json({ error: "User not found" }, 404);
    }

    users.splice(index, 1);
    return c.json({ success: true });
  });

  // ===== API 供应商管理（复用 providerManager）=====

  app.get("/providers", (c) => {
    const providers = providerManager.listProviders();
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

  // ===== 请求历史 =====

  app.get("/requests", (c) => {
    const rawLimit = Number.parseInt(c.req.query("limit") || "100", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_REQUEST_LOGS) : 100;
    const filter = readRunFilter(c.req.query("runId"));
    const filteredLogs = filter.runId
      ? requestLogs.filter((log) => matchesRunFilter(log.details, filter) || matchesRunFilter(log.endpoint, filter) || matchesRunFilter(log.narrator, filter))
      : requestLogs;
    const logs = filteredLogs.slice(-limit).reverse();
    const summary = summarizeRequests(logs);
    const requestMeta = buildRequestMeta({ narrator: "admin.requests", requestKind: "request-audit" });

    c.set("adminLogMeta", {
      narrator: requestMeta.narrator,
      requestKind: requestMeta.requestKind,
      details: `limit=${limit}${filter.runId ? `;run=${filter.runId}` : ""}`,
    });

    return c.json({ logs, total: filteredLogs.length, summary, filters: filter, requestMeta });
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
