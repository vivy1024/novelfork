import type {
  RequestLog,
  RequestSummary,
  RequestSummaryBucket,
  RequestTokenUsage,
} from "../../shared/request-observability.js";

export type { RequestCacheMeta, RequestLog, RequestSummary, RequestSummaryBucket, RequestTokenUsage } from "../../shared/request-observability.js";

import { getSessionStorageDatabase } from "./session-storage.js";

// ── Hot cache (most recent N entries for fast access) ──

const HOT_CACHE_SIZE = 100;
const hotCache: RequestLog[] = [];
let logIdCounter = 1;

// ── Token normalization ──

export function normalizeTokenUsage(tokens?: RequestTokenUsage) {
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

  return {
    input,
    output,
    total,
    estimated: tokens.estimated ?? (tokens.source === "estimated"),
    source: tokens.source ?? (tokens.estimated ? "estimated" : "actual"),
  } satisfies RequestTokenUsage;
}

// ── Write ──

export function logRequest(log: Omit<RequestLog, "id"> & { id?: string }) {
  const entry: RequestLog = {
    id: log.id?.trim() || String(logIdCounter++),
    ...log,
    tokens: normalizeTokenUsage(log.tokens),
  };

  // Hot cache
  hotCache.push(entry);
  if (hotCache.length > HOT_CACHE_SIZE) {
    hotCache.shift();
  }

  // Async SQLite write (fire-and-forget, never blocks the request)
  try {
    persistRequestLog(entry);
  } catch {
    // Non-critical: if DB write fails, the hot cache still has it for this session
  }
}

