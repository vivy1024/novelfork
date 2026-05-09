import { Hono } from "hono";
import { listSessions } from "../lib/session-service.js";

interface UsageEntry {
  providerId: string;
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

  return app;
}
