export type BibleTab = "characters" | "events" | "settings" | "chapter-summaries";
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
];

export function responseKeyForTab(tab: BibleTab): "characters" | "events" | "settings" | "chapterSummaries" {
  return tab === "chapter-summaries" ? "chapterSummaries" : tab;
}

export function singularKeyForTab(tab: BibleTab): "character" | "event" | "setting" | "chapterSummary" {
  if (tab === "characters") return "character";
  if (tab === "events") return "event";
  if (tab === "settings") return "setting";
  return "chapterSummary";
}

export function titleOfEntry(entry: BibleEntry): string {
  return entry.name ?? entry.title ?? entry.id;
}
