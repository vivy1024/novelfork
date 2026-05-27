import type { JingweiBriefIndex, JingweiBriefIndexCategory, JingweiReadableItem, JingweiReadCategory } from "../types.js";
import { JINGWEI_CATEGORY_RECOMMENDED_WHEN, JINGWEI_CATEGORY_TITLES } from "./category-map.js";

function emptyCounts(category: JingweiReadCategory): JingweiBriefIndexCategory {
  return {
    category,
    title: JINGWEI_CATEGORY_TITLES[category],
    count: 0,
    estimatedTokens: 0,
    coreCount: 0,
    relevantCount: 0,
    referenceCount: 0,
    updatedAt: null,
    recommendedWhen: JINGWEI_CATEGORY_RECOMMENDED_WHEN[category],
  };
}

export function buildJingweiIndexFromItems(items: readonly JingweiReadableItem[]): JingweiBriefIndex {
  const byCategory = new Map<JingweiReadCategory, JingweiBriefIndexCategory>();

  for (const item of items) {
    const current = byCategory.get(item.category) ?? emptyCounts(item.category);
    const updatedAt = new Date(item.updatedAtMs).toISOString();
    byCategory.set(item.category, {
      ...current,
      count: current.count + 1,
      estimatedTokens: current.estimatedTokens + item.estimatedTokens,
      coreCount: current.coreCount + (item.priorityTier === "core" ? 1 : 0),
      relevantCount: current.relevantCount + (item.priorityTier === "relevant" || item.priorityTier === "auto" ? 1 : 0),
      referenceCount: current.referenceCount + (item.priorityTier === "reference" ? 1 : 0),
      updatedAt: current.updatedAt && current.updatedAt > updatedAt ? current.updatedAt : updatedAt,
    });
  }

  return {
    categories: [...byCategory.values()].sort((a, b) => b.coreCount - a.coreCount || b.count - a.count || a.title.localeCompare(b.title)),
  };
}
