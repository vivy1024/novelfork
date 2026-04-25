import { getStorageDatabase, type StorageDatabase } from "../../storage/db.js";
import type {
  BibleChapterSummaryRecord,
  BibleCharacterArcRecord,
  BibleCharacterRecord,
  BibleConflictRecord,
  BibleContextItem,
  BibleEventRecord,
  BibleMode,
  BiblePremiseRecord,
  BibleSettingRecord,
  BibleWorldModelRecord,
  BuildBibleContextInput,
  BuildBibleContextResult,
  VisibilityRule,
} from "../types.js";
import { createBookRepository } from "../repositories/book-repo.js";
import { createBibleCharacterRepository } from "../repositories/character-repo.js";
import { createBibleChapterSummaryRepository } from "../repositories/chapter-summary-repo.js";
import { createBibleCharacterArcRepository } from "../repositories/character-arc-repo.js";
import { createBibleConflictRepository } from "../repositories/conflict-repo.js";
import { createBibleEventRepository } from "../repositories/event-repo.js";
import { createBiblePremiseRepository } from "../repositories/premise-repo.js";
import { createBibleSettingRepository } from "../repositories/setting-repo.js";
import { createBibleWorldModelRepository } from "../repositories/world-model-repo.js";
import { matchTrackedByAliases } from "./alias-matcher.js";
import { composeBibleContext, type ComposableBibleContextItem } from "./compose-context.js";
import { resolveNestedRefs } from "./nested-resolver.js";
import { estimateTokens } from "./token-budget.js";
import { filterEntriesVisibleAtChapter, getVisibilityRule } from "./visibility-filter.js";
import { formatDescriptor, hasDescriptorContent, safeParseDescriptor } from "./format-descriptor.js";

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

