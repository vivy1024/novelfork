import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type {
  BuildJingweiLegacyContextInput,
  BuildJingweiLegacyContextResult,
  JingweiContextItemType,
  JingweiContextSource,
  JingweiMode,
  StoryJingweiEntryRecord,
  StoryJingweiSectionRecord,
} from "../types.js";
import { createBookRepository } from "../repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import { composeJingweiContext, type ComposableJingweiContextItem } from "./compose-context.js";
import { resolveNestedRefs } from "./nested-resolver.js";
import { estimateTokens } from "./token-budget.js";
import { getEntryReadableContent, toJingweiReadableItem } from "../read-model/entry-summary.js";
import { resolveJingweiReadCategory, type JingweiCategory } from "../read-model/category-map.js";

export interface BuildJingweiLegacyContextOptions extends BuildJingweiLegacyContextInput {
  storage?: StorageDatabase;
}

interface CanonicalCandidate extends ComposableJingweiContextItem {
  entry: StoryJingweiEntryRecord;
  section: StoryJingweiSectionRecord;
  readCategory: JingweiCategory;
  nestedRefsJson: string;
}

function normalize(text: string | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function isVisibleAtChapter(entry: StoryJingweiEntryRecord, currentChapter: number): boolean {
  const { visibleAfterChapter, visibleUntilChapter } = entry.visibilityRule;
  if (visibleAfterChapter !== undefined && currentChapter < visibleAfterChapter) return false;
  if (visibleUntilChapter !== undefined && currentChapter > visibleUntilChapter) return false;
  return true;
}

function matchesScene(entry: StoryJingweiEntryRecord, sceneText: string): boolean {
  const haystack = normalize(sceneText);
  if (!haystack) return false;
  return [entry.title, ...entry.aliases, ...entry.tags, ...(entry.visibilityRule.keywords ?? [])]
    .map(normalize)
    .filter(Boolean)
    .some((needle) => haystack.includes(needle));
}

function contextTypeForCategory(category: JingweiCategory): JingweiContextItemType {
  if (category === "characters" || category === "relationships") return "character";
  if (category === "timeline") return "event";
  if (category === "chapter-summaries") return "chapter-summary";
  if (category === "conflicts" || category === "foreshadowing") return "conflict";
  if (category === "world-model") return "world-model";
  if (category === "premise" || category === "outline") return "premise";
  return "setting";
}

function visibilitySource(entry: StoryJingweiEntryRecord): JingweiContextSource {
  if (entry.visibilityRule.type === "global") return "global";
  if (entry.visibilityRule.type === "nested") return "nested";
  return "tracked";
}

function chapterNumberOf(entry: StoryJingweiEntryRecord): number | null {
  const fieldValue = entry.fields.chapterNumber;
  if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) return fieldValue;
  return entry.relatedChapterNumbers.find((value) => Number.isFinite(value)) ?? null;
}

function applyChapterSummaryWindow(candidates: CanonicalCandidate[], currentChapter: number): CanonicalCandidate[] {
  const summaries = candidates
    .filter((candidate) => candidate.readCategory === "chapter-summaries")
    .filter((candidate) => {
      const chapterNumber = chapterNumberOf(candidate.entry);
      return chapterNumber === null || chapterNumber <= currentChapter;
    })
    .sort((a, b) => (chapterNumberOf(b.entry) ?? 0) - (chapterNumberOf(a.entry) ?? 0))
    .slice(0, 15);
  const summaryIds = new Set(summaries.map((candidate) => candidate.id));
  return candidates.filter((candidate) => candidate.readCategory !== "chapter-summaries" || summaryIds.has(candidate.id));
}

function buildNestedRefs(entries: readonly StoryJingweiEntryRecord[]): Map<string, string[]> {
  const refs = new Map<string, Set<string>>();
  for (const entry of entries) {
    refs.set(entry.id, new Set(entry.relatedEntryIds));
  }
  for (const entry of entries) {
    if (entry.visibilityRule.type !== "nested") continue;
    for (const parentId of entry.visibilityRule.parentEntryIds ?? []) {
      const parentRefs = refs.get(parentId);
      if (parentRefs) parentRefs.add(entry.id);
    }
  }
  return new Map(Array.from(refs, ([id, values]) => [id, Array.from(values)]));
}

