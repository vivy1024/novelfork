import { platformLabel, rankLabel } from "./config.js";
import { inspectSnapshot, latestSnapshots, snapshotHealthLines } from "./report.js";
import { listSnapshots, loadRankAppearances, okRecords, type SnapshotFilter } from "./snapshot-store.js";
import type { AnalysisReport, RankRecord } from "./types.js";

const TITLE_STOP_WORDS = new Set(["的", "了", "我", "你", "他", "她", "是", "在", "和", "与", "之"]);

function countBy(values: readonly string[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const value of values) {
    const key = value.trim() || "未分类";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
}

function titleTokens(title: string): string[] {
  return [...title.matchAll(/[\u4e00-\u9fff]{2,}|[A-Za-z]{3,}|\d+/g)]
    .map((match) => match[0]!)
    .filter((token) => !TITLE_STOP_WORDS.has(token));
}

function wordBucket(wordCount: number | undefined): string {
  if (!wordCount || wordCount <= 0) return "未知";
  if (wordCount < 100_000) return "<10万";
  if (wordCount < 500_000) return "10-50万";
  if (wordCount < 1_000_000) return "50-100万";
  if (wordCount < 3_000_000) return "100-300万";
  return "300万+";
}

export async function generateAnalysis(
  platform: string,
  options: { readonly filter?: SnapshotFilter; readonly now?: () => Date; readonly store?: Parameters<typeof listSnapshots>[1] } = {},
): Promise<AnalysisReport> {
  const filter = { ...options.filter, platform };
  const now = options.now?.() ?? new Date();
  const snapshots = await listSnapshots(filter, options.store);
  const latest = latestSnapshots(snapshots);
  const fresh = latest.filter((snapshot) => inspectSnapshot(snapshot, now).health === "ok");
  const records = fresh.flatMap((snapshot) => okRecords(snapshot.records));
  const uniqueBooks = new Map<string, RankRecord>();
  for (const record of records) {
    if (!uniqueBooks.has(record.book_id)) uniqueBooks.set(record.book_id, record);
  }
  const categories = countBy([...uniqueBooks.values()].map((record) => record.category));
  const tokens = countBy([...uniqueBooks.values()].flatMap((record) => titleTokens(record.title)));
  const words = countBy([...uniqueBooks.values()].map((record) => wordBucket(record.word_count)));
  const appearances = await loadRankAppearances(filter, options.store);
  const crossList = [...appearances.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const generatedAt = now.toISOString();
  const topCategories = categories.slice(0, 8).map(([name]) => name);
  const healthLines = snapshotHealthLines(snapshots, now);
  const markdown = [
    `# ${platformLabel(platform)}市场快照分析`,
    "",
    `- 生成时间：${generatedAt}`,
    `- 快照数：${snapshots.length}`,
    `- 仍算最新的在榜书：${uniqueBooks.size}`,
    "",
    "## 来源与时效",
    ...(healthLines.length > 0 ? healthLines.map((line) => `- ${line}`) : ["- 还没有快照"]),
    "",
    "## 题材分布",
    ...categories.slice(0, 12).map(([name, count]) => `- ${name}：${count}`),
    "",
    "## 标题高频",
    ...tokens.slice(0, 15).map(([token, count]) => `- ${token}：${count}`),
    "",
    "## 字数分布",
    ...words.map(([bucket, count]) => `- ${bucket}：${count}`),
    "",
    "## 跨榜出现",
    ...(crossList.length > 0
      ? crossList.map(([bookId, count]) => {
        const book = uniqueBooks.get(bookId);
        return `- ${book?.title ?? bookId}（${count} 次）`;
      })
      : ["- 暂无跨榜重复"]),
    "",
    "## 最新榜单样本",
    ...fresh.flatMap((snapshot) => [
      `### ${rankLabel(snapshot.rank_type)}（${snapshot.observed_at}）`,
      ...okRecords(snapshot.records).slice(0, 10).map((record) => `- ${record.rank}. ${record.title} / ${record.author} / ${record.category || "未分类"}`),
      "",
    ]),
    ...(fresh.length === 0 ? ["- 没有仍算最新的有效榜，不能拿旧快照当今天的市场结论。", ""] : []),
  ].join("\n");

  return {
    platform,
    generated_at: generatedAt,
    summary: {
      total_books: uniqueBooks.size,
      total_snapshots: snapshots.length,
      top_categories: topCategories,
    },
    markdown,
  };
}
