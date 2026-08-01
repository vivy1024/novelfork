import { describe, it, expect } from "vitest";
import {
  JINGWEI_CATEGORIES,
  CATEGORY_META,
  CATEGORY_SUBCATEGORIES,
  LEGACY_CATEGORY_MAP,
  normalizeCategory,
  isValidCategory,
  type JingweiCategory,
} from "./unified-categories";

describe("unified-categories", () => {
  it("defines exactly 16 categories", () => {
    expect(JINGWEI_CATEGORIES).toHaveLength(16);
  });

  it("every category has matching metadata", () => {
    for (const cat of JINGWEI_CATEGORIES) {
      const meta = CATEGORY_META.find((m) => m.id === cat);
      expect(meta, `missing meta for ${cat}`).toBeDefined();
      expect(meta!.name.length).toBeGreaterThan(0);
      expect(meta!.recommendedWhen.length).toBeGreaterThan(0);
    }
  });

  it("LEGACY_CATEGORY_MAP covers all old UI 16-class values", () => {
    const oldUICategories = [
      "character", "event", "worldview", "power-system", "geography",
      "faction", "item", "skill", "currency", "special", "outline",
      "relationship", "foreshadowing", "plot", "timeline", "chapter-summary",
    ];
    for (const old of oldUICategories) {
      expect(LEGACY_CATEGORY_MAP[old], `missing mapping for "${old}"`).toBeDefined();
      expect(isValidCategory(LEGACY_CATEGORY_MAP[old].category)).toBe(true);
    }
  });

  it("LEGACY_CATEGORY_MAP covers all old read-model 15-class values", () => {
    const oldReadCategories = [
      "premise", "world-model", "characters", "relationships", "factions",
      "locations", "power-system", "timeline", "chapter-summaries",
      "foreshadowing", "conflicts", "props", "rules", "reference", "unclassified",
    ];
    for (const old of oldReadCategories) {
      expect(LEGACY_CATEGORY_MAP[old], `missing mapping for "${old}"`).toBeDefined();
    }
  });

  it("normalizeCategory maps old values correctly", () => {
    expect(normalizeCategory("character")).toEqual({ category: "characters" });
    expect(normalizeCategory("item")).toEqual({ category: "props", subcategory: "item" });
    expect(normalizeCategory("skill")).toEqual({ category: "props", subcategory: "skill" });
    expect(normalizeCategory("currency")).toEqual({ category: "props", subcategory: "currency" });
    expect(normalizeCategory("worldview")).toEqual({ category: "world-model" });
    expect(normalizeCategory("special")).toEqual({ category: "world-model", subcategory: "special" });
    expect(normalizeCategory("plot")).toEqual({ category: "conflicts", subcategory: "plot" });
    expect(normalizeCategory("event")).toEqual({ category: "conflicts", subcategory: "event" });
  });

  it("normalizeCategory passes through valid unified values", () => {
    for (const cat of JINGWEI_CATEGORIES) {
      const result = normalizeCategory(cat);
      expect(result.category).toBe(cat);
    }
  });

  it("normalizeCategory falls back to unclassified for unknown values", () => {
    expect(normalizeCategory("unknown-thing")).toEqual({ category: "unclassified" });
    expect(normalizeCategory("")).toEqual({ category: "unclassified" });
    expect(normalizeCategory("gibberish")).toEqual({ category: "unclassified" });
  });

  it("isValidCategory validates correctly", () => {
    expect(isValidCategory("characters")).toBe(true);
    expect(isValidCategory("premise")).toBe(true);
    expect(isValidCategory("character")).toBe(false); // old value
    expect(isValidCategory("unknown")).toBe(false);
  });

  it("no duplicate categories", () => {
    const unique = new Set(JINGWEI_CATEGORIES);
    expect(unique.size).toBe(JINGWEI_CATEGORIES.length);
  });

  it("subcategory mappings reference valid parent categories", () => {
    for (const [parent, subs] of Object.entries(CATEGORY_SUBCATEGORIES)) {
      expect(isValidCategory(parent), `subcategory parent "${parent}" is not a valid category`).toBe(true);
      expect(Array.isArray(subs)).toBe(true);
    }
  });
});
