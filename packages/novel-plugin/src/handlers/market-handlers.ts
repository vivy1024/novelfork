import {
  MAX_PUBLIC_CHAPTER_SAMPLES,
  queryMarket,
  samplePublicChapters,
  scanMarketWithReport,
  type BookSnapshot,
  type MarketScanReport,
  type PublicChapterSample,
  type RankScanReport,
} from "../engine/market/index.js";

export interface MarketScanToolInput {
  readonly platform?: "qidian" | "fanqie" | "all";
  readonly rankTypes?: readonly string[];
  readonly maxPages?: number;
}

export interface MarketQueryToolInput {
  readonly platform?: "qidian" | "fanqie";
  readonly rankType?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly analyze?: boolean;
}

export interface MarketSampleToolInput {
  readonly fanqieBookId: string;
  readonly maxChapters?: number;
}

type ToolSuccess<T> = { ok: true; summary: string; data: T };
type ToolFailure = { ok: false; error: string; summary: string };
type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export async function handleMarketScan(input: MarketScanToolInput = {}): Promise<ToolResult<{
  snapshots: BookSnapshot[];
  report: MarketScanReport;
}>> {
  try {
    const { snapshots, report } = await scanMarketWithReport({
      platform: input.platform,
      rankTypes: input.rankTypes,
      maxPages: input.maxPages,
    });
    if (!report.ok) {
      return {
        ok: false,
        error: "market-scan-failed",
        summary: report.summary,
      };
    }
    return {
      ok: true,
      summary: report.summary,
      data: { snapshots, report },
    };
  } catch (error) {
    return {
      ok: false,
      error: "market-scan-failed",
      summary: `市场扫榜失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function handleMarketQuery(input: MarketQueryToolInput = {}): Promise<ToolResult<unknown>> {
  try {
    const result = await queryMarket({
      platform: input.platform,
      rankType: input.rankType,
      fromDate: input.fromDate,
      toDate: input.toDate,
      analyze: input.analyze,
    });
    const staleOrFailed = (result.ranks ?? []).filter((rank: RankScanReport) => rank.health !== "ok");
    const extra = staleOrFailed.length > 0
      ? `其中 ${staleOrFailed.length} 个榜失败或过期：${staleOrFailed.map((rank) => rank.reason).join(" ")}`
      : "当前展示的是仍算最新的有效榜。";
    return {
      ok: true,
      summary: `查到 ${result.snapshots.length} 个历史快照${result.analysis ? "，并生成题材分析" : ""}。${extra}`,
      data: result,
    };
  } catch (error) {
    return {
      ok: false,
      error: "market-query-failed",
      summary: `市场查询失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function handleMarketSamplePublicChapters(
  input: MarketSampleToolInput,
): Promise<ToolResult<{ samples: PublicChapterSample[] }>> {
  const bookId = input.fanqieBookId?.trim();
  if (!bookId) {
    return { ok: false, error: "invalid-input", summary: "fanqieBookId 必填。" };
  }
  try {
    const samples = await samplePublicChapters({
      book_id: bookId,
      maxChapters: Math.min(input.maxChapters ?? MAX_PUBLIC_CHAPTER_SAMPLES, MAX_PUBLIC_CHAPTER_SAMPLES),
    });
    return {
      ok: true,
      summary: `已采样 ${samples.length} 章公开结构指标，未保存正文。`,
      data: { samples },
    };
  } catch (error) {
    return {
      ok: false,
      error: "market-sample-failed",
      summary: `公开章节采样失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
