/**
 * 从仓库根的 DESIGN.md 生成 Studio 的主题令牌 CSS。
 *
 * DESIGN.md 是颜色、字体、圆角的唯一权威源（格式见 https://github.com/google-labs-code/design.md）；
 * 生成的 CSS 只是导出物。这里只放纯函数，读写文件在 generate-design-tokens.ts，
 * 测试用同一套函数检查生成物与 DESIGN.md 是否一致。
 */

import yaml from "js-yaml";
import { DEFAULT_STYLE_THEME, type StyleThemeId } from "../src/styles/style-themes";

type Mode = "light" | "dark";

interface Variant {
  readonly theme: StyleThemeId;
  readonly mode: Mode;
  /** DESIGN.md 里这一组颜色令牌的名称前缀。 */
  readonly prefix: string;
}

/** 默认主题的浅色不带前缀，其余按「主题-」「dark-」叠加。顺序即输出顺序，决定同优先级时的覆盖关系。 */
const VARIANTS: readonly Variant[] = [
  { theme: "gaozhi", mode: "light", prefix: "" },
  { theme: "gaozhi", mode: "dark", prefix: "dark-" },
  { theme: "shuhan", mode: "light", prefix: "shuhan-" },
  { theme: "shuhan", mode: "dark", prefix: "shuhan-dark-" },
  { theme: "yegeng", mode: "light", prefix: "yegeng-" },
  { theme: "yegeng", mode: "dark", prefix: "yegeng-dark-" },
];

/** 每个主题、每种明暗都必须给出的颜色（对应 Studio 的同名 CSS 变量）。 */
const REQUIRED_COLORS = [
  "background",
  "foreground",
  "card",
  "primary",
  "primary-foreground",
  "secondary",
  "muted",
  "muted-foreground",
  "accent",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "paper",
] as const;

/** 可省略的颜色：省略时取右边的令牌。 */
const DERIVED_COLORS: Readonly<Record<string, string>> = {
  "card-foreground": "foreground",
  popover: "card",
  "popover-foreground": "foreground",
  "secondary-foreground": "foreground",
  "accent-foreground": "foreground",
  ring: "primary",
};

/** 主题纹样用到的颜色，生成为 --nf-*；只有用到它的主题才需要给出。 */
const MOTIF_COLORS = new Set([
  "paper",
  "grid",
  "rail",
  "rail-ink",
  "rail-muted",
  "rail-line",
  "rail-hover",
  "slip",
  "slip-edge",
  "slip-ink",
  "highlight",
  "glow",
]);

/** DESIGN.md 里的字体名 → 完整字体栈。打包的字体用 fontsource 的变量字体名。 */
const FONT_STACKS: Readonly<Record<string, string>> = {
  "System Sans":
    'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif',
  "Noto Serif SC":
    '"Noto Serif SC Variable", "Noto Serif SC", "Source Han Serif SC", "Songti SC", STSong, serif',
  "ZCOOL XiaoWei": '"ZCOOL XiaoWei", "Noto Serif SC Variable", "Songti SC", STSong, serif',
  "JetBrains Mono": '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
};

interface TypographyToken {
  readonly fontFamily: string;
  readonly fontSize?: string;
  readonly fontWeight?: number | string;
  readonly lineHeight?: number | string;
  readonly letterSpacing?: string;
}

export interface DesignModel {
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, TypographyToken>>;
  readonly rounded: Readonly<Record<string, string>>;
}

export function parseDesignMd(source: string): DesignModel {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) throw new Error("DESIGN.md 缺少 YAML 前言（--- … ---）");
  const data = yaml.load(match[1]) as Partial<Record<keyof DesignModel, unknown>> | null;
  if (!data || typeof data !== "object") throw new Error("DESIGN.md 的 YAML 前言为空");
  return {
    colors: (data.colors ?? {}) as Record<string, string>,
    typography: (data.typography ?? {}) as Record<string, TypographyToken>,
    rounded: (data.rounded ?? {}) as Record<string, string>,
  };
}

/** 颜色令牌名前缀最长的变体优先匹配（shuhan-dark- 先于 shuhan-）。 */
function variantOfColor(key: string): { variant: Variant; name: string } {
  const candidates = [...VARIANTS].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const variant of candidates) {
    if (variant.prefix && key.startsWith(variant.prefix)) return { variant, name: key.slice(variant.prefix.length) };
  }
  return { variant: VARIANTS[0], name: key };
}

function variantColors(model: DesignModel): Map<Variant, Map<string, string>> {
  const byVariant = new Map<Variant, Map<string, string>>(VARIANTS.map((variant) => [variant, new Map()]));
  const known = new Set<string>([...REQUIRED_COLORS, ...Object.keys(DERIVED_COLORS), ...MOTIF_COLORS]);
  for (const [key, value] of Object.entries(model.colors)) {
    const { variant, name } = variantOfColor(key);
    if (!known.has(name)) throw new Error(`DESIGN.md 颜色令牌「${key}」无法识别：「${name}」不是已知的令牌名`);
    byVariant.get(variant)!.set(name, String(value));
  }
  for (const [variant, colors] of byVariant) {
    const missing = REQUIRED_COLORS.filter((name) => !colors.has(name));
    if (missing.length > 0) {
      throw new Error(`DESIGN.md 缺少 ${variant.theme}/${variant.mode} 的颜色：${missing.map((name) => variant.prefix + name).join("、")}`);
    }
    for (const [name, source] of Object.entries(DERIVED_COLORS)) {
      if (!colors.has(name)) colors.set(name, colors.get(source)!);
    }
  }
  return byVariant;
}

