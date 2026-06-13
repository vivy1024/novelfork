import type {
  JingweiContextSource,
  JingweiDetailLevel,
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

/** L0 一句话摘要：优先用存储的 summaryL0，否则取 summaryMd 首句/前 40 字 */
export function getEntryL0(entry: StoryJingweiEntryRecord): string {
  const stored = entry.summaryL0?.trim();
  if (stored) return stored;
  const summary = normalizeSummary(getEntrySummaryMd(entry));
  // 取第一句（中英文句号/问叹号/换行）
  const sentenceMatch = summary.match(/^[^。！？.!?\n]{1,60}[。！？.!?]?/);
  const firstSentence = sentenceMatch?.[0]?.trim();
  if (firstSentence && firstSentence.length >= 4) return firstSentence;
  return excerptText(summary, 40);
}

export function getEntryPriorityTier(entry: StoryJingweiEntryRecord): JingweiPriorityTier {
  return entry.priorityTier ?? "auto";
}

export function getEntryReadableContent(entry: StoryJingweiEntryRecord, detailLevel: JingweiDetailLevel): string {
  if (detailLevel === "brief") return getEntryL0(entry);
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
  detailLevel: JingweiDetailLevel = "summary",
): JingweiReadableItem {
  const category = resolveJingweiReadCategory(entry, section);
  const summaryMd = getEntrySummaryMd(entry);
  const contentMd = getEntryReadableContent(entry, detailLevel);
  const text = `【${getSectionLabel(section)}】${entry.title}：${contentMd}`;
  const priorityTier = getEntryPriorityTier(entry);
  const priorityBase = priorityTier === "core" ? 10_000 : priorityTier === "relevant" ? 2_000 : priorityTier === "reference" ? 500 : 0;
  const sourceBonus = source === "global" ? 30 : source === "tracked" ? 20 : 10;
  // importance(0-100) 作为同层内的细粒度排序依据，叠加到层基数之上
  const importanceBonus = typeof entry.importance === "number" ? Math.max(0, Math.min(100, entry.importance)) : 40;
  const priority = priorityBase + sourceBonus + importanceBonus + Math.max(0, 1000 - section.order);

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
