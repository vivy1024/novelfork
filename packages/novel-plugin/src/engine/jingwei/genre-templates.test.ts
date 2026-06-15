import { describe, it, expect } from "vitest";
import {
  getGenreTemplate,
  getGenreComplexity,
  isCategoryVisibleInTemplate,
  DEFAULT_TEMPLATES,
} from "./genre-templates";
import { JINGWEI_CATEGORIES } from "./unified-categories";

describe("genre-templates", () => {
  it("light template has exactly 5 visible categories", () => {
    expect(DEFAULT_TEMPLATES.light.visibleCategories).toHaveLength(5);
    expect(DEFAULT_TEMPLATES.light.visibleCategories).toContain("characters");
    expect(DEFAULT_TEMPLATES.light.visibleCategories).toContain("conflicts");
    expect(DEFAULT_TEMPLATES.light.visibleCategories).toContain("foreshadowing");
    expect(DEFAULT_TEMPLATES.light.visibleCategories).not.toContain("power-system");
    expect(DEFAULT_TEMPLATES.light.visibleCategories).not.toContain("world-model");
  });

  it("heavy template includes almost all categories (except unclassified)", () => {
    const heavyVisible = DEFAULT_TEMPLATES.heavy.visibleCategories;
    expect(heavyVisible).not.toContain("unclassified");
    expect(heavyVisible.length).toBe(JINGWEI_CATEGORIES.length - 1);
  });

  it("heavy template expands subcategories for props and world-model", () => {
    expect(DEFAULT_TEMPLATES.heavy.expandSubcategories).toContain("props");
    expect(DEFAULT_TEMPLATES.heavy.expandSubcategories).toContain("world-model");
  });

  it("getGenreTemplate maps light genres correctly", () => {
    expect(getGenreTemplate("都市").complexity).toBe("light");
    expect(getGenreTemplate("言情").complexity).toBe("light");
    expect(getGenreTemplate("赘婿").complexity).toBe("light");
  });

  it("getGenreTemplate maps medium genres correctly", () => {
    expect(getGenreTemplate("系统流").complexity).toBe("medium");
    expect(getGenreTemplate("悬疑").complexity).toBe("medium");
    expect(getGenreTemplate("无限流").complexity).toBe("medium");
  });

  it("getGenreTemplate maps heavy genres correctly", () => {
    expect(getGenreTemplate("玄幻").complexity).toBe("heavy");
    expect(getGenreTemplate("修真").complexity).toBe("heavy");
    expect(getGenreTemplate("科幻").complexity).toBe("heavy");
  });

  it("getGenreTemplate falls back to medium for unknown genres", () => {
    expect(getGenreTemplate("完全未知的题材").complexity).toBe("medium");
    expect(getGenreTemplate("").complexity).toBe("medium");
  });

  it("getGenreComplexity returns correct complexity", () => {
    expect(getGenreComplexity("都市")).toBe("light");
    expect(getGenreComplexity("仙侠")).toBe("heavy");
    expect(getGenreComplexity("unknown")).toBe("medium");
  });

  it("isCategoryVisibleInTemplate works correctly", () => {
    const light = DEFAULT_TEMPLATES.light;
    expect(isCategoryVisibleInTemplate("characters", light)).toBe(true);
    expect(isCategoryVisibleInTemplate("power-system", light)).toBe(false);
    expect(isCategoryVisibleInTemplate("world-model", light)).toBe(false);

    const heavy = DEFAULT_TEMPLATES.heavy;
    expect(isCategoryVisibleInTemplate("power-system", heavy)).toBe(true);
    expect(isCategoryVisibleInTemplate("world-model", heavy)).toBe(true);
  });

  it("enrichConstraints differ by complexity", () => {
    expect(DEFAULT_TEMPLATES.light.enrichConstraints).toContain("不要生成世界观");
    expect(DEFAULT_TEMPLATES.heavy.enrichConstraints).toContain("完整生成");
    expect(DEFAULT_TEMPLATES.medium.enrichConstraints).toContain("世界观只需一段简述");
  });
});
