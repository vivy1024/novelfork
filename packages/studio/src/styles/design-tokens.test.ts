import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseDesignMd, renderThemeCss } from "../../scripts/design-tokens";
import { STYLE_THEME_IDS } from "./style-themes";

// Windows 检出时 Git 可能把换行转成 CRLF，比较前统一成 LF。
const readText = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const designMd = readText(resolve(__dirname, "../../../../DESIGN.md"));
const themeCss = readText(resolve(__dirname, "novelfork-themes.css"));
const motifCss = readFileSync(resolve(__dirname, "novelfork-motifs.css"), "utf8");

describe("书房主题令牌", () => {
  it("生成的 CSS 与 DESIGN.md 一致（改了 DESIGN.md 要重新运行 design:tokens）", () => {
    expect(themeCss).toBe(renderThemeCss(parseDesignMd(designMd)));
  });

  it("每个登记的主题都有浅色、深色令牌和纹样", () => {
    for (const id of STYLE_THEME_IDS) {
      expect(themeCss).toContain(`[data-nf-theme-preview="${id}"] {`);
      expect(themeCss).toContain(`.dark [data-nf-theme-preview="${id}"] {`);
      expect(motifCss).toContain(`[data-nf-theme-preview="${id}"] {`);
    }
  });

  it("默认主题的页面标题用思源宋体，站酷小薇只留给书封题签", () => {
    const defaultBlock = /\/\* gaozhi · 浅色 \*\/[\s\S]*?\n\}/.exec(themeCss)?.[0] ?? "";
    expect(defaultBlock).toMatch(/--font-display: "Noto Serif SC Variable"/);
    expect(defaultBlock).not.toMatch(/--font-display: "ZCOOL XiaoWei"/);
    expect(defaultBlock).toMatch(/--font-cover: "ZCOOL XiaoWei"/);
    // 其他主题的书封继续沿用自己的标题字体
    expect(themeCss).toMatch(/--font-cover: "Noto Serif SC Variable"/);
    // 书封题签读 --font-cover，页面标题读 --font-display
    expect(motifCss).toMatch(/\.nf-book-cover__slip \{[^}]*font-family: var\(--font-cover\)/);
  });

  it("状态色（warning / success / info）在每个主题、每种明暗下都有，且在卡片与底色上达到 WCAG AA 4.5:1", () => {
    const model = parseDesignMd(designMd);
    const lum = (hex: string) => {
      const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const prefixes = ["", "dark-", "shuhan-", "shuhan-dark-", "yegeng-", "yegeng-dark-"];
    for (const prefix of prefixes) {
      for (const status of ["warning", "success", "info"]) {
        const color = model.colors[`${prefix}${status}`];
        expect(color, `${prefix}${status}`).toMatch(/^#[0-9a-f]{6}$/i);
        for (const surface of ["card", "background"]) {
          expect(contrast(color!, model.colors[`${prefix}${surface}`]!), `${prefix}${status} 在 ${surface} 上`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    for (const status of ["warning", "success", "info"]) expect(themeCss).toContain(`--${status}: `);
  });

  it("缺少必需颜色时报出具体令牌名", () => {
    const model = parseDesignMd(designMd);
    const { "shuhan-dark-border": _removed, ...colors } = model.colors;
    expect(() => renderThemeCss({ ...model, colors })).toThrow(/shuhan-dark-border/);
  });

  it("拼错的令牌名不会被静默忽略", () => {
    const model = parseDesignMd(designMd);
    expect(() => renderThemeCss({ ...model, colors: { ...model.colors, "shuhan-primery": "#000000" } })).toThrow(/primery/);
  });

  it("界面字号阶梯由 DESIGN.md 生成：5 档，最小一档不低于 11px", () => {
    const steps = ["2xs", "xs", "sm", "base", "lg"];
    for (const step of steps) {
      expect(themeCss).toMatch(new RegExp(`--text-${step}: [0-9.]+px;`));
      expect(themeCss).toMatch(new RegExp(`--text-${step}--line-height: [0-9.]+;`));
    }
    const px = (step: string) => Number(new RegExp(`--text-${step}: ([0-9.]+)px;`).exec(themeCss)?.[1]);
    expect(px("2xs")).toBeGreaterThanOrEqual(11);
    // 逐档递增
    for (let i = 1; i < steps.length; i += 1) expect(px(steps[i]!)).toBeGreaterThan(px(steps[i - 1]!));
  });

  it("缺少字号阶梯中的某一档时报出具体令牌名", () => {
    const model = parseDesignMd(designMd);
    const { "scale-sm": _removed, ...typography } = model.typography;
    expect(() => renderThemeCss({ ...model, typography })).toThrow(/scale-sm/);
  });

  it("未登记的字体会被拒绝，避免用了没打包的字体", () => {
    const model = parseDesignMd(designMd);
    const typography = { ...model.typography, prose: { ...model.typography.prose, fontFamily: "Comic Sans" } };
    expect(() => renderThemeCss({ ...model, typography })).toThrow(/Comic Sans/);
  });
});
