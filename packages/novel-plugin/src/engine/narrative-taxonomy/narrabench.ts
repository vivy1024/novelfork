/**
 * NarraBench 叙事分类骨架（arXiv:2510.09869, Wilkens & Piper）
 *
 * 为什么需要它：经纬现在是 17 个**平级** section，`parent_id` 实测全空（209/209），
 * 所以任何「树状图」都只能画出一排并列的根节点——树的骨架在数据里根本不存在。
 * 让作者手填父子关系不现实（一个月没人填过一条）。
 *
 * 解法：层级不来自人工标注，而来自**分类学本身**。NarraBench 的
 * Big-4 → 12 features → 50 aspects 是学术界对「叙事有哪些方面」的成熟划分，
 * 把现有 17 个分类挂进这棵树，层级就免费得到了。
 *
 * 同时暴露出我们的真实缺口：17 个分类几乎全挤在 STORY 维度，
 * NARRATION（视角/文风）整层缺失，DISCOURSE（时序/揭示）只有伏笔一个入口。
 *
 * 注意：NarraBench 是**评估维度**分类学，不是设定库分类。二者是「评什么」和
 * 「存什么」的关系，所以映射允许一对多，也允许我们保留 NarraBench 没有的
 * 网文特有类目（力量体系、金手指规则这些它确实没覆盖）。
 */

// ─── Big-4 维度 ───────────────────────────────────────────────────────────

export type NarraDimension = "story" | "narration" | "discourse" | "situatedness";

export interface NarraDimensionDef {
  readonly id: NarraDimension;
  readonly label: string;
  /** 一句话说明这个维度回答什么问题，用于 UI 提示。 */
  readonly question: string;
}

export const NARRA_DIMENSIONS: readonly NarraDimensionDef[] = [
  { id: "story", label: "故事", question: "故事世界里有什么、发生了什么" },
  { id: "narration", label: "叙述", question: "谁在讲、怎么讲" },
  { id: "discourse", label: "话语", question: "按什么顺序讲、何时让读者知道" },
  { id: "situatedness", label: "情境", question: "这是什么类型、为谁而写" },
] as const;

// ─── 12 个一级特征 ────────────────────────────────────────────────────────

export type NarraFeature =
  | "agent" | "social_net" | "event" | "plot" | "structure" | "setting"
  | "perspective" | "style"
  | "time" | "revelation"
  | "paratext" | "motivation";

export interface NarraFeatureDef {
  readonly id: NarraFeature;
  readonly dimension: NarraDimension;
  readonly label: string;
  /** NarraBench 的 aspect 列表（50 个 aspect 的归属）。 */
  readonly aspects: readonly string[];
}

export const NARRA_FEATURES: readonly NarraFeatureDef[] = [
  // STORY —— 我们目前几乎全部内容都在这一层
  { id: "agent", dimension: "story", label: "人物", aspects: ["name", "role", "attributes", "emotions", "motivation"] },
  { id: "social_net", dimension: "story", label: "关系网", aspects: ["interaction", "connections", "relationship"] },
  { id: "event", dimension: "story", label: "事件", aspects: ["event", "schema", "causality"] },
  { id: "plot", dimension: "story", label: "情节", aspects: ["topic", "plot", "plotline", "moral", "obstacle", "conflict", "archetype"] },
  { id: "structure", dimension: "story", label: "结构", aspects: ["plot arc"] },
  { id: "setting", dimension: "story", label: "设定", aspects: ["setting", "location"] },
  // NARRATION —— 我们整层缺失
  { id: "perspective", dimension: "narration", label: "视角", aspects: ["point of view", "focalization", "dialogue"] },
  { id: "style", dimension: "narration", label: "文风", aspects: ["allusion", "figurative", "imageability", "complexity", "evaluative"] },
  // DISCOURSE —— 我们只有伏笔一个入口
  { id: "time", dimension: "discourse", label: "时序", aspects: ["duration", "order"] },
  { id: "revelation", dimension: "discourse", label: "揭示", aspects: ["suspense", "curiosity", "surprise"] },
  // SITUATEDNESS
  { id: "paratext", dimension: "situatedness", label: "副文本", aspects: ["genre", "author", "date", "medium", "platform"] },
  { id: "motivation", dimension: "situatedness", label: "创作意图", aspects: ["intent"] },
] as const;

// ─── 现有 17 个经纬分类 → NarraBench 挂载点 ───────────────────────────────

