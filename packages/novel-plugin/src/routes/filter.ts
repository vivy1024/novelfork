import { Hono, type Context } from "hono";
import { createKvRepository, getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";
import { checkPublicHttpEndpoint, explainEndpointRejection, type HostResolver } from "../engine/net-guard.js";
import { decryptSecret, encryptSecret, SecretKeyFileError } from "../engine/secret-box.js";
import { clampZhuqueRetries, clampZhuqueTimeoutMs, getZhuqueConfigFromKv } from "../engine/filter/zhuque/client.js";
import type { DiagnosticExplanation } from "../handlers/diagnostic-explanation.js";

export interface CreateFilterRouterOptions {
  storage?: StorageDatabase;
  /** 测试注入点：朱雀检测使用的 fetch，默认为全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 测试注入点：域名解析，默认为 node:dns 的 lookup(host, { all: true })。 */
  resolveHost?: HostResolver;
}

const DNS_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * 默认域名解析：node:dns 的 lookup(host, { all: true })，返回全部地址供逐个核对。
 * 懒加载 node:dns，避免把 Node 内置模块带进经 routes barrel 进入浏览器打包的路径；
 * 解析超时视为失败（调用方按「不可用」处理）。
 */
const defaultResolveHost: HostResolver = async (hostname) => {
  const { lookup } = await import("node:dns/promises");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("dns lookup timeout")), DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
    return answers.map((answer) => answer.address);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

function explainedError(c: Context, status: 400 | 500, code: string, error: string, explanation: DiagnosticExplanation) {
  return c.json({ error, code, explanation }, status);
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

/**
 * 读取已保存的朱雀配置（apiKey 解密）。只在用户手动扫描时调用，写章管线不经过这里，
 * 因此自动写作不会对外发送正文。未配置时返回 null，行为与未接通前一致。
 *
 * 配置 JSON 损坏、或密钥解不开（主密钥换过、密文被改）时按「未配置」处理并记一条 warn，
 * 不让整个扫描 500：规则检测照常出结果，外部检测显示未配置，作者重新保存一次即可恢复。
 * 发请求前的地址复核（协议、内网、DNS）在 scanWithZhuque 里完成，这里注入解析器。
 */
async function loadZhuqueConfig(options: CreateFilterRouterOptions) {
  const storage = await resolveStorage(options);
  let config: Awaited<ReturnType<typeof getZhuqueConfigFromKv>>;
  try {
    config = await getZhuqueConfigFromKv(createKvRepository(storage), decryptSecret);
  } catch (error) {
    const kind = error instanceof SyntaxError ? "配置 JSON 已损坏" : "密钥无法解密";
    console.warn(`[filter] 已保存的朱雀检测配置无法读取（${kind}），本次按未配置处理；请在朱雀检测设置里重新保存地址与密钥。`);
    return null;
  }
  if (!config) return null;
  return {
    ...config,
    resolveHost: options.resolveHost ?? defaultResolveHost,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
}

function parseDetails(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * 旧版本把朱雀上游响应体原样存进了报告 details.zhuque.raw；读出时只保留状态、分数与错误，
 * 不把上游内容回传给前端（库里的历史行属于用户数据，不在读取路径上改写）。
 */
function stripZhuqueRaw(details: Record<string, unknown>): Record<string, unknown> {
  const zhuque = details.zhuque;
  if (!zhuque || typeof zhuque !== "object" || Array.isArray(zhuque)) return details;
  const { status, score, error } = zhuque as { status?: unknown; score?: unknown; error?: unknown };
  return {
    ...details,
    zhuque: {
      ...(status !== undefined ? { status } : {}),
      ...(typeof score === "number" ? { score } : {}),
      ...(typeof error === "string" ? { error } : {}),
    },
  };
}

function serializeStoredReport(report: Awaited<ReturnType<ReturnType<EngineModule["createFilterReportRepository"]>["latestByChapter"]>>) {
  if (!report) return null;
  return {
    ...report,
    hitCounts: parseDetails(report.hitCountsJson),
    details: stripZhuqueRaw(parseDetails(report.details)),
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
    const zhuqueConfig = await loadZhuqueConfig(options);
    if (body.persist && typeof body.bookId === "string" && typeof body.chapterNumber === "number") {
      const storage = await resolveStorage(options);
      const report = await core.scanChapterAndStoreFilterReport(storage, {
        bookId: body.bookId,
        chapterNumber: body.chapterNumber,
        text,
        zhuqueConfig,
      });
      return c.json({ report });
    }
    const report = await core.runFilter(text, { zhuqueConfig });
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

  /**
   * 保存朱雀检测配置（全局配置，影响所有书与用户）。只允许管理员写——由产品层 domain.ts 的
   * 统一守卫负责，本路由不感知身份。保存时完整校验地址：只允许 http(s)、不得指向内网，
   * 域名还要用 DNS 解析结果核对；发请求前 scanWithZhuque 会再校验一次。
   */
  app.put("/api/settings/zhuque", async (c) => {
    const storage = await resolveStorage(options);
    const parsed = await c.req.json<unknown>().catch(() => undefined);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return explainedError(c, 400, "ZHUQUE_SETTINGS_INVALID_BODY", "朱雀检测配置的请求体不是 JSON 对象。", {
        whatHappened: "保存朱雀检测配置时收到的请求体无法解析为 JSON 对象，配置没有改动。",
        whyItMatters: "无法确认要保存的地址与密钥，继续保存可能写入残缺配置，导致之后的检测全部失败。",
        suggestedAction: "以 JSON 对象提交 endpoint、apiKey（可选 timeoutMs、retries）后重试。",
      });
    }
    const body = parsed as Record<string, unknown>;
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (endpoint) {
      const check = await checkPublicHttpEndpoint(endpoint, options.resolveHost ?? defaultResolveHost);
      if (!check.ok) {
        return explainedError(c, 400, "ZHUQUE_ENDPOINT_REJECTED", "朱雀检测服务地址不可用，配置没有保存。", explainEndpointRejection(check.reason, "朱雀检测服务"));
      }
    }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    let sealedKey: Awaited<ReturnType<typeof encryptSecret>> | "" = "";
    try {
      sealedKey = apiKey ? await encryptSecret(apiKey) : "";
    } catch (error) {
      // 主密钥文件损坏：不自动换新密钥（会让旧密文永远解不开），原样把说明交给管理员。
      if (error instanceof SecretKeyFileError) {
        return explainedError(c, 500, error.code, "主密钥文件不可用，朱雀检测配置没有保存。", error.explanation);
      }
      throw error;
    }
    await createKvRepository(storage).set("settings:zhuque", JSON.stringify({
      apiKey: sealedKey,
      endpoint,
      timeoutMs: clampZhuqueTimeoutMs(body.timeoutMs),
      retries: clampZhuqueRetries(body.retries),
    }));
    return c.json({ ok: true });
  });

  app.post("/api/books/:bookId/filter/batch-rescan", async (c) => {
    const storage = await resolveStorage(options);
    const core = await loadEngine();
    const zhuqueConfig = await loadZhuqueConfig(options);
    const summaries = await core.createJingweiChapterSummaryRepository(storage).listByBook(c.req.param("bookId"));
    const reports = [];
    for (const summary of summaries) {
      reports.push(await core.scanChapterAndStoreFilterReport(storage, {
        bookId: summary.bookId,
        chapterNumber: summary.chapterNumber,
        text: summary.summary,
        zhuqueConfig,
      }));
    }
    return c.json({ count: reports.length, reports });
  });

  return app;
}
