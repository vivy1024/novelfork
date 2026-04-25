import { getStorageDatabase, type StorageDatabase } from "../../storage/db.js";
import type {
  BibleChapterSummaryRecord,
  BibleCharacterRecord,
  BibleContextItem,
  BibleEventRecord,
  BibleMode,
  BibleSettingRecord,
  BuildBibleContextInput,
  BuildBibleContextResult,
  VisibilityRule,
} from "../types.js";
import { createBookRepository } from "../repositories/book-repo.js";
import { createBibleCharacterRepository } from "../repositories/character-repo.js";
import { createBibleChapterSummaryRepository } from "../repositories/chapter-summary-repo.js";
import { createBibleEventRepository } from "../repositories/event-repo.js";
import { createBibleSettingRepository } from "../repositories/setting-repo.js";
import { matchTrackedByAliases } from "./alias-matcher.js";
import { composeBibleContext, type ComposableBibleContextItem } from "./compose-context.js";
import { resolveNestedRefs } from "./nested-resolver.js";
import { estimateTokens } from "./token-budget.js";
import { filterEntriesVisibleAtChapter, getVisibilityRule } from "./visibility-filter.js";

export interface BuildBibleContextOptions extends BuildBibleContextInput {
  storage?: StorageDatabase;
}

interface CandidateBibleContextItem extends ComposableBibleContextItem {
  aliasesJson?: string;
  nestedRefsJson?: string;
  visibilityRule: VisibilityRule;
  visibilityRuleJson: string;
}

function sourceFromRule(rule: VisibilityRule): BibleContextItem["source"] {
  return rule.type;
}

function priorityFromSource(source: BibleContextItem["source"]): number {
  if (source === "global") return 30;
  if (source === "nested") return 20;
  return 10;
}

function makeItem(input: {
  id: string;
  type: BibleContextItem["type"];
  category?: string;
  name: string;
  rawContent: string;
  source: BibleContextItem["source"];
  aliasesJson?: string;
  nestedRefsJson?: string;
  visibilityRule: VisibilityRule;
  visibilityRuleJson: string;
  updatedAt: Date;
}): CandidateBibleContextItem {
  return {
    id: input.id,
    type: input.type,
    ...(input.category ? { category: input.category } : {}),
    name: input.name,
    content: input.rawContent,
    rawContent: input.rawContent,
    priority: priorityFromSource(input.source),
    source: input.source,
    estimatedTokens: estimateTokens(input.rawContent),
    aliasesJson: input.aliasesJson,
    nestedRefsJson: input.nestedRefsJson,
    visibilityRule: input.visibilityRule,
    visibilityRuleJson: input.visibilityRuleJson,
    updatedAt: input.updatedAt,
  };
}

function characterToItem(row: BibleCharacterRecord): CandidateBibleContextItem {
  const visibilityRule = getVisibilityRule(row);
  return makeItem({
    id: row.id,
    type: "character",
    name: row.name,
    rawContent: row.summary,
    source: sourceFromRule(visibilityRule),
    aliasesJson: row.aliasesJson,
    nestedRefsJson: "[]",
    visibilityRule,
    visibilityRuleJson: row.visibilityRuleJson,
    updatedAt: row.updatedAt,
  });
}

function eventToItem(row: BibleEventRecord): CandidateBibleContextItem {
  const visibilityRule = getVisibilityRule(row);
  return makeItem({
    id: row.id,
    type: "event",
    name: row.name,
    rawContent: row.summary,
    source: sourceFromRule(visibilityRule),
    aliasesJson: JSON.stringify([row.name]),
    nestedRefsJson: "[]",
    visibilityRule,
    visibilityRuleJson: row.visibilityRuleJson,
    updatedAt: row.updatedAt,
  });
}

function settingToItem(row: BibleSettingRecord): CandidateBibleContextItem {
  const visibilityRule = getVisibilityRule(row);
  return makeItem({
    id: row.id,
    type: "setting",
    category: row.category,
    name: row.name,
    rawContent: row.content,
    source: sourceFromRule(visibilityRule),
    aliasesJson: JSON.stringify([row.name]),
    nestedRefsJson: row.nestedRefsJson,
    visibilityRule,
    visibilityRuleJson: row.visibilityRuleJson,
    updatedAt: row.updatedAt,
  });
}

