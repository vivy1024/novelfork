/**
 * unified-categories.ts — 经纬统一分类定义（唯一真相源）
 *
 * 设计文档: .kiro/specs/jingwei-data-layer-unify/design.md 单元 1
 *
 * 合并了原 category-schemas.ts（UI 16 类）和 read-model/category-map.ts（15 类），
 * 消除双轨割裂。前端编辑与 agent 读取共用同一套分类枚举。
 */

// ---------------------------------------------------------------------------
// 权威分类枚举（16 类）
// ---------------------------------------------------------------------------

export const JINGWEI_CATEGORIES = [
  "premise",
  "world-model",
  "characters",
  "relationships",
  "factions",
  "locations",
  "props",
  "outline",
  "conflicts",
  "foreshadowing",
  "timeline",
  "chapter-summaries",
  "power-system",
  "rules",
  "reference",
  "unclassified",
] as const;

export type JingweiCategory = (typeof JINGWEI_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// 分类元数据（UI 展示 + agent 读取语义）
// ---------------------------------------------------------------------------

/** 数据层：经纬条目的层级语义。canon=不可变真相，dynamic=章后可变，reference=按需查阅。 */
export type JingweiCategoryLayer = "canon" | "dynamic" | "reference";

export interface CategoryMeta {
  readonly id: JingweiCategory;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly defaultVisibility: "global" | "tracked" | "nested";
  /** agent 何时应读取本分类（供 recommendedReads 使用） */
  readonly recommendedWhen: string;
  /**
   * 本分类的默认层级。写入未显式指定 layer 时采用。
   * 这是分类对「静态设定 vs 章后动态」的显式表态，取代按内容正则猜测。
   */
  readonly defaultLayer: JingweiCategoryLayer;
  /** 是否允许写入 canon 层。天然随剧情推进的分类为 false。 */
  readonly allowCanon: boolean;
}

export const CATEGORY_META: readonly CategoryMeta[] = [
  { id: "premise", name: "故事基线", icon: "sparkles", color: "amber", defaultVisibility: "global", defaultLayer: "canon", allowCanon: true, recommendedWhen: "确认核心卖点、主线承诺、基调时读取。" },
  { id: "world-model", name: "世界模型", icon: "globe", color: "purple", defaultVisibility: "global", defaultLayer: "canon", allowCanon: true, recommendedWhen: "确认世界规则、修炼/科技/社会运行逻辑时读取。" },
  { id: "characters", name: "角色", icon: "user", color: "blue", defaultVisibility: "tracked", defaultLayer: "canon", allowCanon: true, recommendedWhen: "涉及角色登场、动机、口吻、成长变化时读取。" },
  { id: "relationships", name: "关系", icon: "heart-handshake", color: "pink", defaultVisibility: "tracked", defaultLayer: "dynamic", allowCanon: false, recommendedWhen: "涉及人物关系、阵营关系、情感/利益牵扯时读取。" },
  { id: "factions", name: "势力", icon: "shield", color: "red", defaultVisibility: "tracked", defaultLayer: "canon", allowCanon: true, recommendedWhen: "涉及宗门、组织、势力博弈、阵营冲突时读取。" },
  { id: "locations", name: "地点", icon: "map", color: "green", defaultVisibility: "global", defaultLayer: "canon", allowCanon: true, recommendedWhen: "涉及地点、地图、场景调度、地域设定时读取。" },
  { id: "props", name: "道具资源", icon: "package", color: "amber", defaultVisibility: "tracked", defaultLayer: "canon", allowCanon: true, recommendedWhen: "涉及关键道具、资源、账本、特殊物品时读取。" },
  { id: "outline", name: "卷纲/大纲", icon: "list-tree", color: "sky", defaultVisibility: "global", defaultLayer: "dynamic", allowCanon: false, recommendedWhen: "规划章节结构、确认本卷目标、检查推进位置时读取。" },
  { id: "conflicts", name: "矛盾冲突", icon: "swords", color: "orange", defaultVisibility: "tracked", defaultLayer: "dynamic", allowCanon: false, recommendedWhen: "设计冲突、推进矛盾、确认 stakes 与解决状态时读取。" },
  { id: "foreshadowing", name: "伏笔", icon: "eye", color: "indigo", defaultVisibility: "tracked", defaultLayer: "dynamic", allowCanon: false, recommendedWhen: "埋设、推进、回收伏笔或检查悬念债务时读取。" },
  { id: "timeline", name: "时间线", icon: "clock", color: "slate", defaultVisibility: "global", defaultLayer: "dynamic", allowCanon: false, recommendedWhen: "涉及事件顺序、历史因果、当前推进位置时读取。" },
  { id: "chapter-summaries", name: "章节摘要", icon: "file-text", color: "stone", defaultVisibility: "nested", defaultLayer: "dynamic", allowCanon: false, recommendedWhen: "写下一章、审计连续性、回顾近期剧情时读取。" },
  { id: "power-system", name: "能力体系", icon: "zap", color: "yellow", defaultVisibility: "global", defaultLayer: "canon", allowCanon: true, recommendedWhen: "涉及能力、修炼、装备、等级、数值规则时读取。" },
  { id: "rules", name: "写作规则", icon: "scroll", color: "emerald", defaultVisibility: "global", defaultLayer: "canon", allowCanon: true, recommendedWhen: "确认作者禁忌、文风规则、平台合规或创作约束时读取。" },
  { id: "reference", name: "参考资料", icon: "bookmark", color: "gray", defaultVisibility: "nested", defaultLayer: "reference", allowCanon: false, recommendedWhen: "补充背景资料、低频设定或非核心细节时读取。" },
  { id: "unclassified", name: "未分类", icon: "help-circle", color: "gray", defaultVisibility: "nested", defaultLayer: "reference", allowCanon: false, recommendedWhen: "导入后尚未分类，需人工确认或模型辅助归类时读取。" },
];

export function getCategoryMeta(id: string): CategoryMeta | undefined {
  return CATEGORY_META.find((m) => m.id === id);
}

/**
 * 分类的默认层级；未知分类按 reference 处理。
 * 写入方未显式给 layer 时使用本值，避免「猜内容」。
 */
export function getCategoryDefaultLayer(rawCategory: string): JingweiCategoryLayer {
  const { category } = normalizeCategory(rawCategory);
  return getCategoryMeta(category)?.defaultLayer ?? "reference";
}

/** 该分类是否允许写入 canon 层。 */
export function categoryAllowsCanon(rawCategory: string): boolean {
  const { category } = normalizeCategory(rawCategory);
  return getCategoryMeta(category)?.allowCanon ?? false;
}

/** 是否为章后动态推进的分类（对应 defaultLayer=dynamic）。 */
export function isDynamicProgressCategory(rawCategory: string): boolean {
  return getCategoryDefaultLayer(rawCategory) === "dynamic";
}

/** 静态设定分类：canon 层分类，供前端静态 Lore 视图使用。 */
export function isStaticLoreCategoryByLayer(rawCategory: string): boolean {
  return getCategoryDefaultLayer(rawCategory) === "canon";
}

// ---------------------------------------------------------------------------
// 子分类（仅 UI 展开用，数据层存顶层 category + customFields.subcategory）
// ---------------------------------------------------------------------------

export interface SubCategory {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
}

export const CATEGORY_SUBCATEGORIES: Partial<Record<JingweiCategory, readonly SubCategory[]>> = {
  props: [
    { id: "item", name: "物品", icon: "package" },
    { id: "skill", name: "功法", icon: "flame" },
    { id: "currency", name: "货币", icon: "coins" },
  ],
  "world-model": [
    { id: "geography", name: "地理", icon: "map" },
    { id: "special", name: "特殊设定", icon: "sparkles" },
  ],
  conflicts: [
    { id: "plot", name: "情节脉络", icon: "git-branch" },
    { id: "event", name: "事件", icon: "calendar" },
  ],
};

// ---------------------------------------------------------------------------
// 旧分类 → 统一分类映射（迁移用）
// ---------------------------------------------------------------------------

export const LEGACY_CATEGORY_MAP: Record<string, { category: JingweiCategory; subcategory?: string }> = {
  character: { category: "characters" },
  event: { category: "conflicts", subcategory: "event" },
  worldview: { category: "world-model" },
  "power-system": { category: "power-system" },
  geography: { category: "locations" },
  faction: { category: "factions" },
  item: { category: "props", subcategory: "item" },
  skill: { category: "props", subcategory: "skill" },
  currency: { category: "props", subcategory: "currency" },
  special: { category: "world-model", subcategory: "special" },
  outline: { category: "outline" },
  relationship: { category: "relationships" },
  foreshadowing: { category: "foreshadowing" },
  plot: { category: "conflicts", subcategory: "plot" },
  timeline: { category: "timeline" },
  "chapter-summary": { category: "chapter-summaries" },
  setting: { category: "world-model" },
  // 读模型已有的分类（直接对应自身，无需映射）
  premise: { category: "premise" },
  "world-model": { category: "world-model" },
  characters: { category: "characters" },
  relationships: { category: "relationships" },
  factions: { category: "factions" },
  locations: { category: "locations" },
  props: { category: "props" },
  conflicts: { category: "conflicts" },
  "chapter-summaries": { category: "chapter-summaries" },
  rules: { category: "rules" },
  reference: { category: "reference" },
  unclassified: { category: "unclassified" },
};

/**
 * 将任意旧/新 category 值规范化为统一枚举。
 * 未知值归入 "unclassified"。
 */
export function normalizeCategory(raw: string): { category: JingweiCategory; subcategory?: string } {
  const mapped = LEGACY_CATEGORY_MAP[raw];
  if (mapped) return mapped;
  // 已经是统一枚举值
  if ((JINGWEI_CATEGORIES as readonly string[]).includes(raw)) {
    return { category: raw as JingweiCategory };
  }
  return { category: "unclassified" };
}

/**
 * 校验是否为合法的统一分类值。
 */
export function isValidCategory(value: string): value is JingweiCategory {
  return (JINGWEI_CATEGORIES as readonly string[]).includes(value);
}
