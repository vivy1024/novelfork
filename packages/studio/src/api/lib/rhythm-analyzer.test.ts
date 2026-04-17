/**
 * Rhythm Analyzer Tests
 */

import { describe, it, expect } from "vitest";
import {
  analyzeTension,
  detectPattern,
  detectWarnings,
  detectClimaxPoints,
  analyzeRhythm,
  type ChapterTension,
} from "./rhythm-analyzer.js";

describe("analyzeTension", () => {
  it("应该为空文本返回 0", () => {
    expect(analyzeTension("")).toBe(0);
  });

  it("应该为高冲突文本返回高张力值", () => {
    const text = "战斗激烈，敌人攻击，主角反击，血流成河，危险重重，生死一线！";
    const tension = analyzeTension(text);
    expect(tension).toBeGreaterThan(50);
  });

  it("应该为平静文本返回低张力值", () => {
    const text = "今天天气很好，阳光明媚，微风拂面，心情愉悦。";
    const tension = analyzeTension(text);
    expect(tension).toBeLessThan(30);
  });

  it("应该为情感强烈文本返回中高张力值", () => {
    const text = "他激动得心跳加速，颤抖着说不出话，眼神中充满了震惊和恐惧！";
    const tension = analyzeTension(text);
    expect(tension).toBeGreaterThan(40);
  });
});

describe("detectPattern", () => {
  it("应该检测到有效的 3+1 模式", () => {
    const chapters: ChapterTension[] = [
      { chapterNumber: 1, tension: 70, type: "high", metrics: { conflictDensity: 70, emotionalIntensity: 70, informationLoad: 70 } },
      { chapterNumber: 2, tension: 75, type: "high", metrics: { conflictDensity: 75, emotionalIntensity: 75, informationLoad: 75 } },
      { chapterNumber: 3, tension: 80, type: "climax", metrics: { conflictDensity: 80, emotionalIntensity: 80, informationLoad: 80 } },
      { chapterNumber: 4, tension: 40, type: "transition", metrics: { conflictDensity: 40, emotionalIntensity: 40, informationLoad: 40 } },
    ];

    const pattern = detectPattern(chapters);
    expect(pattern.isValid).toBe(true);
    expect(pattern.score).toBe(100);
    expect(pattern.violations).toHaveLength(0);
  });

  it("应该检测到无效的 3+1 模式", () => {
    const chapters: ChapterTension[] = [
      { chapterNumber: 1, tension: 40, type: "transition", metrics: { conflictDensity: 40, emotionalIntensity: 40, informationLoad: 40 } },
      { chapterNumber: 2, tension: 45, type: "transition", metrics: { conflictDensity: 45, emotionalIntensity: 45, informationLoad: 45 } },
      { chapterNumber: 3, tension: 50, type: "transition", metrics: { conflictDensity: 50, emotionalIntensity: 50, informationLoad: 50 } },
      { chapterNumber: 4, tension: 70, type: "high", metrics: { conflictDensity: 70, emotionalIntensity: 70, informationLoad: 70 } },
    ];

    const pattern = detectPattern(chapters);
    expect(pattern.isValid).toBe(false);
    expect(pattern.score).toBeLessThan(100);
    expect(pattern.violations.length).toBeGreaterThan(0);
  });

  it("应该处理章节数不足的情况", () => {
    const chapters: ChapterTension[] = [
      { chapterNumber: 1, tension: 70, type: "high", metrics: { conflictDensity: 70, emotionalIntensity: 70, informationLoad: 70 } },
      { chapterNumber: 2, tension: 75, type: "high", metrics: { conflictDensity: 75, emotionalIntensity: 75, informationLoad: 75 } },
    ];

    const pattern = detectPattern(chapters);
    expect(pattern.isValid).toBe(false);
    expect(pattern.score).toBe(0);
  });
});

