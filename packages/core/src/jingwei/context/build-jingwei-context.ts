import { createBookRepository } from "../../bible/repositories/book-repo.js";
import { getStorageDatabase, type StorageDatabase } from "../../storage/db.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import type {
  BuildJingweiContextInput,
  JingweiContextItem,
  JingweiContextResult,
  JingweiContextSource,
  StoryJingweiEntryRecord,
  StoryJingweiSectionRecord,
} from "../types.js";

export interface BuildJingweiContextOptions extends BuildJingweiContextInput {
  storage?: StorageDatabase;
  maxNestedDepth?: number;
}

interface InternalJingweiContextItem extends JingweiContextItem {
  sectionOrder: number;
  updatedAtMs: number;
  coreMemory: boolean;
}

const BUILTIN_SECTION_KEYS = new Set([
  "people",
  "events",
  "settings",
  "chapter-summary",
  "foreshadowing",
  "iconic-scenes",
  "core-memory",
]);

const SOURCE_RANK: Record<JingweiContextSource, number> = {
  global: 30,
  tracked: 20,
  nested: 10,
};

export function estimateJingweiTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length * 0.6);
}

function isCoreMemorySection(section: StoryJingweiSectionRecord): boolean {
  return section.builtinKind === "core-memory" || section.key === "core-memory" || section.name === "核心记忆";
}

function formatSectionName(section: StoryJingweiSectionRecord): string {
  if (section.builtinKind || BUILTIN_SECTION_KEYS.has(section.key)) return section.name;
  return `自定义-${section.name}`;
}

function isVisibleAtChapter(entry: StoryJingweiEntryRecord, currentChapter: number): boolean {
  const { visibleAfterChapter, visibleUntilChapter } = entry.visibilityRule;
  if (visibleAfterChapter !== undefined && currentChapter < visibleAfterChapter) return false;
  if (visibleUntilChapter !== undefined && currentChapter > visibleUntilChapter) return false;
  return true;
}

function normalizeText(text: string): string {
  return text.trim().toLocaleLowerCase();
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  const normalizedHaystack = normalizeText(haystack);
  return needles.some((needle) => {
    const normalizedNeedle = normalizeText(needle);
    return normalizedNeedle.length > 0 && normalizedHaystack.includes(normalizedNeedle);
  });
}

function matchesTracked(entry: StoryJingweiEntryRecord, sceneText: string): boolean {
  return containsAny(sceneText, [
    entry.title,
    ...entry.aliases,
    ...(entry.visibilityRule.keywords ?? []),
  ]);
}

function makePriority(section: StoryJingweiSectionRecord, source: JingweiContextSource): number {
  return (isCoreMemorySection(section) ? 10_000 : 0) + SOURCE_RANK[source] + Math.max(0, 1000 - section.order);
}

function toContextItem(
  entry: StoryJingweiEntryRecord,
  section: StoryJingweiSectionRecord,
  source: JingweiContextSource,
): InternalJingweiContextItem {
  const sectionLabel = formatSectionName(section);
  const text = `【${sectionLabel}】${entry.title}：${entry.contentMd}`;
  return {
    id: entry.id,
    entryId: entry.id,
    sectionId: section.id,
    sectionKey: section.key,
    sectionName: section.name,
    title: entry.title,
    text,
    source,
    priority: makePriority(section, source),
    estimatedTokens: Math.min(estimateJingweiTokens(text), entry.tokenBudget ?? Number.POSITIVE_INFINITY),
    sectionOrder: section.order,
    updatedAtMs: entry.updatedAt.getTime(),
    coreMemory: isCoreMemorySection(section),
  };
}

function sortByPriority(items: readonly InternalJingweiContextItem[]): InternalJingweiContextItem[] {
  return [...items].sort((a, b) => (
    Number(b.coreMemory) - Number(a.coreMemory)
    || SOURCE_RANK[b.source] - SOURCE_RANK[a.source]
    || b.priority - a.priority
    || a.sectionOrder - b.sectionOrder
    || b.updatedAtMs - a.updatedAtMs
    || a.entryId.localeCompare(b.entryId)
  ));
}

function sortByDropPriority(items: readonly InternalJingweiContextItem[]): InternalJingweiContextItem[] {
  return [...items].sort((a, b) => (
    Number(a.coreMemory) - Number(b.coreMemory)
    || SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    || a.priority - b.priority
    || a.updatedAtMs - b.updatedAtMs
    || b.sectionOrder - a.sectionOrder
    || a.entryId.localeCompare(b.entryId)
  ));
}