function persistRequestLog(entry: RequestLog): void {
  const storage = getSessionStorageDatabase();
  const stmt = storage.sqlite.prepare(`
    INSERT OR REPLACE INTO "request_log" (
      "id", "timestamp", "method", "endpoint", "status", "duration",
      "user_id", "request_kind", "narrator", "provider", "model",
      "input_tokens", "output_tokens", "total_tokens", "tokens_estimated", "tokens_source",
      "ttft_ms", "cost_usd", "cache_status", "cache_scope", "cache_age_ms",
      "details", "run_id", "request_domain", "source", "ai_status",
      "error_summary", "book_id", "session_id", "chapter_number"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ts = entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp);

  stmt.run(
    entry.id,
    ts,
    entry.method,
    entry.endpoint,
    entry.status,
    entry.duration,
    entry.userId ?? "",
    entry.requestKind ?? null,
    entry.narrator ?? null,
    entry.provider ?? null,
    entry.model ?? null,
    entry.tokens?.input ?? null,
    entry.tokens?.output ?? null,
    entry.tokens?.total ?? null,
    entry.tokens?.estimated ? 1 : 0,
    entry.tokens?.source ?? null,
    entry.ttftMs ?? null,
    entry.costUsd ?? null,
    entry.cache?.status ?? null,
    entry.cache?.scope ?? null,
    entry.cache?.ageMs ?? null,
    entry.details ?? null,
    entry.runId ?? null,
    entry.requestDomain ?? null,
    entry.source ?? null,
    entry.aiStatus ?? null,
    entry.errorSummary ?? null,
    entry.bookId ?? null,
    entry.sessionId ?? null,
    entry.chapterNumber ?? null,
  );
}

// ── Read (legacy in-memory compat) ──

export function getRequestLogs(): RequestLog[] {
  return [...hotCache];
}

// ── Read from SQLite (with filtering) ──

export interface RequestLogQuery {
  provider?: string;
  model?: string;
  from?: string;
  to?: string;
  status?: "success" | "error";
  page?: number;
  pageSize?: number;
}

interface RequestLogRow {
  id: string;
  timestamp: string;
  method: string;
  endpoint: string;
  status: number;
  duration: number;
  user_id: string;
  request_kind: string | null;
  narrator: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  tokens_estimated: number | null;
  tokens_source: string | null;
  ttft_ms: number | null;
  cost_usd: number | null;
  cache_status: string | null;
  cache_scope: string | null;
  cache_age_ms: number | null;
  details: string | null;
  run_id: string | null;
  request_domain: string | null;
  source: string | null;
  ai_status: string | null;
  error_summary: string | null;
  book_id: string | null;
  session_id: string | null;
  chapter_number: number | null;
}

function rowToRequestLog(row: RequestLogRow): RequestLog {
  const tokens: RequestTokenUsage | undefined =
    row.input_tokens !== null || row.output_tokens !== null || row.total_tokens !== null
      ? {
          input: row.input_tokens ?? undefined,
          output: row.output_tokens ?? undefined,
          total: row.total_tokens ?? undefined,
          estimated: row.tokens_estimated === 1,
          source: (row.tokens_source as "actual" | "estimated") ?? undefined,
        }
      : undefined;

  return {
    id: row.id,
    timestamp: row.timestamp,
    method: row.method,
    endpoint: row.endpoint,
    status: row.status,
    duration: row.duration,
    userId: row.user_id,
    requestKind: row.request_kind ?? undefined,
    narrator: row.narrator ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    tokens,
    ttftMs: row.ttft_ms ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    cache: row.cache_status
      ? {
          status: row.cache_status as "hit" | "miss" | "bypass",
          scope: row.cache_scope ?? undefined,
          ageMs: row.cache_age_ms ?? undefined,
        }
      : undefined,
    details: row.details ?? undefined,
    runId: row.run_id ?? undefined,
    requestDomain: row.request_domain as RequestLog["requestDomain"],
    source: row.source as RequestLog["source"],
    aiStatus: row.ai_status as RequestLog["aiStatus"],
    errorSummary: row.error_summary ?? undefined,
    bookId: row.book_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    chapterNumber: row.chapter_number ?? undefined,
  };
}

export interface PaginatedRequestLogs {
  items: RequestLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function queryRequestLogs(query: RequestLogQuery = {}): PaginatedRequestLogs {
  const storage = getSessionStorageDatabase();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 30));

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.provider) {
    conditions.push(`"provider" LIKE ?`);
    params.push(`%${query.provider}%`);
  }
  if (query.model) {
    conditions.push(`"model" LIKE ?`);
    params.push(`%${query.model}%`);
  }
  if (query.from) {
    conditions.push(`"timestamp" >= ?`);
    params.push(query.from);
  }
  if (query.to) {
    conditions.push(`"timestamp" <= ?`);
    params.push(query.to);
  }
  if (query.status === "error") {
    conditions.push(`"status" >= 400`);
  } else if (query.status === "success") {
    conditions.push(`"status" >= 200 AND "status" < 400`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count
  const countRow = storage.sqlite.prepare<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM "request_log" ${whereClause}`,
  ).get(...params);
  const total = countRow?.cnt ?? 0;

  // Fetch page
  const offset = (page - 1) * pageSize;
  const rows = storage.sqlite.prepare<RequestLogRow>(
    `SELECT * FROM "request_log" ${whereClause} ORDER BY "timestamp" DESC LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset);

  return {
    items: rows.map(rowToRequestLog),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ── Trend aggregation (SQL-based) ──

export interface TrendPoint {
  time: string;
  value: number;
}

export interface TrendQuery {
  granularity?: "hour" | "day" | "month";
  metric?: "tokens" | "requests" | "cost" | "errors";
  from?: string;
  to?: string;
}

export function queryRequestTrend(query: TrendQuery = {}): TrendPoint[] {
  const storage = getSessionStorageDatabase();
  const granularity = query.granularity ?? "day";
  const metric = query.metric ?? "tokens";

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.from) {
    conditions.push(`"timestamp" >= ?`);
    params.push(query.from);
  }
  if (query.to) {
    conditions.push(`"timestamp" <= ?`);
    params.push(query.to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Time bucket expression
  let timeBucket: string;
  switch (granularity) {
    case "hour":
      timeBucket = `substr("timestamp", 1, 13) || ':00'`;
      break;
    case "month":
      timeBucket = `substr("timestamp", 1, 7)`;
      break;
    case "day":
    default:
      timeBucket = `substr("timestamp", 1, 10)`;
      break;
  }

  // Metric expression
  let metricExpr: string;
  switch (metric) {
    case "requests":
      metricExpr = `COUNT(*)`;
      break;
    case "cost":
      metricExpr = `COALESCE(SUM("cost_usd"), 0)`;
      break;
    case "errors":
      metricExpr = `SUM(CASE WHEN "status" >= 400 THEN 1 ELSE 0 END)`;
      break;
    case "tokens":
    default:
      metricExpr = `COALESCE(SUM("total_tokens"), 0)`;
      break;
  }

  const sql = `
    SELECT ${timeBucket} as "time", ${metricExpr} as "value"
    FROM "request_log"
    ${whereClause}
    GROUP BY "time"
    ORDER BY "time" ASC
  `;

  const rows = storage.sqlite.prepare<{ time: string; value: number }>(sql).all(...params);
  return rows.map((row) => ({ time: row.time, value: Number(row.value) }));
}

// ── Summary aggregation (SQL-based) ──

export interface RequestDbSummary {
  totalRequests: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  averageTtftMs: number | null;
  averageDuration: number;
  successRate: number;
  errorRequests: number;
  slowRequests: number;
  cacheHitRate: number | null;
}

export function queryRequestSummary(query: { from?: string; to?: string; provider?: string; model?: string } = {}): RequestDbSummary {
  const storage = getSessionStorageDatabase();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.provider) {
    conditions.push(`"provider" LIKE ?`);
    params.push(`%${query.provider}%`);
  }
  if (query.model) {
    conditions.push(`"model" LIKE ?`);
    params.push(`%${query.model}%`);
  }
  if (query.from) {
    conditions.push(`"timestamp" >= ?`);
    params.push(query.from);
  }
  if (query.to) {
    conditions.push(`"timestamp" <= ?`);
    params.push(query.to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const row = storage.sqlite.prepare<{
    total_requests: number;
    total_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
    avg_ttft: number | null;
    avg_duration: number;
    success_count: number;
    error_count: number;
    slow_count: number;
    cache_hit: number;
    cache_total: number;
  }>(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM("total_tokens"), 0) as total_tokens,
      COALESCE(SUM("input_tokens"), 0) as total_input_tokens,
      COALESCE(SUM("output_tokens"), 0) as total_output_tokens,
      COALESCE(SUM("cost_usd"), 0) as total_cost,
      AVG(CASE WHEN "ttft_ms" IS NOT NULL THEN "ttft_ms" END) as avg_ttft,
      AVG("duration") as avg_duration,
      SUM(CASE WHEN "status" >= 200 AND "status" < 400 THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN "status" >= 400 THEN 1 ELSE 0 END) as error_count,
      SUM(CASE WHEN "duration" >= 2000 THEN 1 ELSE 0 END) as slow_count,
      SUM(CASE WHEN "cache_status" = 'hit' THEN 1 ELSE 0 END) as cache_hit,
      SUM(CASE WHEN "cache_status" IN ('hit', 'miss') THEN 1 ELSE 0 END) as cache_total
    FROM "request_log"
    ${whereClause}
  `).get(...params);

  if (!row || row.total_requests === 0) {
    return {
      totalRequests: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      averageTtftMs: null,
      averageDuration: 0,
      successRate: 0,
      errorRequests: 0,
      slowRequests: 0,
      cacheHitRate: null,
    };
  }

  return {
    totalRequests: row.total_requests,
    totalTokens: row.total_tokens,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCostUsd: Number(row.total_cost.toFixed(4)),
    averageTtftMs: row.avg_ttft !== null ? Math.round(row.avg_ttft) : null,
    averageDuration: Math.round(row.avg_duration),
    successRate: Math.round((row.success_count / row.total_requests) * 100),
    errorRequests: row.error_count,
    slowRequests: row.slow_count,
    cacheHitRate: row.cache_total > 0 ? Math.round((row.cache_hit / row.cache_total) * 100) : null,
  };
}

