import { LEGACY_CATEGORY_MAP, normalizeCategory, type JingweiCategory } from "./unified-categories.js";

/**
 * 返回一个统一分类在数据库中可能出现的旧值/兼容值。
 * 新数据优先使用 canonical category，旧数据通过 aliases 继续可读。
 */
export function getJingweiCategoryAliases(category: JingweiCategory | string): string[] {
  const canonical = normalizeCategory(category).category;
  const aliases = Object.entries(LEGACY_CATEGORY_MAP)
    .filter(([, mapping]) => mapping.category === canonical)
    .map(([legacy]) => legacy);
  return [...new Set([canonical, category, ...aliases])].filter((value) => value.trim().length > 0);
}

export function sqlInPlaceholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}
