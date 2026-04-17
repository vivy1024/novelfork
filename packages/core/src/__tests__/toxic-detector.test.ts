/**
 * Tests for toxic-detector.ts — deterministic poison point detection.
 */

import { describe, it, expect } from "vitest";
import { detectToxicPatterns, type ToxicDetectionContext } from "../utils/toxic-detector.js";

describe("detectToxicPatterns", () => {
  const baseContext: ToxicDetectionContext = {
    content: "",
    chapterNumber: 10,
    recentSummaries: [],
    isVolume1: false,
    language: "zh",
  };

  it("TX-001: 主角憋屈无后手 - should detect humiliation without payback", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      content: "李明被王家少爷扇了一巴掌，颜面尽失，只能低声下气地道歉。",
    };

    const result = detectToxicPatterns(ctx);

    expect(result.violations.length).toBeGreaterThan(0);
    const violation = result.violations.find((v) => v.rule.includes("TX-001"));
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("error");
    expect(violation?.description).toContain("屈辱");
  });

  it("TX-001: should NOT detect when payback is setup", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      content:
        "李明被王家少爷扇了一巴掌，颜面尽失。他暗暗发誓，总有一天要让王家付出代价。",
    };

    const result = detectToxicPatterns(ctx);

    const violation = result.violations.find((v) => v.rule.includes("TX-001"));
    expect(violation).toBeUndefined();
  });

  it("TX-002: 第一卷设定崩坏 - should detect contradictions in volume 1", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      chapterNumber: 5,
      isVolume1: true,
      content: "之前说过筑基期才能飞行，可是现在炼气期的张三却飞了起来。",
    };

    const result = detectToxicPatterns(ctx);

    expect(result.violations.length).toBeGreaterThan(0);
    const violation = result.violations.find((v) => v.rule.includes("TX-002"));
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("error");
  });

  it("TX-002: should NOT detect in later volumes", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      chapterNumber: 50,
      isVolume1: false,
      content: "之前说过筑基期才能飞行，可是现在炼气期的张三却飞了起来。",
    };

    const result = detectToxicPatterns(ctx);

    const violation = result.violations.find((v) => v.rule.includes("TX-002"));
    expect(violation).toBeUndefined();
  });

  it("TX-003: 金手指失效 - should detect cheat negation", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      content: "李明的系统突然失效了，所有的能力都无法使用。",
    };

    const result = detectToxicPatterns(ctx);

    expect(result.violations.length).toBeGreaterThan(0);
    const violation = result.violations.find((v) => v.rule.includes("TX-003"));
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("error");
  });

  it("TX-004: 感情线强扭 - should detect forced romance", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      content: "李明第一次见到林雪，就一见钟情，情不自禁地吻了上去。",
    };

    const result = detectToxicPatterns(ctx);

    expect(result.violations.length).toBeGreaterThan(0);
    const violation = result.violations.find((v) => v.rule.includes("TX-004"));
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("warning");
  });

  it("TX-005: 水字数 - should detect word padding", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      content: "话说李明来到了城中。且说这城中热闹非凡。闲话少叙，不必多说。",
    };

    const result = detectToxicPatterns(ctx);

    expect(result.violations.length).toBeGreaterThan(0);
    const violation = result.violations.find((v) => v.rule.includes("TX-005"));
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("warning");
  });

  it("TX-006: 无脑降智推剧情 - should detect idiot plot", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      content: "李明明知道前面有埋伏，却还是走了进去，完全忘了带武器。",
    };

    const result = detectToxicPatterns(ctx);

    expect(result.violations.length).toBeGreaterThan(0);
    const violation = result.violations.find((v) => v.rule.includes("TX-006"));
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("warning");
  });

  it("TX-007: 断崖式节奏 - should detect pacing cliff", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      content: "李明回到家中，开始了平淡的日常生活。",
      recentSummaries: [
        { chapter: 7, mood: "紧张激烈", events: "大战", chapterType: "战斗" },
        { chapter: 8, mood: "高潮迭起", events: "决战", chapterType: "战斗" },
        { chapter: 9, mood: "危机四伏", events: "逃亡", chapterType: "冲突" },
      ],
    };

    const result = detectToxicPatterns(ctx);

    expect(result.violations.length).toBeGreaterThan(0);
    const violation = result.violations.find((v) => v.rule.includes("TX-007"));
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("warning");
  });

  it("should calculate severity score correctly", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      content:
        "李明被扇了一巴掌，颜面尽失。他的系统突然失效了。明明知道有埋伏却还是走了进去。",
    };

    const result = detectToxicPatterns(ctx);

    // 2 errors (30 each) + 1 warning (15) = 75
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("should return clean result for good content", () => {
    const ctx: ToxicDetectionContext = {
      ...baseContext,
      content:
        "李明来到城中，观察着周围的环境。他知道这次任务很危险，必须小心谨慎。经过一番思考，他决定先收集情报，再制定行动计划。",
    };

    const result = detectToxicPatterns(ctx);

    expect(result.violations.length).toBe(0);
    expect(result.score).toBe(0);
  });
});
