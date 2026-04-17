/**
 * Golden Chapters Analyzer Tests
 */

import { describe, it, expect } from "vitest";
import { analyzeChapter, analyzeGoldenChapters } from "../lib/golden-chapters-analyzer.js";

describe("Golden Chapters Analyzer", () => {
  describe("analyzeChapter", () => {
    it("应该检测第 1 章的开局冲突", () => {
      const content = `
        "你这个废物，三年之期已到，我要退婚！"
        少女的声音冰冷刺骨，充满了嘲讽和鄙视。
        周围的人纷纷发出嘲笑声，指指点点。
        林凡握紧了拳头，心中暗暗发誓：总有一天，我会让你们后悔！
      `.repeat(10);

      const result = analyzeChapter(1, content, "zh");

      expect(result.chapterNumber).toBe(1);
      expect(result.score).toBeGreaterThan(0);
      expect(result.density.conflict).toBeGreaterThan(0);
      expect(result.hooks.length).toBeGreaterThan(0);
    });

    it("应该检测第 1 章的老套开局毒点", () => {
      const content = `
        "三年之期已到，莫欺少年穷！"
        林凡被退婚了，所有人都嘲笑他是废物。
      `.repeat(5);

      const result = analyzeChapter(1, content, "zh");

      const hasOpeningToxic = result.issues.some(
        (issue) => issue.category === "开局毒点"
      );
      expect(hasOpeningToxic).toBe(true);
    });

    it("应该检测第 1 章的信息过载", () => {
      const content = `
        修仙界的境界分为：炼气期、筑基期、金丹期、元婴期、化神期、合体期、渡劫期、大乘期。
        每个境界又分为初期、中期、后期、巅峰四个小境界。
        宗门分别是：天剑宗、玄天宗、万剑宗、太虚宗、紫霄宗、青云宗、天机宗、五行宗。
      `.repeat(5);

      const result = analyzeChapter(1, content, "zh");

      const hasInfoOverload = result.issues.some(
        (issue) => issue.category === "信息过载"
      );
      expect(hasInfoOverload).toBe(true);
    });

    it("应该检测第 2 章的主线推进", () => {
      const content = `
        林凡走出家门，决定前往天剑宗参加入门考核。
        路上遇到了一群山贼，双方爆发了激烈的战斗。
        林凡展现出惊人的实力，将山贼全部击败。
      `.repeat(10);

      const result = analyzeChapter(2, content, "zh");

      expect(result.chapterNumber).toBe(2);
      expect(result.density.conflict).toBeGreaterThan(0);
    });

    it("应该检测第 3 章的悬念设置", () => {
      const content = `
        林凡通过了考核，但他心中疑惑：为什么考官看他的眼神如此奇怪？
        夜晚，他听到了神秘的声音："你终于来了..."
        这个声音似乎来自遥远的地方，又仿佛就在耳边。
        林凡感到一阵不安，总觉得有什么大事要发生。
      `.repeat(10);

      const result = analyzeChapter(3, content, "zh");

      expect(result.chapterNumber).toBe(3);
      expect(result.density.mystery).toBeGreaterThan(0);
      expect(result.hooks.some(h => h.type === "mystery")).toBe(true);
    });

    it("应该检测第 3 章的留人点不足", () => {
      const content = `
        林凡进入了宗门，开始了平淡的修炼生活。
        每天早起练功，晚上打坐。
        日子就这样一天天过去。
      `.repeat(10);

      const result = analyzeChapter(3, content, "zh");

      const hasHookIssue = result.issues.some(
        (issue) => issue.category === "留人点不足" || issue.category === "悬念设置"
      );
      expect(hasHookIssue).toBe(true);
    });
  });

  describe("analyzeGoldenChapters", () => {
    it("应该分析前 3 章并计算综合评分", () => {
      const chapters = [
        {
          number: 1,
          content: `
            "你这个废物！"少女冷笑道。
            林凡握紧拳头，心中暗暗发誓：总有一天，我会让你们后悔！
            他转身离开，决定前往天剑宗。
          `.repeat(20),
        },
        {
          number: 2,
          content: `
            路上遇到山贼，林凡与他们展开激烈战斗。
            他展现出惊人的实力，将山贼击败。
            山贼头目临死前说："你...你竟然是..."
          `.repeat(20),
        },
        {
          number: 3,
          content: `
            林凡通过考核，但他心中疑惑：为什么考官看他的眼神如此奇怪？
            夜晚，他听到神秘的声音："你终于来了..."
            这个声音让他感到不安，似乎有什么大事要发生。
          `.repeat(20),
        },
      ];

      const result = analyzeGoldenChapters(chapters, "zh");

      expect(result.chapters.length).toBe(3);
      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      expect(result.chapters[0].chapterNumber).toBe(1);
      expect(result.chapters[1].chapterNumber).toBe(2);
      expect(result.chapters[2].chapterNumber).toBe(3);
    });

    it("应该收集所有关键问题", () => {
      const chapters = [
        {
          number: 1,
          content: "三年之期已到，莫欺少年穷！".repeat(50),
        },
        {
          number: 2,
          content: "林凡每天修炼，日子平淡无奇。".repeat(50),
        },
        {
          number: 3,
          content: "林凡继续修炼，没有任何波澜。".repeat(50),
        },
      ];

      const result = analyzeGoldenChapters(chapters, "zh");

      expect(result.criticalIssues.length).toBeGreaterThan(0);
      expect(result.criticalIssues.every(i => i.severity === "error")).toBe(true);
    });

    it("应该正确处理只有部分章节的情况", () => {
      const chapters = [
        {
          number: 1,
          content: "林凡开始了他的修仙之路。".repeat(50),
        },
      ];

      const result = analyzeGoldenChapters(chapters, "zh");

      expect(result.chapters.length).toBe(1);
      expect(result.overallScore).toBeGreaterThan(0);
    });

    it("应该正确处理空章节列表", () => {
      const result = analyzeGoldenChapters([], "zh");

      expect(result.chapters.length).toBe(0);
      expect(result.overallScore).toBe(0);
      expect(result.criticalIssues.length).toBe(0);
    });
  });

  describe("密度计算", () => {
    it("应该正确计算冲突密度", () => {
      const highConflict = `
        战斗、冲突、矛盾、对抗、争执、打斗、厮杀、交锋。
        怒火中烧、暴怒、震怒、恼怒、气急败坏。
        威胁、恐吓、警告、逼迫、强迫、胁迫。
      `.repeat(10);

      const lowConflict = "林凡平静地修炼，日子过得很平淡。".repeat(10);

      const highResult = analyzeChapter(1, highConflict, "zh");
      const lowResult = analyzeChapter(1, lowConflict, "zh");

      expect(highResult.density.conflict).toBeGreaterThan(lowResult.density.conflict);
    });

    it("应该正确计算悬念密度", () => {
      const highMystery = `
        疑惑、疑问、困惑、不解、纳闷、奇怪、诡异、蹊跷。
        秘密、隐藏、隐瞒、掩盖、遮掩、不为人知。
        为什么、怎么会、难道、莫非、竟然。
      `.repeat(10);

      const lowMystery = "一切都很正常，没有任何异常。".repeat(10);

      const highResult = analyzeChapter(3, highMystery, "zh");
      const lowResult = analyzeChapter(3, lowMystery, "zh");

      expect(highResult.density.mystery).toBeGreaterThan(lowResult.density.mystery);
    });
  });

  describe("留人点检测", () => {
    it("应该检测 6000 字内的留人点", () => {
      const earlyHook = "战斗爆发！" + "平淡的日子。".repeat(1000);
      const lateHook = "平淡的日子。".repeat(1000) + "战斗爆发！";

      const earlyResult = analyzeChapter(1, earlyHook, "zh");
      const lateResult = analyzeChapter(1, lateHook, "zh");

      const earlyStrongHooks = earlyResult.hooks.filter(
        h => h.position < 6000 && h.strength === "strong"
      );
      const lateStrongHooks = lateResult.hooks.filter(
        h => h.position < 6000 && h.strength === "strong"
      );

      expect(earlyStrongHooks.length).toBeGreaterThan(lateStrongHooks.length);
    });

    it("应该区分留人点强度", () => {
      const content = `
        ${"战斗！".repeat(1)}
        ${"平淡。".repeat(500)}
        ${"冲突！".repeat(1)}
        ${"平淡。".repeat(500)}
        ${"矛盾！".repeat(1)}
      `;

      const result = analyzeChapter(1, content, "zh");

      const strongHooks = result.hooks.filter(h => h.strength === "strong");
      const mediumHooks = result.hooks.filter(h => h.strength === "medium");
      const weakHooks = result.hooks.filter(h => h.strength === "weak");

      expect(strongHooks.length + mediumHooks.length + weakHooks.length).toBe(result.hooks.length);
    });
  });
});
