import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CATEGORY_META } from "../../engine/jingwei/unified-categories";
import {
  CATEGORY_COLOR_TONE,
  CATEGORY_TONE_BADGE_CLASSES,
  RESOURCE_TYPE_TONE,
  categoryTone,
  toneBadgeClass,
  toneIconClass,
  toneSoftBgClass,
} from "./category-tones";

const NATIVE_PALETTE = /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b/;

describe("分类 → 设计令牌映射", () => {
  it("每个经纬分类的 color 都映射到分类色槽位或中性色，不落空", () => {
    for (const meta of CATEGORY_META) {
      expect(Object.prototype.hasOwnProperty.call(CATEGORY_COLOR_TONE, meta.color), `${meta.id}: ${meta.color}`).toBe(true);
    }
  });

  it("徽标、图标、浅铺底只用令牌类名，不用 Tailwind 原生色系", () => {
    for (const tone of Object.keys(CATEGORY_TONE_BADGE_CLASSES) as Array<keyof typeof CATEGORY_TONE_BADGE_CLASSES>) {
      for (const className of [toneBadgeClass(tone), toneIconClass(tone), toneSoftBgClass(tone)]) {
        expect(className).not.toMatch(NATIVE_PALETTE);
        expect(className).toMatch(/chart-[1-8]|muted/);
      }
    }
  });

  it("未知或缺失的颜色名回落到中性色", () => {
    expect(categoryTone(undefined)).toBe("neutral");
    expect(categoryTone("magenta")).toBe("neutral");
    expect(categoryTone("blue")).toBe("chart-2");
  });

  it("资源类型都指向分类色槽位", () => {
    for (const tone of Object.values(RESOURCE_TYPE_TONE)) expect(tone).toMatch(/^chart-[1-8]$/);
  });

  it("文件树、页签、设定卡片等已改用映射：源码里不再有原生色系", () => {
    const files = [
      "WorkbenchResourceTree.tsx",
      "ide/EditorTabs.tsx",
      "resource-viewers/index.tsx",
      "SceneSpecPanel.tsx",
      "JingweiEmptyState.tsx",
      "WorkbenchCanvas.tsx",
    ];
    for (const file of files) {
      expect(readFileSync(resolve(__dirname, file), "utf8"), file).not.toMatch(NATIVE_PALETTE);
    }
  });
});
