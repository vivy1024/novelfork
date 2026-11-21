/**
 * 书房主题的登记表。颜色、字体、圆角在仓库根的 DESIGN.md（生成 novelfork-themes.css），
 * 纹样在 novelfork-motifs.css；这里只登记有哪些主题、叫什么。
 */

export const STYLE_THEME_IDS = ["gaozhi", "shuhan", "yegeng", "zhusha", "ruyao"] as const;
export type StyleThemeId = (typeof STYLE_THEME_IDS)[number];
export const DEFAULT_STYLE_THEME: StyleThemeId = "gaozhi";

export interface StyleThemeMeta {
  readonly id: StyleThemeId;
  readonly label: string;
  readonly tag: string;
  readonly description: string;
}

export const STYLE_THEMES: readonly StyleThemeMeta[] = [
  { id: "gaozhi", label: "绿格稿纸", tag: "日常手稿", description: "方格稿纸的淡绿格线与墨绿主色，清爽耐看，适合日常码字。" },
  { id: "shuhan", label: "书函藏青", tag: "典籍装帧", description: "藏青函套侧栏、米黄题签与锐利方角，庄重沉静，适合理设定与大纲。" },
  { id: "yegeng", label: "夜更烛光", tag: "暖光长卷", description: "暖纸色与一盏柔烛晕光，圆润胶囊与柔和层次，适合深夜沉浸写作。" },
  { id: "zhusha", label: "朱砂印谱", tag: "宋刊雕版", description: "素宣底、墨鸦侧栏、朱砂印泥点缀与极锐切角，自带刊刻编辑部气场。" },
  { id: "ruyao", label: "天青汝窑", tag: "青瓷釉面", description: "雨过天青的冷玉色阶、温润大圆角与瓷釉高光卡片，通透现代。" },
];

export function isStyleThemeId(value: unknown): value is StyleThemeId {
  return typeof value === "string" && (STYLE_THEME_IDS as readonly string[]).includes(value);
}
