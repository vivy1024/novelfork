/**
 * canon 条目的召回口径：「全书硬规则」 vs 「实体型 canon」。
 *
 * 分类依据只看经纬分类表态（CATEGORY_META.defaultLayer / allowCanon），不靠内容正则猜：
 *   - 全书硬规则：premise / world-model / power-system / rules —— 不绑定某个出场实体、
 *     对任何一章都成立的设定。全量进 hard 通道（不可丢弃）。
 *   - 实体型 canon：characters / factions / locations / props —— 绑定一个实体，
 *     只在该实体出场时才和本章相关。按出场相关性召回进 state 通道（可降档）。
 *   - 其余 allowCanon=false 的分类（关系、伏笔、章摘要…）不该是 canon；
 *     即使被误标 canon/core，也按实体型处理（相关才注入），不再占 hard。
 *
 * 分区（section）用作分类兜底：经纬读模型 resolveJingweiReadCategory 依次看
 * entry.category → fields.category → section.builtinKind → section.key → tags。
 */

import { resolveJingweiReadCategory } from "../jingwei/read-model/category-map.js";
import type { StoryJingweiEntryRecord, StoryJingweiSectionRecord } from "../jingwei/types.js";
import { getCategoryMeta, type JingweiCategory } from "../jingwei/unified-categories.js";

/** 不绑定实体、对全书生效的 canon 分类。 */
export const BOOK_WIDE_CANON_CATEGORIES: ReadonlySet<JingweiCategory> = new Set<JingweiCategory>([
  "premise",
  "world-model",
  "power-system",
  "rules",
]);

export type CanonScope = "book-rule" | "entity" | "not-canon";

export function isCanonEntry(entry: Pick<StoryJingweiEntryRecord, "layer" | "priorityTier">): boolean {
  return entry.layer === "canon" || entry.priorityTier === "core";
}

/**
 * 条目的召回口径：
 *   - book-rule：全书硬规则分类（不论 layer；规则类分类默认就是 canon）；
 *   - entity：实体型分类且标了 canon/core；或非 canon 分类被误标 canon/core；
 *   - not-canon：其余。
 */
export function classifyCanonScope(entry: StoryJingweiEntryRecord, section?: StoryJingweiSectionRecord): CanonScope {
  const category = resolveJingweiReadCategory(entry, section);
  if (BOOK_WIDE_CANON_CATEGORIES.has(category)) {
    // 规则类分类（defaultLayer=canon）：沿用此前 hard 通道「规则/世界分类全量注入」的口径——
    // 仓储建条目时 layer 默认写 dynamic，不能据此把作者写的世界规则踢出 hard。
    // 只有作者显式降为 reference（参考资料）的才不进 hard。
    return getCategoryMeta(category)?.defaultLayer === "canon" && entry.layer !== "reference" ? "book-rule" : "not-canon";
  }
  if (isCanonEntry(entry)) return "entity";
  return "not-canon";
}

/** 实体型 canon 的可比名：标题 + 别名。 */
export function canonEntryNames(entry: Pick<StoryJingweiEntryRecord, "title" | "aliases">): string[] {
  return [entry.title, ...entry.aliases].map((name) => name.trim()).filter((name) => name.length > 0);
}

/**
 * 实体型 canon 是否与本章相关：出场实体（sceneSpec 角色 / 地点 / 点名实体）与条目名互相包含，
 * 或本章正文 / 计划文本里出现条目标题或别名。
 */
export function isEntityCanonRelevant(
  entry: Pick<StoryJingweiEntryRecord, "title" | "aliases">,
  queryEntities: readonly string[],
  sceneText?: string,
): boolean {
  const names = canonEntryNames(entry);
  if (names.length === 0) return false;
  for (const entity of queryEntities) {
    const query = entity.trim();
    if (!query) continue;
    if (names.some((name) => name === query || (name.length >= 2 && query.includes(name)) || (query.length >= 2 && name.includes(query)))) return true;
  }
  if (sceneText && names.some((name) => name.length >= 2 && sceneText.includes(name))) return true;
  return false;
}