async function loadCanonicalCandidates(
  storage: StorageDatabase,
  bookId: string,
  currentChapter: number,
): Promise<CanonicalCandidate[]> {
  const sections = await createStoryJingweiSectionRepository(storage).listEnabledForAi(bookId);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const entries = (await createStoryJingweiEntryRepository(storage).listForAi(bookId, sections.map((section) => section.id)))
    .filter((entry) => isVisibleAtChapter(entry, currentChapter));
  const nestedRefs = buildNestedRefs(entries);

  const candidates = entries.flatMap((entry): CanonicalCandidate[] => {
    const section = sectionById.get(entry.sectionId);
    if (!section) return [];
    const source = visibilitySource(entry);
    const readable = toJingweiReadableItem(entry, section, source, "full");
    const rawContent = getEntryReadableContent(entry, "full");
    return [{
      id: entry.id,
      type: contextTypeForCategory(readable.category),
      category: readable.category,
      name: entry.title,
      content: rawContent,
      rawContent,
      priority: readable.priority,
      source,
      estimatedTokens: estimateTokens(rawContent),
      updatedAt: entry.updatedAt,
      nestedRefsJson: JSON.stringify(nestedRefs.get(entry.id) ?? []),
      entry,
      section,
      readCategory: readable.category,
    }];
  });

  return applyChapterSummaryWindow(candidates, currentChapter);
}

function markNested(candidate: CanonicalCandidate): CanonicalCandidate {
  return { ...candidate, source: "nested", priority: candidate.priority - 10 };
}

function dedupeByBestSource(items: readonly CanonicalCandidate[]): CanonicalCandidate[] {
  const sourceRank: Record<JingweiContextSource, number> = { global: 3, tracked: 2, nested: 1 };
  const byId = new Map<string, CanonicalCandidate>();
  for (const item of items) {
    const current = byId.get(item.id);
    if (!current || sourceRank[item.source] > sourceRank[current.source]) byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function filterByCategories(candidates: CanonicalCandidate[], categories: readonly JingweiCategory[]): ComposableJingweiContextItem[] {
  const accepted = new Set<JingweiCategory>(categories);
  return candidates.filter((candidate) => accepted.has(candidate.readCategory));
}

export async function injectPremise(options: { storage: StorageDatabase; bookId: string }): Promise<ComposableJingweiContextItem[]> {
  const book = await createBookRepository(options.storage).getById(options.bookId);
  if (!book) return [];
  return filterByCategories(await loadCanonicalCandidates(options.storage, options.bookId, book.currentChapter), ["premise", "outline"]);
}

export async function injectWorldModel(options: { storage: StorageDatabase; bookId: string }): Promise<ComposableJingweiContextItem[]> {
  const book = await createBookRepository(options.storage).getById(options.bookId);
  if (!book) return [];
  return filterByCategories(await loadCanonicalCandidates(options.storage, options.bookId, book.currentChapter), ["world-model"]);
}

export async function injectConflicts(options: { storage: StorageDatabase; bookId: string; currentChapter: number }): Promise<ComposableJingweiContextItem[]> {
  return filterByCategories(await loadCanonicalCandidates(options.storage, options.bookId, options.currentChapter), ["conflicts", "foreshadowing"]);
}

export async function injectCharacterArcs(options: { storage: StorageDatabase; bookId: string; currentChapter: number; characterIds?: readonly string[] }): Promise<ComposableJingweiContextItem[]> {
  const candidates = await loadCanonicalCandidates(options.storage, options.bookId, options.currentChapter);
  const acceptedIds = options.characterIds ? new Set(options.characterIds) : null;
  return candidates.filter((candidate) => {
    if (candidate.readCategory !== "characters") return false;
    if (!acceptedIds || acceptedIds.size === 0) return true;
    return acceptedIds.has(candidate.id) || candidate.entry.relatedEntryIds.some((id) => acceptedIds.has(id));
  });
}

export async function buildJingweiContext(input: BuildJingweiLegacyContextOptions): Promise<BuildJingweiLegacyContextResult> {
  const storage = input.storage ?? getStorageDatabase();
  const book = await createBookRepository(storage).getById(input.bookId);
  if (!book) throw new Error(`Book not found: ${input.bookId}`);

  const mode: JingweiMode = book.jingweiMode;
  const currentChapter = input.currentChapter ?? book.currentChapter;
  const candidates = await loadCanonicalCandidates(storage, input.bookId, currentChapter);
  const globals = candidates.filter((candidate) => candidate.entry.visibilityRule.type === "global");

  if (mode === "static" || !input.sceneText?.trim()) {
    return composeJingweiContext(globals, { mode, tokenBudget: input.tokenBudget });
  }

  const tracked = candidates.filter((candidate) => candidate.entry.visibilityRule.type === "tracked" && matchesScene(candidate.entry, input.sceneText!));
  const nested = resolveNestedRefs([...globals, ...tracked], candidates, { maxDepth: 3 }).map(markNested);
  const merged = dedupeByBestSource([...globals, ...tracked, ...nested]);
  return composeJingweiContext(merged, { mode, tokenBudget: input.tokenBudget });
}

/** @deprecated 名称仅为外部兼容；实现已统一读取 story_jingwei_entry。 */
export const buildJingweiLegacyContext = buildJingweiContext;
export type { BuildJingweiLegacyContextOptions as BuildJingweiContextOptions };
export { estimateTokens as estimateJingweiTokens } from "./token-budget.js";
