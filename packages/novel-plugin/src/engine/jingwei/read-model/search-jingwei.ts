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
} from "../types.js";
import { isJingweiReadCategory } from "./category-map.js";
import { getEntrySummaryMd, toJingweiReadableItem } from "./entry-summary.js";
import { applyTokenBudget } from "./token-budget.js";

export interface SearchJingweiInput {
  readonly bookId: string;
  readonly query: string;
  readonly categories?: readonly string[];
  readonly chapterNumber?: number;
  readonly tokenBudget?: number;
  readonly limit?: number;
  readonly storage?: StorageDatabase;
}

type ScoredItem = JingweiReadableItem & {
  readonly score: number;
  readonly matchReason: string;
};

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

function normalize(text: string | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function scoreEntry(entry: StoryJingweiEntryRecord, query: string): { score: number; reason: string } {
  const q = normalize(query);
  if (q.length === 0) return { score: 0, reason: "empty-query" };
  if (normalize(entry.title).includes(q)) return { score: 100, reason: "标题命中" };
  if (entry.aliases.some((alias) => normalize(alias).includes(q))) return { score: 90, reason: "别名命中" };
  if (entry.tags.some((tag) => normalize(tag).includes(q))) return { score: 80, reason: "标签命中" };
  if ((entry.visibilityRule.keywords ?? []).some((keyword) => normalize(keyword).includes(q))) return { score: 75, reason: "关键词命中" };
  if (normalize(getEntrySummaryMd(entry)).includes(q)) return { score: 70, reason: "摘要命中" };
  if (normalize(entry.contentMd).includes(q)) return { score: 50, reason: "正文命中" };
  return { score: 0, reason: "未命中" };
}

function normalizeCategories(categories: readonly string[] | undefined): Set<JingweiReadCategory> | null {
  if (!categories || categories.length === 0) return null;
  const normalized = categories.filter(isJingweiReadCategory);
  return normalized.length > 0 ? new Set(normalized) : new Set();
}

export async function searchJingwei(input: SearchJingweiInput): Promise<JingweiSearchResult> {
  if (input.query.trim().length === 0) throw new Error("Jingwei search query is empty.");

  const storage = input.storage ?? getStorageDatabase();
  const book = await createBookRepository(storage).getById(input.bookId);
  if (!book) throw new Error(`Book not found: ${input.bookId}`);

  const currentChapter = input.chapterNumber ?? book.currentChapter;
  const sections = await createStoryJingweiSectionRepository(storage).listEnabledForAi(input.bookId);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const categoryFilter = normalizeCategories(input.categories);
  const entries = (await createStoryJingweiEntryRepository(storage).listForAi(input.bookId, sections.map((section) => section.id)))
    .filter((entry) => isVisibleAtChapter(entry, currentChapter));

  const scored: ScoredItem[] = [];
  for (const entry of entries) {
    const section = sectionById.get(entry.sectionId);
    if (!section) continue;
    const readable = toJingweiReadableItem(entry, section, visibilitySource(entry), "summary");
    if (categoryFilter && !categoryFilter.has(readable.category)) continue;
    const score = scoreEntry(entry, input.query);
    if (score.score <= 0) continue;
    scored.push({ ...readable, score: score.score, matchReason: score.reason });
  }

  const sorted = scored.sort((a, b) => b.score - a.score || b.priority - a.priority || b.updatedAtMs - a.updatedAtMs || a.title.localeCompare(b.title));
  const limited = sorted.slice(0, input.limit ?? 20);
  const budgeted = input.tokenBudget ? applyTokenBudget(limited, input.tokenBudget) : { items: limited, estimatedTokens: limited.reduce((sum, item) => sum + item.estimatedTokens, 0), droppedEntryIds: [] };

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
