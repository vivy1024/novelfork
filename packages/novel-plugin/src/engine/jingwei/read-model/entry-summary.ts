import type {
  JingweiContextSource,
  JingweiPriorityTier,
  JingweiReadableItem,
  JingweiReadCategory,
  StoryJingweiEntryRecord,
  StoryJingweiSectionRecord,
} from "../types.js";
import { estimateJingweiTokens } from "../context/build-jingwei-context.js";
import { JINGWEI_CATEGORY_TITLES, resolveJingweiReadCategory } from "./category-map.js";

function normalizeSummary(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function excerptText(text: string, maxLength = 240): string {
  const normalized = normalizeSummary(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function readCustomFieldString(entry: StoryJingweiEntryRecord, key: string): string | undefined {
  const value = entry.customFields[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function getEntrySummaryMd(entry: StoryJingweiEntryRecord): string {
  return readCustomFieldString(entry, "summaryMd")
    ?? entry.summaryMd?.trim()
    ?? excerptText(entry.contentMd, 240);
}

export function getEntryPriorityTier(entry: StoryJingweiEntryRecord): JingweiPriorityTier {
  return entry.priorityTier ?? "auto";
}

export function getEntryReadableContent(entry: StoryJingweiEntryRecord, detailLevel: "summary" | "normal" | "full"): string {
  if (detailLevel === "summary") return getEntrySummaryMd(entry);
  if (detailLevel === "normal") {
    const summary = getEntrySummaryMd(entry);
    const body = excerptText(entry.contentMd, 900);
    return summary === body ? summary : `${summary}\n\n${body}`;
  }
  return entry.contentMd;
}

function getSectionLabel(section: StoryJingweiSectionRecord): string {
  if (section.builtinKind) return section.name;
  return `自定义-${section.name}`;
}

export function toJingweiReadableItem(
  entry: StoryJingweiEntryRecord,
  section: StoryJingweiSectionRecord,
  source: JingweiContextSource,
  detailLevel: "summary" | "normal" | "full" = "summary",
): JingweiReadableItem {
  const category = resolveJingweiReadCategory(entry, section);
  const summaryMd = getEntrySummaryMd(entry);
  const contentMd = getEntryReadableContent(entry, detailLevel);
  const text = `【${getSectionLabel(section)}】${entry.title}：${contentMd}`;
  const priorityTier = getEntryPriorityTier(entry);
  const priorityBase = priorityTier === "core" ? 10_000 : priorityTier === "relevant" ? 2_000 : priorityTier === "reference" ? 500 : 0;
  const sourceBonus = source === "global" ? 30 : source === "tracked" ? 20 : 10;
  const priority = priorityBase + sourceBonus + Math.max(0, 1000 - section.order);

  return {
    id: entry.id,
    entryId: entry.id,
    sectionId: section.id,
    sectionKey: section.key,
    sectionName: section.name,
    category,
    title: entry.title,
    summaryMd,
    contentMd,
    source,
    priority,
    estimatedTokens: Math.min(estimateJingweiTokens(text), entry.tokenBudget ?? Number.POSITIVE_INFINITY),
    updatedAtMs: entry.updatedAt.getTime(),
    tags: entry.tags,
    aliases: entry.aliases,
    visibilityRule: entry.visibilityRule,
    priorityTier,
  };
}

export function createReadableCategoryTitle(category: JingweiReadCategory): string {
  return JINGWEI_CATEGORY_TITLES[category];
}
