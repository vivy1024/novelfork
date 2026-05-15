import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Hono } from "hono";
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { RouterContext } from "./context.js";

interface QualityTrendEntry {
  number: number;
  qualityScore: number | null;
  aiTastePercent: number | null;
  auditStatus: "passed" | "failed" | null;
  driftScore: number | null;
}

export function createQualityTrendRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  app.get("/api/books/:bookId/quality-trend", async (c) => {
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);

    const limit = Math.min(Math.max(1, Number(c.req.query("limit")) || 20), 100);

    const index = await ctx.state.loadChapterIndex(bookId).catch(() => []);
    const sorted = [...index]
      .filter((ch) => Number.isInteger(ch.number) && ch.number > 0)
      .sort((a, b) => b.number - a.number)
      .slice(0, limit);

    const storage = getStorageDatabase();
    let filterReports: ReadonlyArray<{ aiTasteScore: number; chapterNumber: number }> = [];
    try {
      const { createFilterReportRepository } = await import("../engine/index.js");
      filterReports = await createFilterReportRepository(storage).listByBook(bookId);
    } catch {
      // filter reports unavailable
    }

    const aiTasteByChapter = new Map<number, number>();
    for (const row of filterReports) {
      if (!aiTasteByChapter.has(row.chapterNumber)) {
        aiTasteByChapter.set(row.chapterNumber, row.aiTasteScore);
      }
    }

    const chapters: QualityTrendEntry[] = sorted.map((ch) => {
      const record = ch as Record<string, unknown>;
      const auditIssues = Array.isArray(record.auditIssues) ? record.auditIssues : null;
      const auditStatus: "passed" | "failed" | null =
        auditIssues !== null ? (auditIssues.length === 0 ? "passed" : "failed") : null;

      const qualityScore = typeof record.qualityScore === "number" ? record.qualityScore : null;
      const driftScore = typeof record.driftScore === "number" ? record.driftScore : null;
      const aiTastePercent = aiTasteByChapter.get(ch.number) ?? null;

      return {
        number: ch.number,
        qualityScore,
        aiTastePercent,
        auditStatus,
        driftScore,
      };
    });

    return c.json({ chapters });
  });

  return app;
}