// ── Delete ──

export function deleteRequestLog(id: string): boolean {
  const storage = getSessionStorageDatabase();
  const result = storage.sqlite.prepare(`DELETE FROM "request_log" WHERE "id" = ?`).run(id);
  // Also remove from hot cache
  const idx = hotCache.findIndex((l) => l.id === id);
  if (idx >= 0) hotCache.splice(idx, 1);
  return result.changes > 0;
}

// ── Reset (for testing / clear all) ──

export function resetRequestHistory() {
  hotCache.splice(0, hotCache.length);
  logIdCounter = 1;
  try {
    const storage = getSessionStorageDatabase();
    storage.sqlite.exec(`DELETE FROM "request_log"`);
  } catch {
    // DB might not be initialized in test contexts
  }
}

// ── Legacy helpers (kept for backward compat) ──

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

export function summarizeRequests(logs: RequestLog[]): RequestSummary {
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

export function mergeRequestLogs(...collections: ReadonlyArray<ReadonlyArray<RequestLog>>): RequestLog[] {
  const deduped = new Map<string, RequestLog>();

  for (const collection of collections) {
    for (const log of collection) {
      const existing = deduped.get(log.id);
      if (!existing) {
        deduped.set(log.id, log);
        continue;
      }

      deduped.set(log.id, {
        ...existing,
        ...log,
        tokens: log.tokens ?? existing.tokens,
        cache: log.cache ?? existing.cache,
      });
    }
  }

  return Array.from(deduped.values()).sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}
