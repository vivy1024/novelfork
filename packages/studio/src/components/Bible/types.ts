export type BibleTab = "characters" | "events" | "settings" | "chapter-summaries" | "conflicts" | "world-model" | "premise" | "character-arcs";
export type VisibilityRuleType = "global" | "tracked" | "nested";

export interface VisibilityRuleDraft {
  type: VisibilityRuleType;
  visibleAfterChapter?: number;
  visibleUntilChapter?: number;
  parentIds?: string[];
}

export interface BibleEntry {
  id: string;
  name?: string;
  title?: string;
  summary?: string;
  content?: string;
  category?: string;
  roleType?: string;
  eventType?: string;
  chapterNumber?: number;
  wordCount?: number;
  pov?: string;
  aliases?: string[];
  traits?: Record<string, unknown>;
  relatedCharacterIds?: string[];
  nestedRefs?: string[];
  keyEvents?: string[];
  appearingCharacterIds?: string[];
  type?: string;
  scope?: string;
  priority?: number;
  stakes?: string;
  resolutionState?: string;
  stalled?: boolean;
  logline?: string;
  tone?: string;
  targetReaders?: string;
  uniqueHook?: string;
  economy?: Record<string, unknown>;
  society?: Record<string, unknown>;
  geography?: Record<string, unknown>;
  powerSystem?: Record<string, unknown>;
  culture?: Record<string, unknown>;
  timeline?: Record<string, unknown>;
  characterId?: string;
  arcType?: string;
  currentPosition?: string;
  visibilityRule?: VisibilityRuleDraft;
}

export interface BibleContextPreviewItem {
  id: string;
  type: string;
  name: string;
  content: string;
  source: string;
  estimatedTokens: number;
}

export interface BibleContextPreview {
  mode: "static" | "dynamic";
  items: BibleContextPreviewItem[];
  totalTokens: number;
  droppedIds: string[];
}

export const BIBLE_TABS: ReadonlyArray<{ id: BibleTab; label: string; singular: string }> = [
  { id: "characters", label: "Characters", singular: "character" },
  { id: "events", label: "Events", singular: "event" },
  { id: "settings", label: "Settings", singular: "setting" },
  { id: "chapter-summaries", label: "Chapter Summaries", singular: "chapterSummary" },
  { id: "conflicts", label: "Conflicts", singular: "conflict" },
  { id: "world-model", label: "World", singular: "worldModel" },
  { id: "premise", label: "Premise", singular: "premise" },
  { id: "character-arcs", label: "Character Arcs", singular: "characterArc" },
];

export type BibleResponseKey = "characters" | "events" | "settings" | "chapterSummaries" | "conflicts" | "worldModel" | "premise" | "characterArcs";

export function responseKeyForTab(tab: BibleTab): BibleResponseKey {
  if (tab === "chapter-summaries") return "chapterSummaries";
  if (tab === "world-model") return "worldModel";
  if (tab === "character-arcs") return "characterArcs";
  return tab;
}

export function singularKeyForTab(tab: BibleTab): "character" | "event" | "setting" | "chapterSummary" | "conflict" | "worldModel" | "premise" | "characterArc" {
  if (tab === "characters") return "character";
  if (tab === "events") return "event";
  if (tab === "settings") return "setting";
  if (tab === "chapter-summaries") return "chapterSummary";
  if (tab === "conflicts") return "conflict";
  if (tab === "world-model") return "worldModel";
  if (tab === "premise") return "premise";
  return "characterArc";
}

export function titleOfEntry(entry: BibleEntry): string {
  return entry.name ?? entry.title ?? entry.logline ?? entry.characterId ?? entry.id;
}
