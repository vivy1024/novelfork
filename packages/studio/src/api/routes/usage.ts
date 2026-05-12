import { Hono } from "hono";
import { listSessions } from "../lib/session-service.js";
import { ProviderRuntimeStore } from "../lib/provider-runtime-store.js";
import { getRequestLogs, summarizeRequests } from "../lib/request-observability.js";
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

    return c.json({
      entries,
      totalInputTokens,
      totalOutputTokens,
      totalTurns,
      totalSessions: sessions.length,
    });
  });

  // ── 请求明细（分页+筛选） ──
  app.get("/requests", (c) => {
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(c.req.query("pageSize")) || 30));
    const provider = c.req.query("provider")?.trim() || undefined;
    const model = c.req.query("model")?.trim() || undefined;
    const from = c.req.query("from") || undefined;
    const to = c.req.query("to") || undefined;
    const status = c.req.query("status") || undefined; // "success" | "error" | undefined

    let logs = getRequestLogs();

    // 筛选
    if (provider) logs = logs.filter((l) => l.provider?.toLowerCase().includes(provider.toLowerCase()));
    if (model) logs = logs.filter((l) => l.model?.toLowerCase().includes(model.toLowerCase()));
    if (from) {
      const fromTs = new Date(from).getTime();
      logs = logs.filter((l) => new Date(l.timestamp).getTime() >= fromTs);
    }
    if (to) {
      const toTs = new Date(to).getTime();
      logs = logs.filter((l) => new Date(l.timestamp).getTime() <= toTs);
    }
    if (status === "error") logs = logs.filter((l) => l.status >= 400);
    if (status === "success") logs = logs.filter((l) => l.status >= 200 && l.status < 400);

    // 按时间倒序
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = logs.length;
    const offset = (page - 1) * pageSize;
    const items = logs.slice(offset, offset + pageSize);

    // 汇总统计
    const summary = summarizeRequests(logs);

    return c.json({
      items: items.map(formatRequestItem),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      summary,
    });
  });

  // ── 使用趋势（时间粒度聚合） ──
  app.get("/trend", (c) => {
    const granularity = (c.req.query("granularity") || "day") as "hour" | "day" | "month";
    const metric = (c.req.query("metric") || "tokens") as "tokens" | "requests" | "cost" | "errors";
    const from = c.req.query("from") || undefined;
    const to = c.req.query("to") || undefined;

    let logs = getRequestLogs();

    if (from) {
      const fromTs = new Date(from).getTime();
      logs = logs.filter((l) => new Date(l.timestamp).getTime() >= fromTs);
    }
    if (to) {
      const toTs = new Date(to).getTime();
      logs = logs.filter((l) => new Date(l.timestamp).getTime() <= toTs);
    }

    // 按时间桶聚合
    const buckets = new Map<string, number>();

    for (const log of logs) {
      const key = toBucketKey(new Date(log.timestamp), granularity);
      const current = buckets.get(key) ?? 0;

      switch (metric) {
        case "tokens":
          buckets.set(key, current + (log.tokens?.total ?? (log.tokens?.input ?? 0) + (log.tokens?.output ?? 0)));
          break;
        case "requests":
          buckets.set(key, current + 1);
          break;
        case "cost":
          buckets.set(key, current + (log.costUsd ?? 0));
          break;
        case "errors":
          buckets.set(key, current + (log.status >= 400 ? 1 : 0));
          break;
      }
    }

    // 排序并返回
    const points = Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, value]) => ({ time, value }));

    return c.json({ granularity, metric, points });
  });

  return app;
}

// ── Helpers ──

function toBucketKey(date: Date, granularity: "hour" | "day" | "month"): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");

  switch (granularity) {
    case "hour": return `${y}-${m}-${d}T${h}:00`;
    case "day": return `${y}-${m}-${d}`;
    case "month": return `${y}-${m}`;
  }
}

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

