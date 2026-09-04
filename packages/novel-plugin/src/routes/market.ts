import { Hono } from "hono";

import { FANQIE_RANKS, QIDIAN_RANKS } from "../engine/market/config.js";
import {
  generateAnalysis,
  queryMarket,
  samplePublicChapters,
  scanMarketWithReport,
} from "../engine/market/index.js";
import {
  deleteCustomRank,
  listRankRegistry,
  upsertCustomRank,
} from "../engine/market/rank-registry.js";
import {
  loadMarketLexicon,
  saveMarketLexicon,
} from "../engine/market/lexicon-store.js";
import { loadScanPrefs, saveScanPrefs } from "../engine/market/scan-prefs-store.js";

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

  app.get("/api/market/ranks", async (c) => {
    const registry = await listRankRegistry();
    return c.json({
      qidian: QIDIAN_RANKS,
      fanqie: FANQIE_RANKS,
      custom: registry.custom,
    });
  });

  app.post("/api/market/ranks/custom", async (c) => {
    const body = await c.req.json().catch(() => null);
    const result = await upsertCustomRank(body);
    if (!result.ok) return c.json({ ok: false, error: result.errors.join("；"), errors: result.errors }, 400);
    return c.json({ ok: true, rank: result.rank });
  });

  app.delete("/api/market/ranks/custom/:key", async (c) => {
    const removed = await deleteCustomRank(c.req.param("key"));
    if (!removed) return c.json({ ok: false, error: "custom-rank-not-found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/market/scan-prefs", async (c) => {
    const prefs = await loadScanPrefs();
    return c.json({ ok: true, prefs: prefs ?? null });
  });

  app.put("/api/market/scan-prefs", async (c) => {
    const body = await c.req.json().catch(() => null);
    const prefs = await saveScanPrefs(body);
    if (!prefs) return c.json({ ok: false, error: "invalid-prefs" }, 400);
    return c.json({ ok: true, prefs });
  });

  app.get("/api/market/lexicon", async (c) => {
    const lexicon = await loadMarketLexicon();
    return c.json({ ok: true, lexicon });
  });

  app.put("/api/market/lexicon", async (c) => {
    const body = await c.req.json().catch(() => null);
    const lexicon = await saveMarketLexicon(body);
    return c.json({ ok: true, lexicon });
  });

  app.get("/api/market/snapshots", async (c) => {
    const platform = asString(c.req.query("platform")) as "qidian" | "fanqie" | undefined;
    const result = await queryMarket({
      platform,
      rankType: asString(c.req.query("rankType")),
      fromDate: asString(c.req.query("fromDate")),
      toDate: asString(c.req.query("toDate")),
      analyze: asBoolean(c.req.query("analyze")) === true ? Boolean(platform) : false,
      categories: asStringArray(c.req.query("categories")),
      limit: asNumber(c.req.query("limit")),
    });
    const analysis = result.analysis
      ?? (asBoolean(c.req.query("analyze")) === true
        ? await generateAnalysis(platform ?? "qidian")
        : undefined);
    return c.json({
      snapshots: result.snapshots,
      latest: result.latest,
      ranks: result.ranks,
      analysis,
    });
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
    const { snapshots, report } = await scanMarketWithReport({
      platform: asString(body.platform) as "qidian" | "fanqie" | "all" | undefined,
      rankTypes: asStringArray(body.rankTypes),
      maxPages: asNumber(body.maxPages),
      categories: asStringArray(body.categories),
      limit: asNumber(body.limit),
    });
    return c.json({
      ok: report.ok,
      snapshots,
      report,
      summary: report.summary,
      ...(report.ok ? {} : { error: "market-scan-failed" }),
    }, report.ok ? 200 : 502);
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