function chapterSummaryToItem(row: BibleChapterSummaryRecord): CandidateBibleContextItem {
  const visibilityRule: VisibilityRule = { type: "global", visibleAfterChapter: row.chapterNumber };
  return makeItem({
    id: row.id,
    type: "chapter-summary",
    name: row.title || `第 ${row.chapterNumber} 章`,
    rawContent: row.summary,
    source: "global",
    aliasesJson: "[]",
    nestedRefsJson: "[]",
    visibilityRule,
    visibilityRuleJson: JSON.stringify(visibilityRule),
    updatedAt: row.updatedAt,
  });
}

function dedupeByBestSource<TItem extends ComposableBibleContextItem>(items: readonly TItem[]): TItem[] {
  const rank: Record<BibleContextItem["source"], number> = { global: 3, nested: 2, tracked: 1 };
  const byId = new Map<string, TItem>();

  for (const item of items) {
    const current = byId.get(item.id);
    if (!current || rank[item.source] > rank[current.source]) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values());
}

async function loadAllCandidateEntries(storage: StorageDatabase, bookId: string, currentChapter: number): Promise<CandidateBibleContextItem[]> {
  const characters = await createBibleCharacterRepository(storage).listByBook(bookId);
  const events = await createBibleEventRepository(storage).listByBook(bookId);
  const settings = await createBibleSettingRepository(storage).listByBook(bookId);
  const summaries = (await createBibleChapterSummaryRepository(storage).listByBook(bookId))
    .filter((summary) => summary.chapterNumber <= currentChapter);

  return [
    ...characters.map(characterToItem),
    ...events.map(eventToItem),
    ...settings.map(settingToItem),
    ...summaries.map(chapterSummaryToItem),
  ];
}

function markNested(item: CandidateBibleContextItem): CandidateBibleContextItem {
  return {
    ...item,
    source: "nested",
    priority: priorityFromSource("nested"),
  };
}

export async function injectPremise(): Promise<ComposableBibleContextItem[]> {
  return [];
}

export async function injectWorldModel(): Promise<ComposableBibleContextItem[]> {
  return [];
}

export async function injectConflicts(): Promise<ComposableBibleContextItem[]> {
  return [];
}

export async function injectCharacterArcs(): Promise<ComposableBibleContextItem[]> {
  return [];
}

export async function buildBibleContext(input: BuildBibleContextOptions): Promise<BuildBibleContextResult> {
  const storage = input.storage ?? getStorageDatabase();
  const book = await createBookRepository(storage).getById(input.bookId);
  if (!book) {
    throw new Error(`Book not found: ${input.bookId}`);
  }

  const mode: BibleMode = book.bibleMode;
  const currentChapter = input.currentChapter ?? book.currentChapter;
  const allEntries = await loadAllCandidateEntries(storage, input.bookId, currentChapter);
  const timelineFiltered = filterEntriesVisibleAtChapter(allEntries, currentChapter);
  const phaseBItems = [
    ...await injectPremise(),
    ...await injectWorldModel(),
    ...await injectConflicts(),
    ...await injectCharacterArcs(),
  ];

  if (mode === "static") {
    return composeBibleContext([
      ...phaseBItems,
      ...timelineFiltered.filter((entry) => entry.visibilityRule.type === "global"),
    ], { mode, tokenBudget: input.tokenBudget });
  }

  const globals = timelineFiltered.filter((entry) => entry.visibilityRule.type === "global");
  if (!input.sceneText) {
    return composeBibleContext([...phaseBItems, ...globals], { mode, tokenBudget: input.tokenBudget });
  }

  const trackedCandidates = timelineFiltered.filter((entry) => entry.visibilityRule.type === "tracked");
  const tracked = matchTrackedByAliases(trackedCandidates, input.sceneText);
  const nested = resolveNestedRefs([...globals, ...tracked], timelineFiltered, { maxDepth: 3 }).map(markNested);
  const merged = dedupeByBestSource([...phaseBItems, ...globals, ...tracked, ...nested]);

  return composeBibleContext(merged, { mode, tokenBudget: input.tokenBudget });
}
