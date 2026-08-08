/**
 * category-map.ts — 经纬分类解析（读模型层）
 *
 * 分类枚举和元数据现在从 unified-categories.ts 统一导出。
 * 本文件保留"模糊别名解析"逻辑（agent 输入可能用 "sect"/"cultivation" 等非标准名称）。
 */
import { JINGWEI_CATEGORIES, CATEGORY_META, type JingweiCategory } from "../unified-categories.js";
import type { StoryJingweiEntryRecord, StoryJingweiSectionRecord } from "../types.js";

// Re-export for downstream compatibility (避免大面积改 import 路径)
export { JINGWEI_CATEGORIES, type JingweiCategory };

/** 分类中文标题（从 CATEGORY_META 导出） */
export const JINGWEI_CATEGORY_TITLES: Record<JingweiCategory, string> = Object.fromEntries(
  CATEGORY_META.map((m) => [m.id, m.name]),
) as Record<JingweiCategory, string>;

/** agent 何时应读取本分类（从 CATEGORY_META 导出） */
export const JINGWEI_CATEGORY_RECOMMENDED_WHEN: Record<JingweiCategory, string> = Object.fromEntries(
  CATEGORY_META.map((m) => [m.id, m.recommendedWhen]),
) as Record<JingweiCategory, string>;

// Keep JINGWEI_READ_CATEGORIES as alias for backward compat (same as JINGWEI_CATEGORIES)
export const JINGWEI_READ_CATEGORIES = JINGWEI_CATEGORIES;

/**
 * 模糊别名映射 — agent 输入可能用非标准名称（如 "sect"/"cultivation"/"hookline"）。
 * 注意：这和 LEGACY_CATEGORY_MAP（精确的旧数据库值映射）不同——这是 agent 交互的模糊匹配。
 */
const CATEGORY_ALIASES: Record<string, JingweiCategory> = {
  premise: "premise",
  logline: "premise",
  "world-model": "world-model",
  world: "world-model",
  setting: "world-model",
  settings: "world-model",
  worldview: "world-model",
  people: "characters",
  person: "characters",
  character: "characters",
  characters: "characters",
  role: "characters",
  arc: "characters",
  "character-arc": "characters",
  relationship: "relationships",
  relationships: "relationships",
  faction: "factions",
  factions: "factions",
  sect: "factions",
  organization: "factions",
  geography: "locations",
  location: "locations",
  locations: "locations",
  map: "locations",
  power: "power-system",
  "power-system": "power-system",
  cultivation: "power-system",
  ability: "power-system",
  system: "power-system",
  event: "timeline",
  events: "timeline",
  timeline: "timeline",
  "chapter-summary": "chapter-summaries",
  "chapter-summaries": "chapter-summaries",
  summary: "chapter-summaries",
  foreshadowing: "foreshadowing",
  hookline: "foreshadowing",
  clue: "foreshadowing",
  "pending-hook": "foreshadowing",
  hook: "foreshadowing",
  conflict: "conflicts",
  conflicts: "conflicts",
  prop: "props",
  props: "props",
  item: "props",
  resource: "props",
  rule: "rules",
  rules: "rules",
  taboo: "rules",
  style: "rules",
  outline: "outline",
  plot: "conflicts",
  "core-memory": "premise",
  "current-focus": "reference",
  focus: "reference",
  reference: "reference",
  misc: "reference",
  unclassified: "unclassified",
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function lookupCategory(value: unknown): JingweiCategory | undefined {
  const normalized = normalize(value);
  if (normalized.length === 0) return undefined;
  return CATEGORY_ALIASES[normalized];
}

export function isJingweiReadCategory(value: unknown): value is JingweiCategory {
  if (typeof value !== "string") return false;
  return (JINGWEI_CATEGORIES as readonly string[]).includes(value) || Boolean(CATEGORY_ALIASES[value.trim().toLowerCase()]);
}

/**
 * Resolve a category input (may be alias) to canonical JingweiCategory.
 * Returns the canonical category or "reference" as fallback.
 */
export function resolveCategory(value: string): JingweiCategory {
  if ((JINGWEI_CATEGORIES as readonly string[]).includes(value)) return value as JingweiCategory;
  return CATEGORY_ALIASES[value.trim().toLowerCase()] ?? "reference";
}

export function resolveJingweiReadCategory(
  entry: StoryJingweiEntryRecord,
  section?: StoryJingweiSectionRecord,
): JingweiCategory {
  return lookupCategory(entry.category)
    ?? lookupCategory(entry.fields.category)
    ?? lookupCategory(section?.builtinKind)
    ?? lookupCategory(section?.key)
    ?? entry.tags.map(lookupCategory).find((category): category is JingweiCategory => Boolean(category))
    // custom_fields_json 只用于迁移前异常旧数据的最后兜底。
    ?? lookupCategory(entry.customFields.category)
    ?? "reference";
}
