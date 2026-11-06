/**
 * 分类 → 设计令牌的唯一映射：经纬分类徽标、文件树与编辑器页签的类型图标都从这里取色。
 *
 * 颜色只读 DESIGN.md 的分类色 chart-1…8（每套书房主题、每种明暗各一组，生成为 --chart-N），
 * 不写 Tailwind 原生色系——原生色不随主题与明暗切换，深色下会看不清。
 *
 * - 图标（非文字图形，WCAG 1.4.11 要求 ≥3:1）直接用 chart-N；DESIGN.md 测试保证它在卡片与底色上 ≥3:1。
 * - 徽标文字（WCAG 1.4.3 要求 ≥4.5:1）用 chart-N 与前景色按 CATEGORY_TONE_INK_PERCENT 混合，
 *   底是 chart-N 的 10% 浅铺；studio 的 design-tokens 测试逐主题逐明暗核对这组组合的对比度。
 *
 * Tailwind 只认源码里完整出现的类名，下面的类名逐个写全，不要改成字符串拼接。
 */

export type CategoryTone = "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "chart-6" | "chart-7" | "chart-8" | "neutral";

/** 徽标文字中分类色所占比例（其余是前景色）。改它要同步下面的 ink 类名，测试会核对。 */
export const CATEGORY_TONE_INK_PERCENT = 65;

/**
 * 经纬分类 color 名（unified-categories 的 CATEGORY_META.color）→ 分类色槽位。
 * 默认主题下 chart-1 绿 / 2 蓝 / 3 洋红 / 4 琥珀 / 5 紫 / 6 青 / 7 朱红 / 8 赭；其他主题按各自色板换色。
 */
export const CATEGORY_COLOR_TONE: Readonly<Record<string, CategoryTone>> = {
  green: "chart-1",
  emerald: "chart-1",
  blue: "chart-2",
  pink: "chart-3",
  rose: "chart-3",
  amber: "chart-4",
  yellow: "chart-4",
  orange: "chart-4",
  purple: "chart-5",
  violet: "chart-5",
  indigo: "chart-5",
  sky: "chart-6",
  cyan: "chart-6",
  teal: "chart-6",
  red: "chart-7",
  stone: "chart-8",
  slate: "neutral",
  gray: "neutral",
};

/** 徽标：浅铺底 + 加深的分类色文字。 */
const TONE_BADGE_CLASS: Readonly<Record<CategoryTone, string>> = {
  "chart-1": "bg-chart-1/10 text-[color:color-mix(in_srgb,var(--chart-1)_65%,var(--foreground))]",
  "chart-2": "bg-chart-2/10 text-[color:color-mix(in_srgb,var(--chart-2)_65%,var(--foreground))]",
  "chart-3": "bg-chart-3/10 text-[color:color-mix(in_srgb,var(--chart-3)_65%,var(--foreground))]",
  "chart-4": "bg-chart-4/10 text-[color:color-mix(in_srgb,var(--chart-4)_65%,var(--foreground))]",
  "chart-5": "bg-chart-5/10 text-[color:color-mix(in_srgb,var(--chart-5)_65%,var(--foreground))]",
  "chart-6": "bg-chart-6/10 text-[color:color-mix(in_srgb,var(--chart-6)_65%,var(--foreground))]",
  "chart-7": "bg-chart-7/10 text-[color:color-mix(in_srgb,var(--chart-7)_65%,var(--foreground))]",
  "chart-8": "bg-chart-8/10 text-[color:color-mix(in_srgb,var(--chart-8)_65%,var(--foreground))]",
  neutral: "bg-muted text-muted-foreground",
};

/** 图标：分类色本色。 */
const TONE_ICON_CLASS: Readonly<Record<CategoryTone, string>> = {
  "chart-1": "text-chart-1",
  "chart-2": "text-chart-2",
  "chart-3": "text-chart-3",
  "chart-4": "text-chart-4",
  "chart-5": "text-chart-5",
  "chart-6": "text-chart-6",
  "chart-7": "text-chart-7",
  "chart-8": "text-chart-8",
  neutral: "text-muted-foreground",
};

/** 图标浅铺底（空状态的圆形图标座等）。 */
const TONE_SOFT_BG_CLASS: Readonly<Record<CategoryTone, string>> = {
  "chart-1": "bg-chart-1/10",
  "chart-2": "bg-chart-2/10",
  "chart-3": "bg-chart-3/10",
  "chart-4": "bg-chart-4/10",
  "chart-5": "bg-chart-5/10",
  "chart-6": "bg-chart-6/10",
  "chart-7": "bg-chart-7/10",
  "chart-8": "bg-chart-8/10",
  neutral: "bg-muted",
};

/**
 * 工作台里非经纬分类的资源类型 → 分类色。文件树节点、编辑器页签图标、空状态共用，
 * 同一种资源在各处颜色一致。
 */
export const RESOURCE_TYPE_TONE = {
  /** 设定条目 / 设定分组（经纬） */
  jingwei: "chart-6",
  /** 叙事线 */
  narrativeLine: "chart-3",
  /** 分析工具与工具分组 */
  tool: "chart-5",
  /** 叙事记忆条目 */
  memory: "chart-3",
  /** 设定条目页签 */
  jingweiEntryTab: "chart-5",
  /** 场景规格里的冲突 / 情感 */
  conflict: "chart-4",
  emotion: "chart-3",
  /** 画布里的写作稿 */
  draft: "chart-5",
} as const satisfies Record<string, CategoryTone>;

export function categoryTone(colorName: string | undefined): CategoryTone {
  return (colorName && CATEGORY_COLOR_TONE[colorName]) || "neutral";
}

export function toneBadgeClass(tone: CategoryTone): string {
  return TONE_BADGE_CLASS[tone];
}

export function toneIconClass(tone: CategoryTone): string {
  return TONE_ICON_CLASS[tone];
}

export function toneSoftBgClass(tone: CategoryTone): string {
  return TONE_SOFT_BG_CLASS[tone];
}

/** 全部徽标类名，供测试核对比例与令牌引用。 */
export const CATEGORY_TONE_BADGE_CLASSES: Readonly<Record<CategoryTone, string>> = TONE_BADGE_CLASS;
