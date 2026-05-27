import type { JingweiReadCategory, StoryJingweiEntryRecord, StoryJingweiSectionRecord } from "../types.js";

export const JINGWEI_READ_CATEGORIES = [
  "premise",
  "world-model",
  "characters",
  "relationships",
  "factions",
  "locations",
  "power-system",
  "timeline",
  "chapter-summaries",
  "foreshadowing",
  "conflicts",
  "props",
  "rules",
  "reference",
  "unclassified",
] as const satisfies readonly JingweiReadCategory[];

export const JINGWEI_CATEGORY_TITLES: Record<JingweiReadCategory, string> = {
  premise: "故事基线",
  "world-model": "世界模型",
  characters: "角色",
  relationships: "关系",
  factions: "势力",
  locations: "地点",
  "power-system": "能力体系",
  timeline: "时间线",
  "chapter-summaries": "章节摘要",
  foreshadowing: "伏笔",
  conflicts: "矛盾",
  props: "道具资源",
  rules: "写作规则",
  reference: "参考资料",
  unclassified: "未分类",
};

export const JINGWEI_CATEGORY_RECOMMENDED_WHEN: Record<JingweiReadCategory, string> = {
  premise: "需要确认故事核心卖点、主线承诺、基调时读取。",
  "world-model": "需要确认世界规则、修炼/科技/社会运行逻辑时读取。",
  characters: "涉及角色登场、动机、口吻、成长变化时读取。",
  relationships: "涉及人物关系、阵营关系、情感/利益牵扯时读取。",
  factions: "涉及宗门、组织、势力博弈、阵营冲突时读取。",
  locations: "涉及地点、地图、场景调度、地域设定时读取。",
  "power-system": "涉及能力、修炼、装备、等级、数值规则时读取。",
  timeline: "涉及事件顺序、历史因果、当前推进位置时读取。",
  "chapter-summaries": "写下一章、审计连续性、回顾近期剧情时读取。",
  foreshadowing: "埋设、推进、回收伏笔或检查悬念债务时读取。",
  conflicts: "设计冲突、推进矛盾、确认 stakes 与解决状态时读取。",
  props: "涉及关键道具、资源、账本、特殊物品时读取。",
  rules: "需要确认作者禁忌、文风规则、平台合规或创作约束时读取。",
  reference: "需要补充背景资料、低频设定或非核心细节时读取。",
  unclassified: "导入后尚未分类，需要人工确认或模型辅助归类时读取。",
};

const CATEGORY_ALIASES: Record<string, JingweiReadCategory> = {
  premise: "premise",
  logline: "premise",
  hook: "premise",
  "world-model": "world-model",
  world: "world-model",
  setting: "world-model",
  settings: "world-model",
  people: "characters",
  person: "characters",
  character: "characters",
  characters: "characters",
  role: "characters",
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
  reference: "reference",
  misc: "reference",
  unclassified: "unclassified",
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function lookupCategory(value: unknown): JingweiReadCategory | undefined {
  const normalized = normalize(value);
  if (normalized.length === 0) return undefined;
  return CATEGORY_ALIASES[normalized];
}

export function isJingweiReadCategory(value: unknown): value is JingweiReadCategory {
  return typeof value === "string" && JINGWEI_READ_CATEGORIES.includes(value as JingweiReadCategory);
}

export function resolveJingweiReadCategory(
  entry: StoryJingweiEntryRecord,
  section?: StoryJingweiSectionRecord,
): JingweiReadCategory {
  return lookupCategory(entry.customFields.category)
    ?? lookupCategory(section?.builtinKind)
    ?? lookupCategory(section?.key)
    ?? entry.tags.map(lookupCategory).find((category): category is JingweiReadCategory => Boolean(category))
    ?? "reference";
}
