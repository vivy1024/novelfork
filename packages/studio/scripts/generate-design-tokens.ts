/**
 * 用法：pnpm --dir packages/studio run design:tokens
 * 读仓库根的 DESIGN.md，写 src/styles/novelfork-themes.css。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseDesignMd, renderThemeCss } from "./design-tokens";

const DESIGN_MD_PATH = resolve(import.meta.dirname, "../../../DESIGN.md");
const THEME_CSS_PATH = resolve(import.meta.dirname, "../src/styles/novelfork-themes.css");

const css = renderThemeCss(parseDesignMd(readFileSync(DESIGN_MD_PATH, "utf8")));
writeFileSync(THEME_CSS_PATH, css);
console.log(`已生成 ${THEME_CSS_PATH}`);
