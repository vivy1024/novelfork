import { describe, expect, it } from "vitest";

import {
  SUPPORTED_PUBLISH_PLATFORMS,
  checkPlatformChapterTarget,
  getPlatformProfile,
  isSupportedPlatform,
  resolvePlatformProfile,
  resolvePublishPlatform,
} from "./platform-profile.js";

describe("resolvePublishPlatform", () => {
  it("maps product platform values to compliance platforms", () => {
    expect(resolvePublishPlatform({ platform: "tomato" })).toBe("fanqie");
    expect(resolvePublishPlatform({ platform: "qidian" })).toBe("qidian");
    expect(resolvePublishPlatform({ platform: "feilu" })).toBe("generic");
    expect(resolvePublishPlatform({ platform: "other" })).toBe("generic");
    expect(resolvePublishPlatform({ platform: "jjwxc" })).toBe("jjwxc");
  });

  it("prefers an explicit publishPlatform override", () => {
    expect(resolvePublishPlatform({ platform: "tomato", publishPlatform: "qidian" })).toBe("qidian");
  });

  it("falls back to generic for unknown values", () => {
    expect(resolvePublishPlatform({ platform: "unknown-site" })).toBe("generic");
    expect(resolvePublishPlatform({})).toBe("generic");
  });
});

describe("platform profiles", () => {
  it("covers every supported platform", () => {
    for (const platform of SUPPORTED_PUBLISH_PLATFORMS) {
      const profile = getPlatformProfile(platform);
      expect(profile.platform).toBe(platform);
      expect(profile.label.length).toBeGreaterThan(0);
      expect(profile.chapterWords.min).toBeLessThan(profile.chapterWords.max);
      expect(profile.notes.length).toBeGreaterThan(0);
    }
  });

  it("keeps qidian at zero AI tolerance and generic non-blocking", () => {
    expect(getPlatformProfile("qidian").aiRatioTolerance).toBe(0);
    expect(getPlatformProfile("qidian").blockOnSensitiveBlock).toBe(true);
    expect(getPlatformProfile("generic").blockOnSensitiveBlock).toBe(false);
  });

  it("resolves a profile straight from the book config", () => {
    expect(resolvePlatformProfile({ platform: "tomato" }).label).toBe("番茄小说");
  });

  it("validates platform strings", () => {
    expect(isSupportedPlatform("fanqie")).toBe(true);
    expect(isSupportedPlatform("tomato")).toBe(false);
    expect(isSupportedPlatform(7)).toBe(false);
  });
});

describe("checkPlatformChapterTarget", () => {
  const profile = getPlatformProfile("fanqie");

  it("flags targets below the platform minimum", () => {
    const result = checkPlatformChapterTarget({ profile, chapterWordCount: 800 });
    expect(result.status).toBe("below-min");
    expect(result.message).toContain("低于");
  });

  it("flags targets above the platform maximum", () => {
    const result = checkPlatformChapterTarget({ profile, chapterWordCount: 9000 });
    expect(result.status).toBe("above-max");
    expect(result.message).toContain("高于");
  });

  it("passes targets inside the window", () => {
    const result = checkPlatformChapterTarget({ profile, chapterWordCount: 2400 });
    expect(result.status).toBe("ok");
    expect(result.message).toBeUndefined();
  });
});
