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

  it("缺少必需颜色时报出具体令牌名", () => {
    const model = parseDesignMd(designMd);
    const { "shuhan-dark-border": _removed, ...colors } = model.colors;
    expect(() => renderThemeCss({ ...model, colors })).toThrow(/shuhan-dark-border/);
  });

  it("拼错的令牌名不会被静默忽略", () => {
    const model = parseDesignMd(designMd);
    expect(() => renderThemeCss({ ...model, colors: { ...model.colors, "shuhan-primery": "#000000" } })).toThrow(/primery/);
  });

  it("未登记的字体会被拒绝，避免用了没打包的字体", () => {
    const model = parseDesignMd(designMd);
    const typography = { ...model.typography, prose: { ...model.typography.prose, fontFamily: "Comic Sans" } };
    expect(() => renderThemeCss({ ...model, typography })).toThrow(/Comic Sans/);
  });
});
