export type BibleTab = "characters" | "events" | "settings" | "chapter-summaries" | "conflicts" | "world-model" | "premise" | "character-arcs" | "questionnaires" | "core-shifts" | "ai-filter";
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
  tier?: 1 | 2 | 3;
  targetObject?: string;
  questions?: Array<{ id: string; prompt: string; type: "single" | "multi" | "text" | "ranged-number" | "ai-suggest"; options?: string[]; mapping: { fieldPath: string; transform?: string }; defaultSkippable: boolean }>;
  status?: string;
  targetType?: string;
  targetId?: string;
  affectedChapters?: number[];
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
  { id: "characters", label: "角色", singular: "character" },
  { id: "events", label: "事件", singular: "event" },
  { id: "settings", label: "设定", singular: "setting" },
  { id: "chapter-summaries", label: "章节摘要", singular: "chapterSummary" },
  { id: "conflicts", label: "冲突", singular: "conflict" },
  { id: "world-model", label: "世界", singular: "worldModel" },
  { id: "premise", label: "前提", singular: "premise" },
  { id: "character-arcs", label: "角色弧光", singular: "characterArc" },
  { id: "questionnaires", label: "问卷中心", singular: "template" },
  { id: "core-shifts", label: "变更历史", singular: "coreShift" },
  { id: "ai-filter", label: "AI 味报告", singular: "filterReport" },
];

export type BibleResponseKey = "characters" | "events" | "settings" | "chapterSummaries" | "conflicts" | "worldModel" | "premise" | "characterArcs" | "templates" | "coreShifts" | "reports";

export function responseKeyForTab(tab: BibleTab): BibleResponseKey {
  if (tab === "chapter-summaries") return "chapterSummaries";
  if (tab === "world-model") return "worldModel";
  if (tab === "character-arcs") return "characterArcs";
  if (tab === "questionnaires") return "templates";
  if (tab === "core-shifts") return "coreShifts";
  if (tab === "ai-filter") return "reports";
  return tab;
}

export function singularKeyForTab(tab: BibleTab): "character" | "event" | "setting" | "chapterSummary" | "conflict" | "worldModel" | "premise" | "characterArc" | "template" | "coreShift" | "filterReport" {
  if (tab === "characters") return "character";
  if (tab === "events") return "event";
  if (tab === "settings") return "setting";
  if (tab === "chapter-summaries") return "chapterSummary";
  if (tab === "conflicts") return "conflict";
  if (tab === "world-model") return "worldModel";
  if (tab === "premise") return "premise";
  if (tab === "questionnaires") return "template";
  if (tab === "core-shifts") return "coreShift";
  if (tab === "ai-filter") return "filterReport";
  return "characterArc";
}

export function titleOfEntry(entry: BibleEntry): string {
  return entry.name ?? entry.title ?? entry.logline ?? entry.characterId ?? entry.targetObject ?? entry.targetType ?? entry.id;
}