describe("detectWarnings", () => {
  it("应该检测连续高压章节", () => {
    const chapters: ChapterTension[] = Array.from({ length: 6 }, (_, i) => ({
      chapterNumber: i + 1,
      tension: 75,
      type: "high" as const,
      metrics: { conflictDensity: 75, emotionalIntensity: 75, informationLoad: 75 }
    }));

    const warnings = detectWarnings(chapters);
    const highPressureWarning = warnings.find(w => w.type === "consecutive-high");
    expect(highPressureWarning).toBeDefined();
    expect(highPressureWarning?.severity).toBe("medium");
  });

  it("应该检测节奏断崖", () => {
    const chapters: ChapterTension[] = [
      { chapterNumber: 1, tension: 90, type: "climax", metrics: { conflictDensity: 90, emotionalIntensity: 90, informationLoad: 90 } },
      { chapterNumber: 2, tension: 30, type: "transition", metrics: { conflictDensity: 30, emotionalIntensity: 30, informationLoad: 30 } },
    ];

    const warnings = detectWarnings(chapters);
    const cliffWarning = warnings.find(w => w.type === "rhythm-cliff");
    expect(cliffWarning).toBeDefined();
    expect(cliffWarning?.severity).toBe("high");
  });

  it("应该检测缺失高潮", () => {
    const chapters: ChapterTension[] = Array.from({ length: 10 }, (_, i) => ({
      chapterNumber: i + 1,
      tension: 60,
      type: "high" as const,
      metrics: { conflictDensity: 60, emotionalIntensity: 60, informationLoad: 60 }
    }));

    const warnings = detectWarnings(chapters);
    const climaxWarning = warnings.find(w => w.type === "missing-climax");
    expect(climaxWarning).toBeDefined();
  });

  it("应该不为正常节奏生成警告", () => {
    const chapters: ChapterTension[] = [
      { chapterNumber: 1, tension: 70, type: "high", metrics: { conflictDensity: 70, emotionalIntensity: 70, informationLoad: 70 } },
      { chapterNumber: 2, tension: 75, type: "high", metrics: { conflictDensity: 75, emotionalIntensity: 75, informationLoad: 75 } },
      { chapterNumber: 3, tension: 85, type: "climax", metrics: { conflictDensity: 85, emotionalIntensity: 85, informationLoad: 85 } },
      { chapterNumber: 4, tension: 50, type: "transition", metrics: { conflictDensity: 50, emotionalIntensity: 50, informationLoad: 50 } },
    ];

    const warnings = detectWarnings(chapters);
    expect(warnings).toHaveLength(0);
  });
});

describe("detectClimaxPoints", () => {
  it("应该标记 10 的倍数章节高潮", () => {
    const chapters: ChapterTension[] = [
      { chapterNumber: 10, tension: 80, type: "climax", metrics: { conflictDensity: 80, emotionalIntensity: 80, informationLoad: 80 } },
      { chapterNumber: 20, tension: 85, type: "climax", metrics: { conflictDensity: 85, emotionalIntensity: 85, informationLoad: 85 } },
      { chapterNumber: 15, tension: 90, type: "climax", metrics: { conflictDensity: 90, emotionalIntensity: 90, informationLoad: 90 } },
    ];

    const climaxPoints = detectClimaxPoints(chapters);
    expect(climaxPoints).toContain(10);
    expect(climaxPoints).toContain(20);
    expect(climaxPoints).not.toContain(15); // 不是 10 的倍数
  });

  it("应该标记 100-150 章大高潮", () => {
    const chapters: ChapterTension[] = [
      { chapterNumber: 100, tension: 90, type: "climax", metrics: { conflictDensity: 90, emotionalIntensity: 90, informationLoad: 90 } },
      { chapterNumber: 120, tension: 88, type: "climax", metrics: { conflictDensity: 88, emotionalIntensity: 88, informationLoad: 88 } },
      { chapterNumber: 125, tension: 92, type: "climax", metrics: { conflictDensity: 92, emotionalIntensity: 92, informationLoad: 92 } },
      { chapterNumber: 160, tension: 92, type: "climax", metrics: { conflictDensity: 92, emotionalIntensity: 92, informationLoad: 92 } },
    ];

    const climaxPoints = detectClimaxPoints(chapters);
    expect(climaxPoints).toContain(100); // 10 的倍数 + 100-150 区间
    expect(climaxPoints).toContain(120); // 10 的倍数 + 100-150 区间
    expect(climaxPoints).toContain(125); // 100-150 区间但不是 10 的倍数
    expect(climaxPoints).toContain(160); // 10 的倍数但超出 100-150 区间，仍被 10 倍数规则捕获
  });

  it("应该忽略张力不足的章节", () => {
    const chapters: ChapterTension[] = [
      { chapterNumber: 10, tension: 60, type: "high", metrics: { conflictDensity: 60, emotionalIntensity: 60, informationLoad: 60 } },
      { chapterNumber: 20, tension: 70, type: "high", metrics: { conflictDensity: 70, emotionalIntensity: 70, informationLoad: 70 } },
    ];

    const climaxPoints = detectClimaxPoints(chapters);
    expect(climaxPoints).toHaveLength(0);
  });
});

describe("analyzeRhythm", () => {
  it("应该完整分析章节节奏", () => {
    const chapters = [
      { number: 1, content: "战斗激烈，敌人攻击，主角反击，血流成河，危险重重！" },
      { number: 2, content: "继续战斗，怒吼声震天，杀气腾腾，生死一线！" },
      { number: 3, content: "最终决战，惊天动地，震惊全场，胜利在望！" },
      { number: 4, content: "战后休息，阳光明媚，心情平静，恢复体力。" },
    ];

    const analysis = analyzeRhythm(chapters);

    expect(analysis.chapters).toHaveLength(4);
    expect(analysis.chapters[0].tension).toBeGreaterThan(50);
    expect(analysis.chapters[3].tension).toBeLessThan(analysis.chapters[2].tension);
    expect(analysis.pattern).toBeDefined();
    expect(analysis.warnings).toBeDefined();
    expect(analysis.climaxPoints).toBeDefined();
  });

  it("应该处理空章节列表", () => {
    const analysis = analyzeRhythm([]);
    expect(analysis.chapters).toHaveLength(0);
    expect(analysis.pattern.isValid).toBe(false);
  });
});