export interface CategoryMapping {
  /** 经纬 category / section key。 */
  readonly category: string;
  readonly label: string;
  readonly feature: NarraFeature;
  /** 该分类主要落在哪些 aspect 上。 */
  readonly aspects: readonly string[];
  /**
   * NarraBench 未覆盖、属于网文特有的类目。
   * 这些保留自建，不强行塞进学术分类（力量体系、金手指规则学界确实没有对应项）。
   */
  readonly webNovelSpecific?: boolean;
}

export const CATEGORY_MAPPINGS: readonly CategoryMapping[] = [
  // ── STORY › 人物
  { category: "characters", label: "角色管理", feature: "agent", aspects: ["role", "attributes", "motivation"] },
  { category: "people", label: "人物", feature: "agent", aspects: ["name"] },
  // ── STORY › 关系网
  { category: "relationships", label: "人物关系", feature: "social_net", aspects: ["relationship", "connections"] },
  { category: "factions", label: "势力", feature: "social_net", aspects: ["connections"] },
  // ── STORY › 事件
  { category: "events", label: "事件记录", feature: "event", aspects: ["event", "causality"] },
  // ── STORY › 情节
  { category: "conflicts", label: "矛盾冲突", feature: "plot", aspects: ["conflict", "obstacle"] },
  { category: "premise", label: "故事基线", feature: "plot", aspects: ["topic"] },
  // ── STORY › 结构
  { category: "outline", label: "大纲设定", feature: "structure", aspects: ["plot arc"] },
  // ── STORY › 设定
  { category: "locations", label: "地点", feature: "setting", aspects: ["location"] },
  { category: "settings", label: "设定", feature: "setting", aspects: ["setting"] },
  { category: "world-model", label: "世界模型", feature: "setting", aspects: ["setting"] },
  { category: "power-system", label: "力量体系", feature: "setting", aspects: ["setting"], webNovelSpecific: true },
  { category: "rules", label: "写作规则", feature: "setting", aspects: ["setting"], webNovelSpecific: true },
  { category: "props", label: "道具资源", feature: "setting", aspects: ["setting"], webNovelSpecific: true },
  // ── DISCOURSE › 时序
  { category: "timeline", label: "时间线", feature: "time", aspects: ["order", "duration"] },
  { category: "chapter-summaries", label: "章节摘要", feature: "time", aspects: ["duration"] },
  // ── DISCOURSE › 揭示（伏笔的正确归属：它是「读者何时知道」，不是一种设定条目）
  { category: "foreshadowing", label: "伏笔", feature: "revelation", aspects: ["suspense", "curiosity", "surprise"] },
] as const;

/** 我们完全没有条目的 NarraBench 特征——即真实缺口。 */
export const UNCOVERED_FEATURES: readonly NarraFeature[] = ["perspective", "style", "paratext", "motivation"] as const;

// ─── 查询辅助 ─────────────────────────────────────────────────────────────

const FEATURE_BY_ID = new Map(NARRA_FEATURES.map((feature) => [feature.id, feature]));
const MAPPING_BY_CATEGORY = new Map(CATEGORY_MAPPINGS.map((mapping) => [mapping.category, mapping]));
const DIMENSION_BY_ID = new Map(NARRA_DIMENSIONS.map((dimension) => [dimension.id, dimension]));

export function featureDef(id: NarraFeature): NarraFeatureDef | undefined {
  return FEATURE_BY_ID.get(id);
}

export function dimensionDef(id: NarraDimension): NarraDimensionDef | undefined {
  return DIMENSION_BY_ID.get(id);
}

/** 经纬分类 → 挂载点。未登记的分类（自定义类目）返回 undefined，由调用方归入「其他」。 */
export function mappingForCategory(category: string): CategoryMapping | undefined {
  return MAPPING_BY_CATEGORY.get(category);
}

/** 某分类所属的 Big-4 维度；未登记时归 story（设定库默认属于故事世界）。 */
export function dimensionForCategory(category: string): NarraDimension {
  const mapping = MAPPING_BY_CATEGORY.get(category);
  if (!mapping) return "story";
  return FEATURE_BY_ID.get(mapping.feature)?.dimension ?? "story";
}

export function featuresOfDimension(dimension: NarraDimension): readonly NarraFeatureDef[] {
  return NARRA_FEATURES.filter((feature) => feature.dimension === dimension);
}

export function categoriesOfFeature(feature: NarraFeature): readonly CategoryMapping[] {
  return CATEGORY_MAPPINGS.filter((mapping) => mapping.feature === feature);
}

/** aspect 总数自检：NarraBench 论文声明 50 个。 */
export function countAspects(): number {
  return NARRA_FEATURES.reduce((sum, feature) => sum + feature.aspects.length, 0);
}
