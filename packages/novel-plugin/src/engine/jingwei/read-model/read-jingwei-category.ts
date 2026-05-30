import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { createBookRepository } from "../repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import type {
  JingweiContextSource,
  JingweiDetailLevel,
  JingweiReadCategory,
  JingweiReadCategoryResult,
  StoryJingweiEntryRecord,
} from "../types.js";
import { isJingweiReadCategory, resolveCategory, JINGWEI_READ_CATEGORIES } from "./category-map.js";
import { toJingweiReadableItem } from "./entry-summary.js";
import { applyTokenBudget, paginateItems } from "./token-budget.js";

export interface ReadJingweiCategoryInput {
  readonly bookId: string;
  readonly category: JingweiReadCategory | string;
  readonly chapterNumber?: number;
  readonly sceneText?: string;
  readonly page?: number;
  readonly limit?: number;
  readonly tokenBudget?: number;
  readonly detailLevel?: JingweiDetailLevel;
  readonly storage?: StorageDatabase;
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

function normalize(text: string | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function matchBoost(entry: StoryJingweiEntryRecord, sceneText: string): number {
  const haystack = normalize(sceneText);
  if (haystack.length === 0) return 0;
  const needles = [entry.title, ...entry.aliases, ...(entry.visibilityRule.keywords ?? []), ...entry.tags].map(normalize).filter(Boolean);
  return needles.some((needle) => haystack.includes(needle)) ? 5_000 : 0;
}

export async function readJingweiCategory(input: ReadJingweiCategoryInput): Promise<JingweiReadCategoryResult> {
  const category = isJingweiReadCategory(input.category) ? resolveCategory(input.category as string) : null;
  if (!category) {
    throw new Error(`Invalid Jingwei category: ${input.category}. Valid categories: ${JINGWEI_READ_CATEGORIES.join(", ")}. Aliases like "arc", "outline", "worldview" are also accepted.`);
  }

  const storage = input.storage ?? getStorageDatabase();
  const book = await createBookRepository(storage).getById(input.bookId);
  if (!book) throw new Error(`Book not found: ${input.bookId}`);

  const currentChapter = input.chapterNumber ?? book.currentChapter;
  const sections = await createStoryJingweiSectionRepository(storage).listEnabledForAi(input.bookId);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const entries = (await createStoryJingweiEntryRepository(storage).listForAi(input.bookId, sections.map((section) => section.id)))
    .filter((entry) => isVisibleAtChapter(entry, currentChapter));
  const detailLevel = input.detailLevel ?? "summary";
  const sceneText = input.sceneText ?? "";

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const allItems = entries.map((entry) => {
    const section = sectionById.get(entry.sectionId);
    if (!section) return null;
    return toJingweiReadableItem(entry, section, visibilitySource(entry), detailLevel);
  }).filter((item): item is NonNullable<typeof item> => item !== null)
    .filter((item) => item.category === category)
    .sort((a, b) => matchBoost(entryById.get(b.entryId)!, sceneText) - matchBoost(entryById.get(a.entryId)!, sceneText) || b.priority - a.priority || b.updatedAtMs - a.updatedAtMs || a.title.localeCompare(b.title));

  const budgeted = input.tokenBudget ? applyTokenBudget(allItems, input.tokenBudget) : { items: allItems, estimatedTokens: allItems.reduce((sum, item) => sum + item.estimatedTokens, 0), droppedEntryIds: [] };
  const paged = paginateItems(budgeted.items, input.page, input.limit);

  return {
    ok: true,
    bookId: input.bookId,
    category,
    items: paged.items,
    page: paged.page,
    limit: paged.limit,
    totalAvailable: budgeted.items.length,
    returnedCount: paged.items.length,
    hasMore: paged.hasMore,
    nextPage: paged.nextPage,
    estimatedTokens: paged.items.reduce((sum, item) => sum + item.estimatedTokens, 0),
    droppedEntryIds: budgeted.droppedEntryIds,
  };
}
