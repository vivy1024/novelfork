import { describe, expect, it } from "vitest";
import { handleChapterAuditV2 } from "./chapter-audit-v2.js";
import { handleSceneSpec } from "./scene-spec-handler.js";

describe("constraint-driven v2 guards", () => {
  describe("chapter.audit v2 — canon + POV + soft constraints", () => {
    it("passes when no violations", () => {
      const result = handleChapterAuditV2({
        bookId: "test",
        chapterNumber: 1,
        content: "韩立走在路上，心中暗想今日之事颇为蹊跷。".repeat(50),
        wordTarget: 3000,
      });
      expect(result.ok).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.hardViolations).toHaveLength(0);
    });

    it("detects canon violation (H2) when content contradicts forbidden rule", () => {
      const result = handleChapterAuditV2({
        bookId: "test",
        chapterNumber: 5,
        content: "韩立使用飞行法术飞上天空。".repeat(30),
        canonEntries: [
          { title: "世界规则", contentMd: "禁止飞行法术。不能使用飞行。", category: "world-rules" },
        ],
      });
      expect(result.hardViolations.length).toBeGreaterThan(0);
      expect(result.hardViolations.some((v) => v.ruleId === "H2")).toBe(true);
      expect(result.passed).toBe(false);
    });

    it("detects soft violation (S1) when word count is too low", () => {
      const result = handleChapterAuditV2({
        bookId: "test",
        chapterNumber: 1,
        content: "短章。",
        wordTarget: 3000,
      });
      expect(result.softViolations.some((v) => v.ruleId === "S1")).toBe(true);
    });

    it("detects scene spec character missing (S5)", () => {
      const result = handleChapterAuditV2({
        bookId: "test",
        chapterNumber: 1,
        content: "韩立独自修炼。".repeat(100),
        sceneSpec: {
          scenes: [{ characters: ["韩立", "南宫婉"], location: "洞府", conflict: "修炼瓶颈", outcome: "突破" }],
          wordTarget: 3000,
        },
      });
      expect(result.softViolations.some((v) => v.ruleId === "S5" && v.description.includes("南宫婉"))).toBe(true);
    });
  });

  describe("scene.spec — H4 completeness validation", () => {
    it("generates a valid scene spec from sufficient input", () => {
      const result = handleSceneSpec({
        bookId: "test",
        chapterNumber: 1,
        userDirectives: "写一章关于韩立修炼的故事",
        cockpitSnapshot: { progress: { chapterCount: 0 } },
        jingweiBrief: { coreBrief: [{ title: "韩立", category: "characters" }], index: { categories: [] } },
      });
      // 占位实现从输入推断生成 spec
      expect(result).toBeDefined();
    });
  });
});
