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
  relationship: "关系",
  hook: "伏笔",
  timeline: "时间线",
  conflict: "矛盾冲突",
  world_fact: "世界事实",
  character_state: "角色状态",
  location: "地点状态",
};

export function memoryFactLabel(category: string): string {
  return MEMORY_FACT_LABELS[category] ?? category;
}
