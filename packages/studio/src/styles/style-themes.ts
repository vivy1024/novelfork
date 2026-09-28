/**
 * 书房主题的登记表。颜色、字体、圆角在仓库根的 DESIGN.md（生成 novelfork-themes.css），
 * 纹样在 novelfork-motifs.css；这里只登记有哪些主题、叫什么。
 */

export const STYLE_THEME_IDS = ["gaozhi", "shuhan", "yegeng"] as const;
export type StyleThemeId = (typeof STYLE_THEME_IDS)[number];
export const DEFAULT_STYLE_THEME: StyleThemeId = "gaozhi";

export interface StyleThemeMeta {
  readonly id: StyleThemeId;
  readonly label: string;
  readonly description: string;
}

export const STYLE_THEMES: readonly StyleThemeMeta[] = [
  { id: "gaozhi", label: "绿格稿纸", description: "方格稿纸的淡绿格线与墨绿主色，清爽耐看，适合日常码字。" },
  { id: "shuhan", label: "书函藏青", description: "藏青函套、米黄题签与金色点缀，庄重，适合做设定、理大纲。" },
  { id: "yegeng", label: "夜更烛光", description: "暖纸色与一盏烛光，稿面上方有柔光，适合夜里写。" },
];

export function isStyleThemeId(value: unknown): value is StyleThemeId {
  return typeof value === "string" && (STYLE_THEME_IDS as readonly string[]).includes(value);
}
