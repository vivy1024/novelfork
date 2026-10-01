/**
 * 经纬 / 叙事记忆的工作区切分。
 *
 * 单一权威源纪律：一个分类算「静态设定」还是「章后动态推进」，
 * 只由 `CATEGORY_META.defaultLayer` 表态，不在 UI 侧另存一份分类名单，
 * 也不靠条目标题的正则去猜。
 */

import {
  CATEGORY_META,
  getCategoryDefaultLayer,
  normalizeCategory,
  type JingweiCategory,
} from "../../engine/jingwei/unified-categories.js";

/** 静态设定（可作为 canon 基线）还是章后推进产物。 */
export type LoreWorkspace = "settings" | "progress";

/**
 * 分类归属哪个工作区。
 * `defaultLayer=dynamic` 的分类随剧情推进，归「进度」；其余归「设定」。
 */
export function workspaceForCategory(rawCategory: string): LoreWorkspace {
  return getCategoryDefaultLayer(rawCategory) === "dynamic" ? "progress" : "settings";
}

/** 该分类是否属于静态设定工作区。 */
export function isSettingsCategory(rawCategory: string): boolean {
  return workspaceForCategory(rawCategory) === "settings";
}

/** 按 CATEGORY_META 的既有顺序列出某个工作区的分类。 */
export function categoriesForWorkspace(workspace: LoreWorkspace): JingweiCategory[] {
  return CATEGORY_META
    .filter((meta) => workspaceForCategory(meta.id) === workspace)
    .map((meta) => meta.id);
}

export interface LoreEntryLike {
  readonly category?: string;
  readonly title?: string;
}

/**
 * 条目归属哪个工作区。
 *
 * 只看归一化后的分类。历史上这里还会用标题去排除「人物关系」「章节摘要」之类的
 * 占位条目，那是按内容猜层级，会把作者真名叫「时间线」的设定条目误判掉。
 */
export function workspaceForEntry(entry: LoreEntryLike): LoreWorkspace {
  return workspaceForCategory(entry.category ?? "unclassified");
}

/** 按工作区分组条目，保留 CATEGORY_META 顺序，且丢弃空分类。 */
export function groupEntriesByCategory<Entry extends LoreEntryLike>(
  entries: readonly Entry[],
  workspace: LoreWorkspace,
): Array<{ readonly category: JingweiCategory; readonly name: string; readonly entries: Entry[] }> {
  const byCategory = new Map<string, Entry[]>();
  for (const entry of entries) {
    const category = normalizeCategory(entry.category ?? "unclassified").category;
    if (workspaceForCategory(category) !== workspace) continue;
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(entry);
    else byCategory.set(category, [entry]);
  }
  return CATEGORY_META
    .filter((meta) => workspaceForCategory(meta.id) === workspace)
    .flatMap((meta) => {
      const bucket = byCategory.get(meta.id);
      return bucket && bucket.length > 0
        ? [{ category: meta.id, name: meta.name, entries: bucket }]
        : [];
    });
}

/**
 * Narrative Memory 的 fact category 与经纬分类不同名，这里做展示用映射。
 * 这不是第二套分类定义：它只把记忆通道名翻译成作者看得懂的中文标签。
 */
const MEMORY_FACT_LABELS: Record<string, string> = {
  state: "状态",
  relationship: "关系",
  hook: "伏笔",
  timeline: "时间线",
  conflict: "矛盾冲突",
  world_fact: "世界事实",
  character_state: "角色状态",
  location: "地点状态",
  inventory: "持有物品",
};

export function memoryFactLabel(category: string): string {
  return MEMORY_FACT_LABELS[category] ?? category;
}

/** 作者手填状态时可选的记忆分类（值仍是记忆通道名，界面只显示中文）。 */
export const MEMORY_FACT_CATEGORY_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> =
  Object.entries(MEMORY_FACT_LABELS).map(([value, label]) => ({ value, label }));

/**
 * 记忆事实分类的显示名。
 * 记忆通道名（character_state 等）先查上表；经纬分类名（characters、character 等旧名）
 * 走 CATEGORY_META 的中文名；两边都认不出时原样显示（多半是作者自己写的中文分类）。
 */
export function factCategoryLabel(category: string): string {
  const memoryLabel = MEMORY_FACT_LABELS[category];
  if (memoryLabel) return memoryLabel;
  return jingweiCategoryName(category) ?? category;
}

/** 经纬分类（含旧分类名）→ CATEGORY_META 中文名；认不出返回 null。 */
function jingweiCategoryName(rawCategory: string): string | null {
  const raw = rawCategory.trim();
  if (!raw) return null;
  const { category } = normalizeCategory(raw);
  // normalizeCategory 把认不出的值归到 unclassified；只有真的写了 unclassified 才叫「未分类」。
  if (category === "unclassified" && raw !== "unclassified") return null;
  return CATEGORY_META.find((meta) => meta.id === category)?.name ?? null;
}

/** 经纬分类在界面上的中文名，如 characters → 角色；认不出时原样返回。 */
export function jingweiCategoryLabel(rawCategory: string): string {
  return jingweiCategoryName(rawCategory) ?? rawCategory;
}

/**
 * 经纬条目层级的作者说法，含义取自 JingweiCategoryLayer：
 * canon 是不随剧情改的真相，dynamic 是章后会变的状态，reference 是按需查阅的资料。
 */
const LAYER_LABELS: Record<string, string> = {
  canon: "固定设定",
  dynamic: "随剧情变化",
  reference: "按需查阅",
};

export function jingweiLayerLabel(layer: string): string {
  return LAYER_LABELS[layer] ?? layer;
}

/** 记忆事实来源（NarrativeFactSourceType）的作者说法。 */
const FACT_SOURCE_LABELS: Record<string, string> = {
  manual: "作者手填",
  event: "章后结算",
  import: "导入",
  jingwei: "作品设定",
  "runtime-state": "章节状态推算",
};

export function factSourceLabel(sourceType: string): string {
  return FACT_SOURCE_LABELS[sourceType] ?? "其他来源";
}

/**
 * 低于这个置信度才提示「不太确定」。与章后事实待审队列的「低置信 <0.6」同一口径；
 * 高置信的条目不显示百分比，免得作者以为要逐条核对数字。
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export function isLowConfidence(confidence: number | undefined): boolean {
  return typeof confidence === "number" && confidence < LOW_CONFIDENCE_THRESHOLD;
}
