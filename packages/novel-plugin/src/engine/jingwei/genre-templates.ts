/**
 * genre-templates.ts — 题材自适应经纬模板
 *
 * 设计文档: .kiro/specs/jingwei-data-layer-unify/design.md 单元 2
 *
 * 核心思想：书的题材决定经纬复杂度。轻量爽文不被迫套修仙级框架。
 * 模板决定：建书时初始展开哪些经纬分类 + AI 丰富的约束范围。
 */

import { JINGWEI_CATEGORIES, type JingweiCategory } from "./unified-categories.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GenreComplexity = "light" | "medium" | "heavy";

export interface GenreTemplate {
  readonly id: string;
  readonly name: string;
  readonly complexity: GenreComplexity;
  /** 初始可见的顶层分类 */
  readonly visibleCategories: readonly JingweiCategory[];
  /** 展开子分类的顶层类（重度才展开） */
  readonly expandSubcategories: readonly JingweiCategory[];
  /** 建书时 AI 丰富的 prompt 约束（控制生成范围） */
  readonly enrichConstraints: string;
  /** 自动启用的预设 IDs */
  readonly presetIds: readonly string[];
}

// ---------------------------------------------------------------------------
// 三档默认模板
// ---------------------------------------------------------------------------

const LIGHT_TEMPLATE: GenreTemplate = {
  id: "light",
  name: "轻量设定",
  complexity: "light",
  visibleCategories: ["characters", "conflicts", "foreshadowing", "outline", "chapter-summaries"],
  expandSubcategories: [],
  enrichConstraints: "只生成：主角设定（性格+目标+金手指）+ 2-3个冲突对象（简要动机） + 主线方向（一句话）。不要生成世界观描述、力量体系、势力格局、地理设定。保持简洁，总计不超过 500 字。",
  presetIds: [],
};

const MEDIUM_TEMPLATE: GenreTemplate = {
  id: "medium",
  name: "中度设定",
  complexity: "medium",
  visibleCategories: ["characters", "conflicts", "foreshadowing", "outline", "chapter-summaries", "props", "world-model", "rules"],
  expandSubcategories: [],
  enrichConstraints: "生成：主角（性格+目标+金手指规则）+ 3-4个关键角色（各有独立动机）+ 系统/金手指的核心规则 + 主线+1-2支线方向 + 3个初始伏笔种子。世界观只需一段简述（50字内），不要展开地理/势力/历史。总计不超过 1200 字。",
  presetIds: [],
};

const HEAVY_TEMPLATE: GenreTemplate = {
  id: "heavy",
  name: "重度设定",
  complexity: "heavy",
  visibleCategories: JINGWEI_CATEGORIES.filter((c): c is JingweiCategory => c !== "unclassified"),
  expandSubcategories: ["props", "world-model"],
  enrichConstraints: "完整生成：世界观（地理/历史/社会结构）+ 力量体系（完整等级划分+突破条件+限制）+ 势力格局（2-3个主要势力+关系）+ 主角（完整人设+成长方向）+ 3-5个重要配角（各有独立动机和反击能力）+ 3-5个伏笔种子 + 第一卷大纲骨架（10章规划）。总计 2000-3000 字。",
  presetIds: [],
};

export const DEFAULT_TEMPLATES: Record<GenreComplexity, GenreTemplate> = {
  light: LIGHT_TEMPLATE,
  medium: MEDIUM_TEMPLATE,
  heavy: HEAVY_TEMPLATE,
};

// ---------------------------------------------------------------------------
// 题材 → 模板映射
// ---------------------------------------------------------------------------

const GENRE_COMPLEXITY_MAP: Record<string, GenreComplexity> = {
  // 轻量：设定简单、节奏快、打脸爽文
  "都市": "light",
  "职场": "light",
  "言情": "light",
  "赘婿": "light",
  "体育": "light",
  "轻小说": "light",
  "种田": "light",
  "官场": "light",
  // 中度：有系统/规则但世界观不重
  "系统流": "medium",
  "游戏": "medium",
  "无限流": "medium",
  "悬疑": "medium",
  "末日": "medium",
  "重生": "medium",
  "穿越": "medium",
  "灵异": "medium",
  // 重度：宏大世界观
  "玄幻": "heavy",
  "仙侠": "heavy",
  "修真": "heavy",
  "武侠": "heavy",
  "科幻": "heavy",
  "历史": "heavy",
  "克苏鲁": "heavy",
  "赛博朋克": "heavy",
  "诡秘": "heavy",
  "军事": "heavy",
  "同人": "medium",
};

/**
 * 根据题材获取经纬模板。未知题材回退 medium。
 */
export function getGenreTemplate(genre: string): GenreTemplate {
  const complexity = GENRE_COMPLEXITY_MAP[genre] ?? "medium";
  return DEFAULT_TEMPLATES[complexity];
}

/**
 * 获取题材的复杂度等级。未知题材回退 medium。
 */
export function getGenreComplexity(genre: string): GenreComplexity {
  return GENRE_COMPLEXITY_MAP[genre] ?? "medium";
}

/**
 * 判断给定分类在指定模板中是否可见。
 */
export function isCategoryVisibleInTemplate(category: JingweiCategory, template: GenreTemplate): boolean {
  return template.visibleCategories.includes(category);
}