function fontStack(family: string, where: string): string {
  const stack = FONT_STACKS[family];
  if (!stack) throw new Error(`DESIGN.md 的 ${where} 用了未登记的字体「${family}」，请先在 FONT_STACKS 里登记字体栈并打包字体`);
  return stack;
}

function typographyToken(model: DesignModel, key: string): TypographyToken {
  const token = model.typography[key];
  if (!token?.fontFamily) throw new Error(`DESIGN.md 缺少排版令牌 typography.${key}`);
  return token;
}

function roundedToken(model: DesignModel, key: string): string {
  const value = model.rounded[key];
  if (!value) throw new Error(`DESIGN.md 缺少圆角令牌 rounded.${key}`);
  return value;
}

function themePrefix(theme: StyleThemeId): string {
  return theme === DEFAULT_STYLE_THEME ? "" : `${theme}-`;
}

/**
 * 选择器约定：
 * - 当前主题挂在 <html data-nf-style="…">，明暗沿用 <html class="dark">；默认主题不依赖该属性。
 * - [data-nf-theme-preview="…"] 让设置页的预览卡片就地呈现另一套主题。
 * 同一主题里深色选择器的优先级总比浅色高一级，所以每组令牌都必须完整（生成时已校验）。
 */
function selectorFor(variant: Variant): string {
  const preview = `[data-nf-theme-preview="${variant.theme}"]`;
  const root = variant.theme === DEFAULT_STYLE_THEME ? ":root" : `:root[data-nf-style="${variant.theme}"]`;
  if (variant.mode === "light") return `${root},\n${preview}`;
  const darkRoot = variant.theme === DEFAULT_STYLE_THEME ? ":root.dark" : `:root.dark[data-nf-style="${variant.theme}"]`;
  return `${darkRoot},\n.dark ${preview}`;
}

function declarations(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries.map(([name, value]) => `  ${name}: ${value};`).join("\n");
}

function colorDeclarations(colors: Map<string, string>): Array<[string, string]> {
  const order = [...REQUIRED_COLORS, ...Object.keys(DERIVED_COLORS)];
  const core = order
    .filter((name) => !MOTIF_COLORS.has(name))
    .map((name): [string, string] => [`--${name}`, colors.get(name)!]);
  const motifs = [...MOTIF_COLORS]
    .filter((name) => colors.has(name))
    .map((name): [string, string] => [`--nf-${name}`, colors.get(name)!]);
  return [...core, ...motifs];
}

function themeTypeDeclarations(model: DesignModel, theme: StyleThemeId): Array<[string, string]> {
  const prefix = themePrefix(theme);
  const display = typographyToken(model, `${prefix}headline-display`);
  const prose = typographyToken(model, `${prefix}prose`);
  return [
    ["--font-display", fontStack(display.fontFamily, `typography.${prefix}headline-display`)],
    ["--font-display-weight", String(display.fontWeight ?? 400)],
    ["--font-display-tracking", display.letterSpacing ?? "0"],
    ["--display-line-height", String(display.lineHeight ?? 1.25)],
    ["--font-serif", fontStack(prose.fontFamily, `typography.${prefix}prose`)],
    ["--font-prose", "var(--font-serif)"],
    ["--font-prose-weight", String(prose.fontWeight ?? 400)],
    ["--prose-size", prose.fontSize ?? "16px"],
    ["--prose-line-height", String(prose.lineHeight ?? 1.9)],
    ["--radius-sm", roundedToken(model, `${prefix}sm`)],
    ["--radius-md", roundedToken(model, `${prefix}md`)],
    ["--radius-lg", roundedToken(model, `${prefix}lg`)],
    ["--radius", "var(--radius-md)"],
  ];
}

export function renderThemeCss(model: DesignModel): string {
  const colorsByVariant = variantColors(model);
  const body = typographyToken(model, "body-md");
  const code = typographyToken(model, "code");
  const blocks: string[] = [
    [
      "/*",
      "  NovelFork 书房主题令牌——由 packages/studio/scripts/generate-design-tokens.ts 从仓库根的 DESIGN.md 生成。",
      "  勿手改：改 DESIGN.md 后运行 `pnpm --dir packages/studio run design:tokens`。",
      "*/",
    ].join("\n"),
  ];
  for (const variant of VARIANTS) {
    const entries: Array<[string, string]> = [];
    if (variant.mode === "light") {
      if (variant.theme === DEFAULT_STYLE_THEME) {
        entries.push(
          ["--font-sans", fontStack(body.fontFamily, "typography.body-md")],
          ["--font-mono", fontStack(code.fontFamily, "typography.code")],
        );
      }
      entries.push(...themeTypeDeclarations(model, variant.theme));
    }
    entries.push(...colorDeclarations(colorsByVariant.get(variant)!));
    blocks.push(`/* ${variant.theme} · ${variant.mode === "light" ? "浅色" : "深色"} */\n${selectorFor(variant)} {\n${declarations(entries)}\n}`);
  }
  return `${blocks.join("\n\n")}\n`;
}
