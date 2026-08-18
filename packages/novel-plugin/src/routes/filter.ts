import { Hono } from "hono";
import { createKvRepository, getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

export interface CreateFilterRouterOptions {
  storage?: StorageDatabase;
}

type EngineModule = typeof import("../engine/index.js");

async function loadEngine(): Promise<EngineModule> {
  return import("../engine/index.js");
}

/**
 * deslop 单独窄导入，不走 engine barrel。
 *
 * barrel 会连带加载 bundled-skills.generated.ts（20MB+ 的内置技能快照），
 * 首次调用要几秒。去 AI 味是编辑器里的同步交互，不能背这个启动成本，而且
 * 它对引擎其余部分没有任何依赖。
 */
async function loadDeslop(): Promise<typeof import("../engine/filter/deslop/index.js")> {
  return import("../engine/filter/deslop/index.js");
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

function serializeStoredReport(report: Awaited<ReturnType<ReturnType<EngineModule["createFilterReportRepository"]>["latestByChapter"]>>) {
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

  /**
   * 纯规则去 AI 味：0 LLM、同步返回。
   *
   * 返回体分两段：`text`/`edits` 是确定性改写结果，`manualFlags` 是需要语义
   * 判断、规则**没有**动的项。前端据此决定「直接应用候选」还是「转交叙述者」。
   */
  app.post("/api/filter/deslop", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) {
      return c.json({ error: "text is required" }, 400);
    }
    const whitelist = Array.isArray(body.whitelist)
      ? body.whitelist.filter((item): item is string => typeof item === "string")
      : undefined;
    const budget = typeof body.weakAdverbBudgetPer1000 === "number"
      && Number.isFinite(body.weakAdverbBudgetPer1000)
      && body.weakAdverbBudgetPer1000 >= 0
      ? body.weakAdverbBudgetPer1000
      : undefined;

    const { deslopText } = await loadDeslop();
    const result = deslopText(text, {
      ...(whitelist ? { whitelist } : {}),
      ...(budget !== undefined ? { weakAdverbBudgetPer1000: budget } : {}),
    });
    return c.json({ result });
  });

  app.post("/api/filter/scan", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const text = typeof body.text === "string" ? body.text : "";
    const core = await loadEngine();
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
    const core = await loadEngine();
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
    const core = await loadEngine();
    const report = await core.createFilterReportRepository(storage).latestByChapter(c.req.param("bookId"), Number(c.req.param("chapter")));
    return c.json({ report: serializeStoredReport(report) });
  });

  app.post("/api/filter/suggest-rewrite", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const core = await loadEngine();
    const ruleIds = Array.isArray(body.ruleIds) ? body.ruleIds.map(String) : [];
    return c.json({ suggestions: core.suggestSevenTactics(ruleIds) });
  });

  app.put("/api/settings/zhuque", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadEngine();
    const body = await c.req.json<Record<string, unknown>>();
    await createKvRepository(storage).set("settings:zhuque", JSON.stringify({
      apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      endpoint: typeof body.endpoint === "string" ? body.endpoint : "",
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : 10_000,
      retries: typeof body.retries === "number" ? body.retries : 2,
    }));
    return c.json({ ok: true });
  });

  app.post("/api/books/:bookId/filter/batch-rescan", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadEngine();
    const summaries = await core.createJingweiChapterSummaryRepository(storage).listByBook(c.req.param("bookId"));
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
