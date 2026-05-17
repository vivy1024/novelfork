import { Hono } from "hono";
import { listSessions } from "../lib/session-service.js";
import { ProviderRuntimeStore } from "../lib/provider-runtime-store.js";
import {
  deleteRequestLog,
  queryRequestLogs,
  queryRequestSummary,
  queryRequestTrend,
  summarizeRequests,
} from "../lib/request-observability.js";
import type { RequestLog } from "../lib/request-observability.js";

interface UsageEntry {
  providerId: string;
  providerName: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnCount: number;
  sessionCount: number;
}

export function createUsageRouter() {
  const app = new Hono();

  app.get("/summary", async (c) => {
    const sessions = await listSessions();

    // Build provider name map
    const providerNameMap = new Map<string, string>();
    try {
      const store = new ProviderRuntimeStore();
      const providers = await store.listProviders();
      for (const p of providers) {
        providerNameMap.set(p.id, p.name || p.id);
      }
    } catch { /* non-critical */ }

    const buckets = new Map<string, UsageEntry>();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTurns = 0;

    for (const session of sessions) {
      if (!session.cumulativeUsage) continue;

      const providerId = session.sessionConfig.providerId || "unknown";
      const modelId = session.sessionConfig.modelId || "unknown";
      const key = `${providerId}::${modelId}`;

      const existing = buckets.get(key);
      const usage = session.cumulativeUsage;

      if (existing) {
        existing.inputTokens += usage.totalInputTokens;
        existing.outputTokens += usage.totalOutputTokens;
        existing.cacheCreationTokens += usage.totalCacheCreationInputTokens;
        existing.cacheReadTokens += usage.totalCacheReadInputTokens;
        existing.turnCount += usage.turnCount;
        existing.sessionCount += 1;
      } else {
        buckets.set(key, {
          providerId,
          providerName: providerNameMap.get(providerId) || providerId,
          modelId,
          inputTokens: usage.totalInputTokens,
          outputTokens: usage.totalOutputTokens,
          cacheCreationTokens: usage.totalCacheCreationInputTokens,
          cacheReadTokens: usage.totalCacheReadInputTokens,
          turnCount: usage.turnCount,
          sessionCount: 1,
        });
      }

      totalInputTokens += usage.totalInputTokens;
      totalOutputTokens += usage.totalOutputTokens;
      totalTurns += usage.turnCount;
    }

    const entries = [...buckets.values()].sort((a, b) => {
      const totalA = a.inputTokens + a.outputTokens;
      const totalB = b.inputTokens + b.outputTokens;
      return totalB - totalA;
    });

    // Also include request-level summary from SQLite
    const requestSummary = queryRequestSummary();

    return c.json({
      entries,
      totalInputTokens,
      totalOutputTokens,
      totalTurns,
      totalSessions: sessions.length,
      requestSummary,
    });
  });

  // ── 请求明细（分页+筛选，SQLite 持久化） ──
  app.get("/requests", (c) => {
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(c.req.query("pageSize")) || 30));
    const provider = c.req.query("provider")?.trim() || undefined;
    const model = c.req.query("model")?.trim() || undefined;
    const from = c.req.query("from") || undefined;
    const to = c.req.query("to") || undefined;
    const status = (c.req.query("status") || undefined) as "success" | "error" | undefined;

    const result = queryRequestLogs({ provider, model, from, to, status, page, pageSize });

    // Compute summary for the filtered set
    const summary = summarizeRequests(result.items);

    return c.json({
      items: result.items.map(formatRequestItem),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      summary,
    });
  });

  // ── 使用趋势（时间粒度聚合，SQLite） ──
  app.get("/trend", (c) => {
    const granularity = (c.req.query("granularity") || "day") as "hour" | "day" | "month";
    const metric = (c.req.query("metric") || "tokens") as "tokens" | "requests" | "cost" | "errors";
    const from = c.req.query("from") || undefined;
    const to = c.req.query("to") || undefined;

    const points = queryRequestTrend({ granularity, metric, from, to });

    return c.json({ granularity, metric, points });
  });

  // ── 删除单条请求记录 ──
  app.delete("/requests/:id", (c) => {
    const id = c.req.param("id");
    const deleted = deleteRequestLog(id);
    return c.json({ deleted });
  });

  return app;
}

// ── Helpers ──

function formatRequestItem(log: RequestLog) {
  return {
    id: log.id,
    timestamp: log.timestamp,
    narrator: log.narrator ?? null,
    provider: log.provider ?? null,
    model: log.model ?? null,
    status: log.status,
    tokens: log.tokens?.total ?? null,
    inputTokens: log.tokens?.input ?? null,
    outputTokens: log.tokens?.output ?? null,
    ttftMs: log.ttftMs ?? null,
    duration: log.duration,
    costUsd: log.costUsd ?? null,
    error: log.status >= 400 ? (log.errorSummary ?? "Error") : null,
  };
}
