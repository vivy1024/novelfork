import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { createBookRepository } from "../repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import type {
  JingweiContextSource,
  JingweiReadCategory,
  JingweiReadableItem,
  JingweiSearchResult,
  StoryJingweiEntryRecord,
  StoryJingweiSectionRecord,
} from "../types.js";
import { isJingweiReadCategory } from "./category-map.js";
import { getEntrySummaryMd, toJingweiReadableItem } from "./entry-summary.js";
import { toFtsQuery, verifyMatch } from "../search/grams.js";
import { ensureBookFtsFresh, searchFtsCandidates } from "../search/fts-index.js";

export interface SearchJingweiInput {
  readonly bookId: string;
  readonly query: string;
  readonly categories?: readonly string[];
  readonly chapterNumber?: number;
  readonly tokenBudget?: number;
  readonly limit?: number;
  readonly storage?: StorageDatabase;
  /**
   * 是否纳入非 confirmed 条目（draft / needs-review）。
   * 默认 false（AI 只读已确认条目）；作者侧搜索传 true。
   */
  readonly includeUnconfirmed?: boolean;
}

interface RankedItem {
  readonly item: JingweiReadableItem;
  readonly score: number;
  readonly matchReason: string;
  readonly ftsScore: number;
}

function isVisibleAtChapter(entry: StoryJingweiEntryRecord, currentChapter: number): boolean {
  const { visibleAfterChapter, visibleUntilChapter } = entry.visibilityRule;
  if (visibleAfterChapter !== undefined && currentChapter < visibleAfterChapter) return false;
  if (visibleUntilChapter !== undefined && currentChapter > visibleUntilChapter) return false;
  return true;
}

function visibilitySource(entry: StoryJingweiEntryRecord): JingweiContextSource {
  if (entry.visibilityRule.type === "global") return "global";
  if (entry.visibilityRule.type === "tracked") return "tracked";
  return "nested";
}

function normalizeCategories(categories: readonly string[] | undefined): Set<JingweiReadCategory> | null {
  if (!categories || categories.length === 0) return null;
  const normalized = categories.filter(isJingweiReadCategory);
  return normalized.length > 0 ? new Set(normalized) : new Set();
}

const FIELD_WEIGHT: Readonly<Record<string, number>> = {
  title: 100,
  aliases: 90,
  tags: 80,
  keywords: 75,
  summary: 70,
  content: 50,
};

function entryFields(entry: StoryJingweiEntryRecord) {
  return {
    title: entry.title,
    aliases: entry.aliases,
    tags: entry.tags,
    keywords: entry.visibilityRule.keywords ?? [],
    summary: getEntrySummaryMd(entry),
    content: entry.contentMd,
  };
}

/**
 * 搜索预算必须保留相关性顺序：预算未超出时原样返回，超出时从尾部
 * （相关性最低）开始丢弃。通用 applyTokenBudget 会按静态 priority 重排，
 * 适合 brief，但会把搜索中的精确标题命中挤到泛化 core 条目之后。
 */
function applySearchTokenBudget(
  items: readonly JingweiReadableItem[],
  tokenBudget: number,
): { items: JingweiReadableItem[]; estimatedTokens: number; droppedEntryIds: string[] } {
  const kept = [...items];
  let estimatedTokens = kept.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const droppedEntryIds: string[] = [];

  if (tokenBudget < 0) {
    return { items: [], estimatedTokens: 0, droppedEntryIds: kept.map((item) => item.id) };
  }

  while (estimatedTokens > tokenBudget && kept.length > 0) {
    const removed = kept.pop();
    if (!removed) break;
    estimatedTokens -= removed.estimatedTokens;
    droppedEntryIds.push(removed.id);
  }

  return { items: kept, estimatedTokens: Math.max(0, estimatedTokens), droppedEntryIds };
}

