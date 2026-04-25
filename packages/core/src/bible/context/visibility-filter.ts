import type { VisibilityRule } from "../types.js";

export interface VisibilityRuleEntry {
  visibilityRule?: VisibilityRule;
  visibilityRuleJson?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseVisibilityRule(ruleJson: string | null | undefined): VisibilityRule {
  if (!ruleJson) return { type: "global" };

  try {
    const parsed: unknown = JSON.parse(ruleJson);
    if (!isRecord(parsed)) return { type: "global" };

    const visibleAfterChapter = readOptionalNumber(parsed.visibleAfterChapter ?? parsed.visible_after_chapter);
    const visibleUntilChapter = readOptionalNumber(parsed.visibleUntilChapter ?? parsed.visible_until_chapter);

    if (parsed.type === "global" || parsed.type === "tracked") {
      return {
        type: parsed.type,
        ...(visibleAfterChapter === undefined ? {} : { visibleAfterChapter }),
        ...(visibleUntilChapter === undefined ? {} : { visibleUntilChapter }),
      };
    }

    if (parsed.type === "nested") {
      return {
        type: "nested",
        parentIds: Array.isArray(parsed.parentIds) ? parsed.parentIds.filter((id): id is string => typeof id === "string") : [],
        ...(visibleAfterChapter === undefined ? {} : { visibleAfterChapter }),
        ...(visibleUntilChapter === undefined ? {} : { visibleUntilChapter }),
      };
    }
  } catch {
    return { type: "global" };
  }

  return { type: "global" };
}

export function getVisibilityRule(entry: VisibilityRuleEntry): VisibilityRule {
  return entry.visibilityRule ?? parseVisibilityRule(entry.visibilityRuleJson);
}

export function isVisibleAtChapter(entry: VisibilityRuleEntry, currentChapter: number): boolean {
  const rule = getVisibilityRule(entry);
  const visibleAfterChapter = rule.visibleAfterChapter;
  const visibleUntilChapter = rule.visibleUntilChapter;

  if (visibleAfterChapter !== undefined && currentChapter < visibleAfterChapter) return false;
  if (visibleUntilChapter !== undefined && currentChapter > visibleUntilChapter) return false;
  return true;
}

export function filterEntriesVisibleAtChapter<TEntry extends VisibilityRuleEntry>(entries: readonly TEntry[], currentChapter: number): TEntry[] {
  return entries.filter((entry) => isVisibleAtChapter(entry, currentChapter));
}