function applyTokenBudget(items: readonly InternalJingweiContextItem[], tokenBudget: number): { items: InternalJingweiContextItem[]; totalTokens: number; droppedEntryIds: string[] } {
  const kept = sortByPriority(items);
  let totalTokens = kept.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const droppedEntryIds: string[] = [];

  for (const candidate of sortByDropPriority(kept)) {
    if (totalTokens <= tokenBudget) break;
    const index = kept.findIndex((item) => item.entryId === candidate.entryId);
    if (index === -1) continue;
    const [dropped] = kept.splice(index, 1);
    if (!dropped) continue;
    totalTokens -= dropped.estimatedTokens;
    droppedEntryIds.push(dropped.entryId);
  }

  return { items: kept, totalTokens, droppedEntryIds };
}

function isReferencedByInjected(
  candidate: StoryJingweiEntryRecord,
  injectedIds: ReadonlySet<string>,
  injectedEntries: readonly StoryJingweiEntryRecord[],
): boolean {
  if ((candidate.visibilityRule.parentEntryIds ?? []).some((id) => injectedIds.has(id))) return true;
  return injectedEntries.some((entry) => entry.relatedEntryIds.includes(candidate.id));
}

function resolveNestedEntries(
  initialEntries: readonly StoryJingweiEntryRecord[],
  candidates: readonly StoryJingweiEntryRecord[],
  maxDepth: number,
): StoryJingweiEntryRecord[] {
  const injected = new Map(initialEntries.map((entry) => [entry.id, entry]));
  const nested: StoryJingweiEntryRecord[] = [];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const injectedIds = new Set(injected.keys());
    const next = candidates.filter((candidate) => (
      candidate.visibilityRule.type === "nested"
      && !injected.has(candidate.id)
      && isReferencedByInjected(candidate, injectedIds, [...injected.values()])
    ));
    if (next.length === 0) break;
    for (const entry of next) {
      injected.set(entry.id, entry);
      nested.push(entry);
    }
  }

  return nested;
}

function publicItem(item: InternalJingweiContextItem): JingweiContextItem {
  return {
    id: item.id,
    entryId: item.entryId,
    sectionId: item.sectionId,
    sectionKey: item.sectionKey,
    sectionName: item.sectionName,
    title: item.title,
    text: item.text,
    source: item.source,
    priority: item.priority,
    estimatedTokens: item.estimatedTokens,
  };
}

function buildSectionStats(
  sections: readonly StoryJingweiSectionRecord[],
  items: readonly InternalJingweiContextItem[],
): JingweiContextResult["sectionStats"] {
  return sections.map((section) => ({
    sectionId: section.id,
    sectionName: section.name,
    count: items.filter((item) => item.sectionId === section.id).length,
  })).filter((stat) => stat.count > 0);
}

export async function buildJingweiContext(input: BuildJingweiContextOptions): Promise<JingweiContextResult> {
  const storage = input.storage ?? getStorageDatabase();
  const book = await createBookRepository(storage).getById(input.bookId);
  if (!book) throw new Error(`Book not found: ${input.bookId}`);

  const currentChapter = input.currentChapter ?? book.currentChapter;
  const sections = await createStoryJingweiSectionRepository(storage).listEnabledForAi(input.bookId);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const entries = (await createStoryJingweiEntryRepository(storage).listForAi(input.bookId, sections.map((section) => section.id)))
    .filter((entry) => isVisibleAtChapter(entry, currentChapter));

  const globals = entries.filter((entry) => entry.visibilityRule.type === "global");
  const tracked = input.sceneText
    ? entries.filter((entry) => entry.visibilityRule.type === "tracked" && matchesTracked(entry, input.sceneText ?? ""))
    : [];
  const nested = resolveNestedEntries([...globals, ...tracked], entries, input.maxNestedDepth ?? 3);
  const internalItems = [
    ...globals.map((entry) => [entry, "global"] as const),
    ...tracked.map((entry) => [entry, "tracked"] as const),
    ...nested.map((entry) => [entry, "nested"] as const),
  ].map(([entry, source]) => {
    const section = sectionById.get(entry.sectionId);
    return section ? toContextItem(entry, section, source) : null;
  }).filter((item): item is InternalJingweiContextItem => item !== null);

  const budgeted = applyTokenBudget(internalItems, input.tokenBudget ?? 8000);
  const sortedItems = sortByPriority(budgeted.items);

  return {
    items: sortedItems.map(publicItem),
    totalTokens: budgeted.totalTokens,
    droppedEntryIds: budgeted.droppedEntryIds,
    sectionStats: buildSectionStats(sections, sortedItems),
  };
}
