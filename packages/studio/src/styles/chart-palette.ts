/**
 * 分类色：图表、画布、关系图区分剧情线 / 泳道 / 数据系列用。
 * 值在仓库根 DESIGN.md 的 colors.chart-1 … chart-8（每个主题、每种明暗各一组），生成为 --chart-N。
 * 绘图组件只拿 var(--chart-N)，切换主题或明暗时浏览器直接换色，不需要重渲染。
 */

export const CHART_COLOR_COUNT = 8;

/** 第 index 个分类色（从 0 起，超出时循环）。 */
export function chartColor(index: number): string {
  const slot = ((Math.trunc(index) % CHART_COLOR_COUNT) + CHART_COLOR_COUNT) % CHART_COLOR_COUNT;
  return `var(--chart-${slot + 1})`;
}

/** 全部分类色，按序号排列。 */
export const CHART_COLORS: readonly string[] = Array.from({ length: CHART_COLOR_COUNT }, (_, index) => chartColor(index));

/**
 * 给令牌色叠透明度（令牌是完整色值，不能在后面拼 alpha 十六进制）。
 * percent 为 0–100。
 */
export function withAlpha(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
