/**
 * Jingwei Category Schemas — field schemas for structured entry management.
 * Category enumeration sourced from unified-categories (single source of truth).
 */

import {
  CATEGORY_META,
  normalizeCategory,
  type JingweiCategory,
} from "../../../engine/jingwei/unified-categories";

// ---------------------------------------------------------------------------
// Type exports (downstream consumers depend on these)
// ---------------------------------------------------------------------------

export type JingweiFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "multi-select"
  | "chapter"
  | "tags"
  | "relation"
  | "boolean";

export interface CategoryFieldSchema {
  key: string;
  label: string;
  type: JingweiFieldType;
  required: boolean;
  options?: string[];
  helpText?: string;
}

export type CategoryVisibility = "global" | "tracked" | "nested";

export interface CategorySchema {
  id: string;
  name: string;
  icon: string;
  color: string;
  fields: CategoryFieldSchema[];
  defaultVisibility: CategoryVisibility;
}

// ---------------------------------------------------------------------------
// Field schemas per unified category
// ---------------------------------------------------------------------------

export const CATEGORY_FIELD_SCHEMAS: Partial<Record<JingweiCategory, CategoryFieldSchema[]>> = {
  characters: [
    { key: "name", label: "姓名", type: "text", required: true },
    { key: "aliases", label: "别名", type: "tags", required: false },
    { key: "roleType", label: "角色定位", type: "text", required: false, helpText: "自由填写，如：主角、同事、上级、灵科院研究员" },
    { key: "realm", label: "境界/职级", type: "text", required: false },
    { key: "personality", label: "性格", type: "textarea", required: false },
    { key: "goal", label: "目标", type: "textarea", required: false },
    { key: "firstChapter", label: "首次出场章节", type: "chapter", required: false },
  ],
  conflicts: [
    { key: "name", label: "事件名称", type: "text", required: true },
    { key: "eventType", label: "事件类型", type: "text", required: false, helpText: "如：主线、日常、冲突、突破" },
    { key: "chapterStart", label: "起始章节", type: "chapter", required: false },
    { key: "chapterEnd", label: "结束章节", type: "chapter", required: false },
    { key: "summary", label: "摘要", type: "textarea", required: true },
  ],
  "world-model": [
    { key: "name", label: "名称", type: "text", required: true },
    { key: "description", label: "描述", type: "textarea", required: true },
  ],
  "power-system": [
    { key: "name", label: "体系名称", type: "text", required: true },
    { key: "description", label: "等级/规则", type: "textarea", required: true, helpText: "自由描述等级体系、公式、约束" },
  ],
  locations: [
    { key: "name", label: "地名", type: "text", required: true },
    { key: "aliases", label: "别名", type: "tags", required: false },
    { key: "locationType", label: "地点类型", type: "text", required: false, helpText: "如：研究所、实验室、办公室、城市" },
    { key: "description", label: "描述", type: "textarea", required: true },
  ],
  factions: [
    { key: "name", label: "势力名称", type: "text", required: true },
    { key: "type", label: "类型", type: "text", required: false, helpText: "如：政府机构、企业、研究团队、宗门" },
    { key: "description", label: "描述", type: "textarea", required: true },
  ],
  props: [
    { key: "name", label: "物品名称", type: "text", required: true },
    { key: "grade", label: "品级/等级", type: "text", required: false, helpText: "自由填写品级体系" },
    { key: "effect", label: "效果/属性", type: "textarea", required: true },
  ],
  outline: [
    { key: "name", label: "卷名", type: "text", required: true },
    { key: "volumeNumber", label: "卷号", type: "number", required: true },
    { key: "chapters", label: "章节范围", type: "text", required: false },
    { key: "goal", label: "本卷目标", type: "textarea", required: true },
  ],
  relationships: [
    { key: "sourceName", label: "角色A", type: "relation", required: true },
    { key: "targetName", label: "角色B", type: "relation", required: true },
    { key: "relationType", label: "关系类型", type: "text", required: false, helpText: "如：师徒、同事、上下级、竞争" },
    { key: "description", label: "关系描述", type: "textarea", required: false },
    { key: "since", label: "起始章节", type: "chapter", required: false },
  ],
  foreshadowing: [
    { key: "name", label: "伏笔名称", type: "text", required: true },
    { key: "plantedChapter", label: "埋设章节", type: "chapter", required: true },
    { key: "status", label: "状态", type: "text", required: false, helpText: "如：已埋设、部分揭示、已回收" },
    { key: "description", label: "描述", type: "textarea", required: true },
  ],
  timeline: [
    { key: "name", label: "事件名称", type: "text", required: true },
    { key: "date", label: "时间", type: "text", required: true },
    { key: "description", label: "描述", type: "textarea", required: false },
  ],
  "chapter-summaries": [
    { key: "chapterNumber", label: "章节号", type: "number", required: true },
    { key: "title", label: "章节标题", type: "text", required: true },
    { key: "summary", label: "摘要", type: "textarea", required: true },
    { key: "pov", label: "视角", type: "text", required: false },
  ],
};

// ---------------------------------------------------------------------------
// Derived CATEGORY_SCHEMAS (preserves original export shape)
// ---------------------------------------------------------------------------

export const CATEGORY_SCHEMAS: CategorySchema[] = CATEGORY_META.map((meta) => ({
  id: meta.id,
  name: meta.name,
  icon: meta.icon,
  color: meta.color,
  defaultVisibility: meta.defaultVisibility,
  fields: CATEGORY_FIELD_SCHEMAS[meta.id] ?? [],
}));

/**
 * Get a category schema by its ID.
 * Accepts both legacy and unified category IDs.
 * Returns undefined if the category is not found.
 */
export function getCategorySchema(id: string): CategorySchema | undefined {
  const { category } = normalizeCategory(id);
  return CATEGORY_SCHEMAS.find((schema) => schema.id === category);
}
