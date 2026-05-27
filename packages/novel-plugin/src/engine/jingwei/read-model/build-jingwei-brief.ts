import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { createBookRepository } from "../repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import type {
  JingweiBriefIndex,
  JingweiContextSource,
  JingweiReadBriefResult,
  StoryJingweiEntryRecord,
  StoryJingweiSectionRecord,
} from "../types.js";
import { toJingweiReadableItem } from "./entry-summary.js";
import { buildJingweiIndexFromItems } from "./build-jingwei-index.js";
import { applyTokenBudget } from "./token-budget.js";

export interface BuildJingweiBriefInput {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly sceneText?: string;
  readonly chapterIntent?: string;
  readonly tokenBudget?: number;
  readonly storage?: StorageDatabase;
}

interface CandidateItem {
  readonly id: string;
  readonly priority: number;
  readonly estimatedTokens: number;
  readonly source: JingweiContextSource;
  readonly entry: StoryJingweiEntryRecord;
  readonly section: StoryJingweiSectionRecord;
}

function normalize(text: string | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  const normalizedHaystack = normalize(haystack);
  return needles.some((needle) => normalizedHaystack.includes(normalize(needle)));
}

function isVisibleAtChapter(entry: StoryJingweiEntryRecord, currentChapter: number): boolean {
  const { visibleAfterChapter, visibleUntilChapter } = entry.visibilityRule;
  if (visibleAfterChapter !== undefined && currentChapter < visibleAfterChapter) return false;
  if (visibleUntilChapter !== undefined && currentChapter > visibleUntilChapter) return false;
  return true;
}

function isCoreSection(section: StoryJingweiSectionRecord): boolean {
  return section.builtinKind === "core-memory" || section.key === "core-memory" || section.key === "premise" || section.key === "world-model";
}

function sectionPriority(section: StoryJingweiSectionRecord): number {
  if (section.key === "premise") return 1200;
  if (section.key === "world-model") return 1100;
  if (section.key === "chapter-summary" || section.key === "chapter-summaries") return 900;
  if (section.key === "foreshadowing") return 850;
  return Math.max(0, 1000 - section.order);
}

function sourcePriority(source: JingweiContextSource): number {
  return source === "global" ? 300 : source === "tracked" ? 200 : 100;
}

function visibilitySource(entry: StoryJingweiEntryRecord): JingweiContextSource {
  if (entry.visibilityRule.type === "global") return "global";
  if (entry.visibilityRule.type === "tracked") return "tracked";
  return "nested";
}

function matchesTask(entry: StoryJingweiEntryRecord, sceneText: string, chapterIntent: string): boolean {
  const haystack = `${sceneText}\n${chapterIntent}`.trim();
  if (haystack.length === 0) return false;
  return containsAny(haystack, [entry.title, ...entry.aliases, ...(entry.visibilityRule.keywords ?? []), ...entry.tags]);
}

function buildCandidate(entry: StoryJingweiEntryRecord, section: StoryJingweiSectionRecord, source: JingweiContextSource): CandidateItem {
  const readable = toJingweiReadableItem(entry, section, source, "summary");
  const priority = readable.priority + (isCoreSection(section) ? 10_000 : 0) + sectionPriority(section) + sourcePriority(source);
  return {
    id: entry.id,
    priority,
    estimatedTokens: readable.estimatedTokens,
    source,
    entry,
    section,
  };
}

function selectCoreCandidates(candidates: readonly CandidateItem[]): CandidateItem[] {
  const selected = [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return selected;
}

function toRecommendedReads(index: JingweiBriefIndex, sceneText: string, chapterIntent: string) {
  const taskText = `${sceneText}\n${chapterIntent}`.trim();
  const prefers = taskText.length === 0
    ? ["chapter-summaries", "characters", "world-model"]
    : ["characters", "locations", "foreshadowing", "chapter-summaries", "conflicts", "world-model"];
  return index.categories
    .filter((category) => prefers.includes(category.category))
    .slice(0, 4)
    .map((category) => ({ category: category.category, reason: category.recommendedWhen }));
}

function buildOmittedSummary(droppedCount: number, tokenBudget: number, estimatedTokens: number): string {
  return `核心包在 ${tokenBudget} tokens 预算内保留最重要条目，实际预计 ${estimatedTokens} tokens，省略了 ${droppedCount} 条低优先级内容。`;
}

export async function buildJingweiBrief(input: BuildJingweiBriefInput): Promise<JingweiReadBriefResult> {
  const storage = input.storage ?? getStorageDatabase();
  const book = await createBookRepository(storage).getById(input.bookId);
  if (!book) throw new Error(`Book not found: ${input.bookId}`);

  const currentChapter = input.chapterNumber ?? book.currentChapter;
  const sections = await createStoryJingweiSectionRepository(storage).listEnabledForAi(input.bookId);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const entries = (await createStoryJingweiEntryRepository(storage).listForAi(input.bookId, sections.map((section) => section.id)))
    .filter((entry) => isVisibleAtChapter(entry, currentChapter));
  const sceneText = input.sceneText ?? "";
  const chapterIntent = input.chapterIntent ?? "";

  const candidates: CandidateItem[] = [];
  for (const entry of entries) {
    const section = sectionById.get(entry.sectionId);
    if (!section) continue;
    const source = visibilitySource(entry);
    if (source === "tracked" && !matchesTask(entry, sceneText, chapterIntent)) continue;
    const isCore = entry.priorityTier === "core" || isCoreSection(section);
    const isRelevant = entry.priorityTier === "relevant" || matchesTask(entry, sceneText, chapterIntent);
    if (isCore || isRelevant || source === "global") {
      candidates.push(buildCandidate(entry, section, source));
    }
  }

  const selected = selectCoreCandidates(candidates);
  const budget = input.tokenBudget ?? 4000;
  const budgeted = applyTokenBudget(selected, budget);
  const coreBrief = budgeted.items.map((candidate) => toJingweiReadableItem(candidate.entry, candidate.section, candidate.source, "summary"));
  const index = buildJingweiIndexFromItems(entries.map((entry) => {
    const section = sectionById.get(entry.sectionId);
    if (!section) {
      return null;
    }
    const source = visibilitySource(entry);
    return toJingweiReadableItem(entry, section, source, "summary");
  }).filter((item): item is NonNullable<typeof item> => item !== null));

  return {
    ok: true,
    bookId: input.bookId,
    coreBrief,
    index,
    recommendedReads: toRecommendedReads(index, sceneText, chapterIntent),
    estimatedTokens: budgeted.estimatedTokens,
    droppedEntryIds: budgeted.droppedEntryIds,
    omittedSummary: budgeted.droppedEntryIds.length > 0 ? buildOmittedSummary(budgeted.droppedEntryIds.length, budget, budgeted.estimatedTokens) : undefined,
  };
}
