import {
  MAX_PUBLIC_CHAPTER_SAMPLES,
  queryMarket,
  samplePublicChapters,
  scanMarket,
  type BookSnapshot,
  type PublicChapterSample,
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

function okRecords(snapshots: readonly BookSnapshot[]): number {
  return snapshots.reduce(
    (sum, snapshot) => sum + snapshot.records.filter((record) => record.source_status === "ok" && record.book_id).length,
    0,
  );
}

export async function handleMarketScan(input: MarketScanToolInput = {}): Promise<ToolResult<{ snapshots: BookSnapshot[] }>> {
  try {
    const snapshots = await scanMarket({
      platform: input.platform,
      rankTypes: input.rankTypes,
      maxPages: input.maxPages,
    });
    const books = okRecords(snapshots);
    return {
      ok: true,
      summary: `已扫描 ${snapshots.length} 个榜单快照，有效书籍 ${books} 本。榜单数据与经纬/Lore 分离，未写入设定库。`,
      data: { snapshots },
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
    return {
      ok: true,
      summary: `查到 ${result.snapshots.length} 个历史快照${result.analysis ? "，并生成题材分析" : ""}。`,
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
