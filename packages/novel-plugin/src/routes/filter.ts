import { Hono } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

export interface CreateFilterRouterOptions {
  storage?: StorageDatabase;
}

type CoreModule = typeof import("@vivy1024/novelfork-core");

async function loadCore(): Promise<CoreModule> {
  return import("@vivy1024/novelfork-core");
}

async function resolveStorage(options: CreateFilterRouterOptions): Promise<StorageDatabase> {
  return options.storage ?? getStorageDatabase();
}

function parseDetails(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function serializeStoredReport(report: Awaited<ReturnType<ReturnType<CoreModule["createFilterReportRepository"]>["latestByChapter"]>>) {
  if (!report) return null;
  return {
    ...report,
    hitCounts: parseDetails(report.hitCountsJson),
    details: parseDetails(report.details),
  };
}

function summarize(reports: Array<NonNullable<ReturnType<typeof serializeStoredReport>>>) {
  const total = reports.length;
  const avgScore = total === 0 ? 0 : Math.round(reports.reduce((sum, report) => sum + report.aiTasteScore, 0) / total);
  return { avgScore, totalChapters: total };
}

export function createFilterRouter(options: CreateFilterRouterOptions = {}): Hono {
  const app = new Hono();

  app.post("/api/filter/scan", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const text = typeof body.text === "string" ? body.text : "";
    const core = await loadCore();
    if (body.persist && typeof body.bookId === "string" && typeof body.chapterNumber === "number") {
      const storage = await resolveStorage(options);
      const report = await core.scanChapterAndStoreFilterReport(storage, {
        bookId: body.bookId,
        chapterNumber: body.chapterNumber,
        text,
      });
      return c.json({ report });
    }
    const report = await core.runFilter(text);
    return c.json({ report });
  });

  app.get("/api/books/:bookId/filter/report", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadCore();
    const rows = await core.createFilterReportRepository(storage).listByBook(c.req.param("bookId"));
    const latestByChapter = new Map<number, ReturnType<typeof serializeStoredReport>>();
    for (const row of rows) {
      if (!latestByChapter.has(row.chapterNumber)) latestByChapter.set(row.chapterNumber, serializeStoredReport(row));
    }
    const reports = [...latestByChapter.values()].filter((report): report is NonNullable<typeof report> => report !== null);
    const pgiReports = reports.filter((report) => (report.details as { pgiUsed?: boolean }).pgiUsed === true);
    const nonPgiReports = reports.filter((report) => (report.details as { pgiUsed?: boolean }).pgiUsed !== true);
    return c.json({
      overall: summarize(reports),
      reports,
      ...(c.req.query("groupByPgi") === "true" ? {
        pgiUsed: { avgScore: summarize(pgiReports).avgScore, count: pgiReports.length },
        pgiNotUsed: { avgScore: summarize(nonPgiReports).avgScore, count: nonPgiReports.length },
      } : {}),
    });
  });

  app.get("/api/books/:bookId/filter/report/:chapter", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadCore();
    const report = await core.createFilterReportRepository(storage).latestByChapter(c.req.param("bookId"), Number(c.req.param("chapter")));
    return c.json({ report: serializeStoredReport(report) });
  });

  app.post("/api/filter/suggest-rewrite", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const core = await loadCore();
    const ruleIds = Array.isArray(body.ruleIds) ? body.ruleIds.map(String) : [];
    return c.json({ suggestions: core.suggestSevenTactics(ruleIds) });
  });

  app.put("/api/settings/zhuque", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadCore();
    const body = await c.req.json<Record<string, unknown>>();
    await core.createKvRepository(storage).set("settings:zhuque", JSON.stringify({
      apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      endpoint: typeof body.endpoint === "string" ? body.endpoint : "",
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : 10_000,
      retries: typeof body.retries === "number" ? body.retries : 2,
    }));
    return c.json({ ok: true });
  });

  app.post("/api/books/:bookId/filter/batch-rescan", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadCore();
    const summaries = await core.createBibleChapterSummaryRepository(storage).listByBook(c.req.param("bookId"));
    const reports = [];
    for (const summary of summaries) {
      reports.push(await core.scanChapterAndStoreFilterReport(storage, {
        bookId: summary.bookId,
        chapterNumber: summary.chapterNumber,
        text: summary.summary,
      }));
    }
    return c.json({ count: reports.length, reports });
  });

  return app;
}