export async function searchJingwei(input: SearchJingweiInput): Promise<JingweiSearchResult> {
  const query = input.query.trim();
  if (query.length === 0) throw new Error("Jingwei search query is empty.");

  const storage = input.storage ?? getStorageDatabase();
  const book = await createBookRepository(storage).getById(input.bookId);
  if (!book) throw new Error(`Book not found: ${input.bookId}`);

  const currentChapter = input.chapterNumber ?? book.currentChapter;
  const limit = Math.max(1, input.limit ?? 20);

  // 1) 索引自愈（兜住绕过 repo 的直写）
  ensureBookFtsFresh(storage, input.bookId);

  const fts = toFtsQuery(query);

  // 2) FTS 候选（标题/别名命中优先，窗口放宽到 limit×20）
  const candidates = searchFtsCandidates(storage, input.bookId, fts.expr, limit * 20, true);

  // 3) 按 ID 批量取行（保持 AI 可见性边界；避免逐条查询）
  const repo = createStoryJingweiEntryRepository(storage);
  const entryById = await repo.listByIds(input.bookId, candidates.map((candidate) => candidate.entryId));

  const sections = await createStoryJingweiSectionRepository(storage).listEnabledForAi(input.bookId);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const categoryFilter = normalizeCategories(input.categories);

  // 4) 精确校验 + 过滤（status / participates_in_ai / lifecycle / 可见性 / 分类）
  const ranked: RankedItem[] = [];
  for (const candidate of candidates) {
    const entry = entryById.get(candidate.entryId);
    if (!entry) continue;
    if (!entry.participatesInAi) continue;
    if (entry.lifecycle !== "active") continue;
    if (!input.includeUnconfirmed && entry.status !== "confirmed") continue;
    if (!isVisibleAtChapter(entry, currentChapter)) continue;
    const section = sectionById.get(entry.sectionId);
    if (!section) continue;
    const readable = toJingweiReadableItem(entry, section, visibilitySource(entry), "summary");
    if (categoryFilter && !categoryFilter.has(readable.category)) continue;

    const matchedFields = verifyMatch(query, entryFields(entry));
    // FTS 命中但精确校验失败（bigram 假阳性）→ 剔除
    if (fts.expr.length > 0 && matchedFields.length === 0) continue;

    const fieldScore = matchedFields.reduce((sum, field) => sum + (FIELD_WEIGHT[field] ?? 0), 0);
    // readable.priority 已综合 priorityTier / importance / sourceBonus / section.order
    const score = fieldScore + Math.max(0, candidate.score) + readable.priority / 100;
    ranked.push({
      item: readable,
      score,
      matchReason: matchedFields.length > 0 ? `命中：${matchedFields.join("/")}` : "模糊命中",
      ftsScore: candidate.score,
    });
  }

  // 5) 兜底：FTS 无可信结果时（空 expr / 假阳性全被剔除），降级为全量 LIKE 扫描
  const effectiveRanked =
    ranked.length > 0
      ? ranked
      : await fallbackLikeSearch(input, storage, currentChapter, categoryFilter, sectionById, repo, limit * 4, query);

  const sorted = effectiveRanked.sort(
    (a, b) => b.score - a.score || b.item.priority - a.item.priority || b.item.updatedAtMs - a.item.updatedAtMs || a.item.title.localeCompare(b.item.title),
  );
  const limited = sorted.slice(0, limit).map((ranked) => ({ ...ranked.item, matchReason: ranked.matchReason }));
  const budgeted = input.tokenBudget !== undefined
    ? applySearchTokenBudget(limited, input.tokenBudget)
    : {
        items: limited,
        estimatedTokens: limited.reduce((sum, item) => sum + item.estimatedTokens, 0),
        droppedEntryIds: [] as string[],
      };

  return {
    ok: true,
    bookId: input.bookId,
    query: input.query,
    items: budgeted.items,
    totalAvailable: sorted.length,
    returnedCount: budgeted.items.length,
    estimatedTokens: budgeted.estimatedTokens,
    droppedEntryIds: budgeted.droppedEntryIds,
  };
}

/**
 * 降级路径：FTS 不可用 / 无命中时，退化为逐条 includes 扫描
 * （与 narrative-memory/fts.ts 的 LIKE fallback 一致，保证功能不因索引缺失而断）。
 */
async function fallbackLikeSearch(
  input: SearchJingweiInput,
  storage: StorageDatabase,
  currentChapter: number,
  categoryFilter: Set<JingweiReadCategory> | null,
  sectionById: Map<string, StoryJingweiSectionRecord>,
  repo: ReturnType<typeof createStoryJingweiEntryRepository>,
  candidateLimit: number,
  query: string,
): Promise<RankedItem[]> {
  const sections = await createStoryJingweiSectionRepository(storage).listEnabledForAi(input.bookId);
  const entries = await repo.listForAi(input.bookId, sections.map((section) => section.id));
  const terms = query.split(/\s+/u).filter((part) => part.length > 0);
  if (terms.length === 0) return [];

  const ranked: RankedItem[] = [];
  for (const entry of entries) {
    if (!isVisibleAtChapter(entry, currentChapter)) continue;
    const section = sectionById.get(entry.sectionId);
    if (!section) continue;
    const readable = toJingweiReadableItem(entry, section, visibilitySource(entry), "summary");
    if (categoryFilter && !categoryFilter.has(readable.category)) continue;
    const matchedFields = verifyMatch(query, entryFields(entry));
    if (matchedFields.length === 0) continue;
    const fieldScore = matchedFields.reduce((sum, field) => sum + (FIELD_WEIGHT[field] ?? 0), 0);
    ranked.push({
      item: readable,
      score: fieldScore + readable.priority / 100,
      matchReason: `命中：${matchedFields.join("/")}`,
      ftsScore: 0,
    });
    if (ranked.length >= candidateLimit) break;
  }
  return ranked;
}