function premiseToItem(row: BiblePremiseRecord): ComposableBibleContextItem | null {
  const parts = [
    row.logline,
    row.tone ? `基调 ${row.tone}` : "",
    row.targetReaders ? `目标读者 ${row.targetReaders}` : "",
    row.uniqueHook ? `差异化钩子 ${row.uniqueHook}` : "",
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const rawContent = parts.join(" · ");
  return {
    id: row.id,
    type: "premise",
    name: "故事基线",
    content: rawContent,
    rawContent,
    priority: 100,
    source: "global",
    estimatedTokens: estimateTokens(rawContent),
    updatedAt: row.updatedAt,
  };
}

function worldModelToItems(row: BibleWorldModelRecord): ComposableBibleContextItem[] {
  const dimensions: Array<[string, string, string]> = [
    ["economy", "经济", row.economyJson],
    ["society", "社会", row.societyJson],
    ["geography", "地理", row.geographyJson],
    ["power-system", "力量体系", row.powerSystemJson],
    ["culture", "文化", row.cultureJson],
    ["timeline", "纪年", row.timelineJson],
  ];

  return dimensions
    .filter(([, , raw]) => hasDescriptorContent(raw))
    .map(([key, label, raw]) => {
      const rawContent = formatDescriptor(safeParseDescriptor(raw));
      return {
        id: `world-model:${key}`,
        type: "world-model",
        category: label,
        name: label,
        content: rawContent,
        rawContent,
        priority: 90,
        source: "global",
        estimatedTokens: estimateTokens(rawContent),
        updatedAt: row.updatedAt,
      } satisfies ComposableBibleContextItem;
    });
}

function conflictToItem(row: BibleConflictRecord): ComposableBibleContextItem {
  const rawContent = `【矛盾-${row.type}】${row.name}（${row.resolutionState}）：${row.stakes}`;
  return {
    id: row.id,
    type: "conflict",
    category: row.type,
    name: row.name,
    content: rawContent,
    rawContent,
    priority: 70 - row.priority,
    source: row.scope === "main" ? "global" : "tracked",
    estimatedTokens: estimateTokens(rawContent),
    updatedAt: row.updatedAt,
  };
}

function arcToItem(row: BibleCharacterArcRecord, characterName: string): ComposableBibleContextItem | null {
  if (!row.currentPosition && !row.startingState && !row.endingState) return null;
  const rawContent = `${characterName} 当前处于 ${row.currentPosition || "未标注"}（${row.arcType}：${row.startingState} → ${row.endingState}）`;
  return {
    id: row.id,
    type: "character-arc",
    name: characterName,
    content: rawContent,
    rawContent,
    priority: 35,
    source: "global",
    estimatedTokens: estimateTokens(rawContent),
    updatedAt: row.updatedAt,
  };
}

export async function injectPremise(options: { storage: StorageDatabase; bookId: string }): Promise<ComposableBibleContextItem[]> {
  const premise = await createBiblePremiseRepository(options.storage).getByBook(options.bookId);
  const item = premise ? premiseToItem(premise) : null;
  return item ? [item] : [];
}

export async function injectWorldModel(options: { storage: StorageDatabase; bookId: string }): Promise<ComposableBibleContextItem[]> {
  const worldModel = await createBibleWorldModelRepository(options.storage).getByBook(options.bookId);
  return worldModel ? worldModelToItems(worldModel) : [];
}

export async function injectConflicts(options: { storage: StorageDatabase; bookId: string; currentChapter: number }): Promise<ComposableBibleContextItem[]> {
  const conflicts = await createBibleConflictRepository(options.storage).getActiveConflictsAtChapter(options.bookId, options.currentChapter);
  return conflicts.map(conflictToItem);
}

export async function injectCharacterArcs(options: { storage: StorageDatabase; bookId: string; currentChapter: number; characterIds?: readonly string[] }): Promise<ComposableBibleContextItem[]> {
  const repo = createBibleCharacterArcRepository(options.storage);
  const [characters, arcs] = await Promise.all([
    createBibleCharacterRepository(options.storage).listByBook(options.bookId),
    options.characterIds && options.characterIds.length > 0
      ? Promise.all(options.characterIds.map((characterId) => repo.listByCharacter(options.bookId, characterId))).then((groups) => groups.flat())
      : repo.listByBook(options.bookId),
  ]);
  const characterNames = new Map(characters.map((character) => [character.id, character.name]));
  return filterEntriesVisibleAtChapter(arcs.map((arc) => ({ ...arc, visibilityRuleJson: arc.visibilityRuleJson })), options.currentChapter)
    .map((arc) => arcToItem(arc, characterNames.get(arc.characterId) ?? arc.characterId))
    .filter((item): item is ComposableBibleContextItem => item !== null);
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
  const phaseBAnchors = [
    ...await injectPremise({ storage, bookId: input.bookId }),
    ...await injectWorldModel({ storage, bookId: input.bookId }),
    ...await injectConflicts({ storage, bookId: input.bookId, currentChapter }),
  ];

  if (mode === "static") {
    const globals = timelineFiltered.filter((entry) => entry.visibilityRule.type === "global");
    const characterIds = globals.filter((entry) => entry.type === "character").map((entry) => entry.id);
    const arcs = await injectCharacterArcs({ storage, bookId: input.bookId, currentChapter, characterIds });
    return composeBibleContext([
      ...phaseBAnchors,
      ...globals,
      ...arcs,
    ], { mode, tokenBudget: input.tokenBudget });
  }

  const globals = timelineFiltered.filter((entry) => entry.visibilityRule.type === "global");
  if (!input.sceneText) {
    const characterIds = globals.filter((entry) => entry.type === "character").map((entry) => entry.id);
    const arcs = await injectCharacterArcs({ storage, bookId: input.bookId, currentChapter, characterIds });
    return composeBibleContext([...phaseBAnchors, ...globals, ...arcs], { mode, tokenBudget: input.tokenBudget });
  }

  const trackedCandidates = timelineFiltered.filter((entry) => entry.visibilityRule.type === "tracked");
  const tracked = matchTrackedByAliases(trackedCandidates, input.sceneText);
  const nested = resolveNestedRefs([...globals, ...tracked], timelineFiltered, { maxDepth: 3 }).map(markNested);
  const characterIds = [...globals, ...tracked, ...nested].filter((entry) => entry.type === "character").map((entry) => entry.id);
  const arcs = await injectCharacterArcs({ storage, bookId: input.bookId, currentChapter, characterIds });
  const merged = dedupeByBestSource([...phaseBAnchors, ...globals, ...tracked, ...arcs, ...nested]);

  return composeBibleContext(merged, { mode, tokenBudget: input.tokenBudget });
}
