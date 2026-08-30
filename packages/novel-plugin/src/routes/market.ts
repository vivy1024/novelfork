import { Hono } from "hono";

import { FANQIE_RANKS, QIDIAN_RANKS } from "../engine/market/config.js";
import {
  generateAnalysis,
  queryMarket,
  samplePublicChapters,
  scanMarket,
} from "../engine/market/index.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
}

export function createMarketRouter(): Hono {
  const app = new Hono();

  app.get("/api/market/ranks", (c) => {
    return c.json({
      qidian: QIDIAN_RANKS,
      fanqie: FANQIE_RANKS,
    });
  });

  app.get("/api/market/snapshots", async (c) => {
    const platform = asString(c.req.query("platform")) as "qidian" | "fanqie" | undefined;
    const result = await queryMarket({
      platform,
      rankType: asString(c.req.query("rankType")),
      fromDate: asString(c.req.query("fromDate")),
      toDate: asString(c.req.query("toDate")),
      analyze: asBoolean(c.req.query("analyze")) === true ? Boolean(platform) : false,
    });
    const analysis = result.analysis
      ?? (asBoolean(c.req.query("analyze")) === true
        ? await generateAnalysis(platform ?? "qidian")
        : undefined);
    return c.json({ snapshots: result.snapshots, analysis });
  });

  app.get("/api/market/analysis", async (c) => {
    const platform = asString(c.req.query("platform")) ?? "qidian";
    const report = await generateAnalysis(platform, {
      filter: {
        platform,
        rank_type: asString(c.req.query("rankType")),
        fromDate: asString(c.req.query("fromDate")),
        toDate: asString(c.req.query("toDate")),
      },
    });
    return c.json(report);
  });

  app.post("/api/market/scan", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const snapshots = await scanMarket({
      platform: asString(body.platform) as "qidian" | "fanqie" | "all" | undefined,
      rankTypes: asStringArray(body.rankTypes),
      maxPages: asNumber(body.maxPages),
    });
    return c.json({
      ok: true,
      snapshots,
      summary: `已扫描 ${snapshots.length} 个榜单快照，并写入 ~/.novelfork/market/snapshots/。`,
    });
  });

  app.post("/api/market/sample-public-chapters", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const bookId = asString(body.fanqieBookId) ?? asString(body.bookId);
    if (!bookId) return c.json({ ok: false, error: "fanqieBookId 必填" }, 400);
    const samples = await samplePublicChapters({
      book_id: bookId,
      maxChapters: asNumber(body.maxChapters),
    });
    return c.json({ ok: true, samples });
  });

  return app;
}
