import type {
  RequestLog,
  RequestSummary,
  RequestSummaryBucket,
  RequestTokenUsage,
} from "../../shared/request-observability.js";

export type { RequestCacheMeta, RequestLog, RequestSummary, RequestSummaryBucket, RequestTokenUsage } from "../../shared/request-observability.js";

const MAX_REQUEST_LOGS = 1000;
const requestLogs: RequestLog[] = [];
let logIdCounter = 1;

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

export function logRequest(log: Omit<RequestLog, "id"> & { id?: string }) {
  requestLogs.push({
    id: log.id?.trim() || String(logIdCounter++),
    ...log,
    tokens: normalizeTokenUsage(log.tokens),
  });

  if (requestLogs.length > MAX_REQUEST_LOGS) {
    requestLogs.shift();
  }
}

export function getRequestLogs(): RequestLog[] {
  return [...requestLogs];
}

export function resetRequestHistory() {
  requestLogs.splice(0, requestLogs.length);
  logIdCounter = 1;
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
