/**
 * Jingwei Category Schemas — 16 categories for structured entry management.
 * Each category defines its field schema, display metadata, and default visibility.
 */

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

export const CATEGORY_SCHEMAS: CategorySchema[] = [
  {
    id: "character",
    name: "角色管理",
    icon: "user",
    color: "blue",
    defaultVisibility: "tracked",
    fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "aliases", label: "别名", type: "tags", required: false },
      { key: "roleType", label: "角色类型", type: "select", required: true, options: ["主角", "配角", "反派", "龙套", "导师", "伙伴"] },
      { key: "realm", label: "境界", type: "text", required: false },
      { key: "personality", label: "性格", type: "textarea", required: false },
      { key: "goal", label: "目标", type: "textarea", required: false },
      { key: "appearance", label: "外貌", type: "textarea", required: false },
      { key: "backstory", label: "背景故事", type: "textarea", required: false },
      { key: "firstChapter", label: "首次出场章节", type: "chapter", required: false },
    ],
  },
  {
    id: "event",
    name: "事件记录",
    icon: "calendar",
    color: "orange",
    defaultVisibility: "tracked",
    fields: [
      { key: "name", label: "事件名称", type: "text", required: true },
      { key: "eventType", label: "事件类型", type: "select", required: true, options: ["主线", "支线", "日常", "战斗", "转折", "高潮"] },
      { key: "chapterStart", label: "起始章节", type: "chapter", required: false },
      { key: "chapterEnd", label: "结束章节", type: "chapter", required: false },
      { key: "summary", label: "摘要", type: "textarea", required: true },
      { key: "relatedCharacters", label: "相关角色", type: "relation", required: false },
      { key: "foreshadowState", label: "伏笔状态", type: "select", required: false, options: ["已埋设", "已揭示", "已回收", "已废弃"] },
    ],
  },
  {
    id: "worldview",
    name: "世界观设定",
    icon: "globe",
    color: "purple",
    defaultVisibility: "global",
    fields: [
      { key: "name", label: "名称", type: "text", required: true },
      { key: "description", label: "描述", type: "textarea", required: true },
      { key: "rules", label: "规则", type: "textarea", required: false },
      { key: "constraints", label: "限制条件", type: "textarea", required: false },
    ],
  },
  {
    id: "power-system",
    name: "力量体系",
    icon: "zap",
    color: "yellow",
    defaultVisibility: "global",
    fields: [
      { key: "name", label: "体系名称", type: "text", required: true },
      { key: "levels", label: "等级划分", type: "textarea", required: true, helpText: "每行一个等级，从低到高" },
      { key: "breakthroughConditions", label: "突破条件", type: "textarea", required: false },
      { key: "limitations", label: "限制", type: "textarea", required: false },
      { key: "description", label: "描述", type: "textarea", required: false },
    ],
  },
  {
    id: "geography",
    name: "地理地图",
    icon: "map",
    color: "green",
    defaultVisibility: "global",
    fields: [
      { key: "name", label: "地名", type: "text", required: true },
      { key: "aliases", label: "别名", type: "tags", required: false },
      { key: "locationType", label: "地点类型", type: "select", required: true, options: ["城市", "山脉", "河流", "秘境", "宗门", "国家", "大陆", "其他"] },
      { key: "description", label: "描述", type: "textarea", required: true },
      { key: "features", label: "特征", type: "textarea", required: false },
      { key: "dangers", label: "危险", type: "textarea", required: false },
    ],
  },
  {
    id: "faction",
    name: "势力阵营",
    icon: "shield",
    color: "red",
    defaultVisibility: "tracked",
    fields: [
      { key: "name", label: "势力名称", type: "text", required: true },
      { key: "type", label: "类型", type: "select", required: true, options: ["宗门", "家族", "王朝", "商会", "暗组织", "联盟", "其他"] },
      { key: "leader", label: "首领", type: "relation", required: false },
      { key: "members", label: "成员", type: "relation", required: false },
      { key: "territory", label: "领地", type: "text", required: false },
      { key: "goals", label: "目标", type: "textarea", required: false },
      { key: "relations", label: "外交关系", type: "textarea", required: false },
    ],
  },
  {
    id: "item",
    name: "物品列表",
    icon: "package",
    color: "amber",
    defaultVisibility: "tracked",
    fields: [
      { key: "name", label: "物品名称", type: "text", required: true },
      { key: "grade", label: "品级", type: "select", required: false, options: ["凡品", "灵品", "仙品", "神品", "混沌级"] },
      { key: "effect", label: "效果", type: "textarea", required: true },
      { key: "source", label: "来源", type: "text", required: false },
      { key: "limitations", label: "限制", type: "textarea", required: false },
    ],
  },
  {
    id: "skill",
    name: "功法体系",
    icon: "flame",
    color: "rose",
    defaultVisibility: "tracked",
    fields: [
      { key: "name", label: "功法名称", type: "text", required: true },
      { key: "grade", label: "品级", type: "select", required: false, options: ["黄级", "玄级", "地级", "天级", "圣级", "神级"] },
      { key: "requirements", label: "修炼条件", type: "textarea", required: false },
      { key: "effects", label: "效果", type: "textarea", required: true },
      { key: "sideEffects", label: "副作用", type: "textarea", required: false },
    ],
  },
  {
    id: "currency",
    name: "货币体系",
    icon: "coins",
    color: "emerald",
    defaultVisibility: "global",
    fields: [
      { key: "name", label: "货币名称", type: "text", required: true },
      { key: "units", label: "单位", type: "tags", required: true, helpText: "如：铜币、银币、金币、灵石" },
      { key: "exchangeRate", label: "兑换比率", type: "textarea", required: false },
      { key: "sources", label: "获取途径", type: "textarea", required: false },
    ],
  },
  {
    id: "special",
    name: "特殊设定",
    icon: "sparkles",
    color: "violet",
    defaultVisibility: "global",
    fields: [
      { key: "name", label: "名称", type: "text", required: true },
      { key: "description", label: "描述", type: "textarea", required: true },
      { key: "rules", label: "规则", type: "textarea", required: false },
      { key: "exceptions", label: "例外", type: "textarea", required: false },
    ],
  },
  {
    id: "outline",
    name: "大纲设定",
    icon: "list-tree",
    color: "sky",
    defaultVisibility: "global",
    fields: [
      { key: "name", label: "卷名", type: "text", required: true },
      { key: "volumeNumber", label: "卷号", type: "number", required: true },
      { key: "chapters", label: "章节范围", type: "text", required: false, helpText: "如：1-50" },
      { key: "keyEvents", label: "关键事件", type: "textarea", required: false },
      { key: "goal", label: "本卷目标", type: "textarea", required: true },
    ],
  },
  {
    id: "relationship",
    name: "人物关系",
    icon: "heart-handshake",
    color: "pink",
    defaultVisibility: "tracked",
    fields: [
      { key: "sourceName", label: "角色A", type: "relation", required: true },
      { key: "targetName", label: "角色B", type: "relation", required: true },
      { key: "relationType", label: "关系类型", type: "select", required: true, options: ["师徒", "父子", "兄弟", "情侣", "仇敌", "盟友", "主仆", "同门", "其他"] },
      { key: "description", label: "关系描述", type: "textarea", required: false },
      { key: "since", label: "起始章节", type: "chapter", required: false },
    ],
  },
  {
    id: "foreshadowing",
    name: "伏笔管理",
    icon: "eye",
    color: "indigo",
    defaultVisibility: "tracked",
    fields: [
      { key: "name", label: "伏笔名称", type: "text", required: true },
      { key: "plantedChapter", label: "埋设章节", type: "chapter", required: true },
      { key: "status", label: "状态", type: "select", required: true, options: ["已埋设", "部分揭示", "已回收", "已废弃"] },
      { key: "targetChapter", label: "目标回收章节", type: "chapter", required: false },
      { key: "description", label: "描述", type: "textarea", required: true },
    ],
  },
  {
    id: "plot",
    name: "情节脉络",
    icon: "git-branch",
    color: "cyan",
    defaultVisibility: "tracked",
    fields: [
      { key: "name", label: "情节名称", type: "text", required: true },
      { key: "type", label: "类型", type: "select", required: true, options: ["主线", "支线", "暗线", "感情线"] },
      { key: "startChapter", label: "起始章节", type: "chapter", required: false },
      { key: "endChapter", label: "结束章节", type: "chapter", required: false },
      { key: "description", label: "描述", type: "textarea", required: true },
      { key: "status", label: "状态", type: "select", required: true, options: ["进行中", "已完结", "已搁置"] },
    ],
  },
  {
    id: "timeline",
    name: "时间线",
    icon: "clock",
    color: "slate",
    defaultVisibility: "global",
    fields: [
      { key: "name", label: "事件名称", type: "text", required: true },
      { key: "date", label: "时间", type: "text", required: true, helpText: "故事内时间，如：太初历3021年" },
      { key: "chapter", label: "对应章节", type: "chapter", required: false },
      { key: "description", label: "描述", type: "textarea", required: false },
      { key: "participants", label: "参与者", type: "relation", required: false },
    ],
  },
  {
    id: "chapter-summary",
    name: "章节摘要",
    icon: "file-text",
    color: "stone",
    defaultVisibility: "nested",
    fields: [
      { key: "chapterNumber", label: "章节号", type: "number", required: true },
      { key: "title", label: "章节标题", type: "text", required: true },
      { key: "summary", label: "摘要", type: "textarea", required: true },
      { key: "wordCount", label: "字数", type: "number", required: false },
      { key: "pov", label: "视角", type: "text", required: false },
      { key: "keyEvents", label: "关键事件", type: "textarea", required: false },
    ],
  },
];

/**
 * Get a category schema by its ID.
 * Returns undefined if the category is not found.
 */
export function getCategorySchema(id: string): CategorySchema | undefined {
  return CATEGORY_SCHEMAS.find((schema) => schema.id === id);
}
