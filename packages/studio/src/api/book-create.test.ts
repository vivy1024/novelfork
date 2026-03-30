import { describe, expect, it } from "vitest";
import { buildStudioBookConfig, normalizeStudioPlatform } from "./book-create";

describe("normalizeStudioPlatform", () => {
  it("keeps supported chinese platform ids and folds unsupported values to other", () => {
    expect(normalizeStudioPlatform("tomato")).toBe("tomato");
    expect(normalizeStudioPlatform("qidian")).toBe("qidian");
    expect(normalizeStudioPlatform("feilu")).toBe("feilu");
    expect(normalizeStudioPlatform("royal-road")).toBe("other");
    expect(normalizeStudioPlatform(undefined)).toBe("other");
  });
});

describe("buildStudioBookConfig", () => {
  it("preserves supported platform selections from studio create requests", () => {
    const config = buildStudioBookConfig(
      {
        title: "测试书",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        chapterWordCount: 2500,
        targetChapters: 120,
      },
      "2026-03-30T00:00:00.000Z",
    );

    expect(config).toMatchObject({
      title: "测试书",
      genre: "xuanhuan",
      platform: "qidian",
      language: "zh",
      chapterWordCount: 2500,
      targetChapters: 120,
    });
  });

  it("normalizes unsupported platform ids to other for storage", () => {
    const config = buildStudioBookConfig(
      {
        title: "English Book",
        genre: "other",
        platform: "royal-road",
        language: "en",
      },
      "2026-03-30T00:00:00.000Z",
    );

    expect(config.platform).toBe("other");
    expect(config.language).toBe("en");
    expect(config.id).toBe("english-book");
  });
});
