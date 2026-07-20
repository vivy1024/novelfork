import { describe, expect, it } from "vitest";
import {
  getLocaleFallbackChain,
  normalizeLocale,
  pickLocalizedValue,
} from "../i18n/locales.js";

describe("shared locale definitions", () => {
  it("normalizes supported aliases without treating unknown values as supported", () => {
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh_Hans_CN")).toBe("zh-CN");
    expect(normalizeLocale("EN-us")).toBe("en");
    expect(normalizeLocale("fr-FR", "zh-CN")).toBe("zh-CN");
  });

  it("uses the declared fallback chain for localized values", () => {
    expect(getLocaleFallbackChain("zh-CN")).toEqual(["zh-CN", "en"]);
    expect(pickLocalizedValue({ en: "English" }, "zh")).toBe("English");
    expect(pickLocalizedValue({ en: "English", "zh-CN": "中文" }, "zh-Hans")).toBe("中文");
  });
});
