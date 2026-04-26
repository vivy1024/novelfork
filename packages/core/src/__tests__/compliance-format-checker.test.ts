import { describe, expect, it } from "vitest";
import { checkFormat } from "../compliance/format-checker.js";

describe("format checker", () => {
  it("detects empty chapters as blocking issues", () => {
    const result = checkFormat([{ chapterNumber: 1, title: "第1章 开始", content: "" }], { synopsis: "简介" });

    expect(result.blockCount).toBe(1);
    expect(result.issues.some((issue) => issue.type === "empty-chapter")).toBe(true);
  });

  it("detects short chapters", () => {
    const result = checkFormat([{ chapterNumber: 1, title: "第1章 开始", content: "短章" }], { synopsis: "简介" });

    expect(result.issues.some((issue) => issue.type === "chapter-too-short")).toBe(true);
  });

  it("detects missing synopsis and total word count warning", () => {
    const result = checkFormat([{ chapterNumber: 1, title: "第1章 开始", content: "这是一章".repeat(400) }], {}, "qidian");

    expect(result.issues.some((issue) => issue.type === "missing-synopsis")).toBe(true);
    expect(result.issues.some((issue) => issue.type === "total-word-count")).toBe(true);
  });

  it("detects consecutive blank lines", () => {
    const result = checkFormat(
      [{ chapterNumber: 1, title: "第1章 开始", content: `第一段\n\n\n\n\n第二段${"字".repeat(1000)}` }],
      { synopsis: "简介" },
    );

    expect(result.issues.some((issue) => issue.type === "consecutive-blank-lines")).toBe(true);
  });

  it("computes aggregate word stats", () => {
    const result = checkFormat([
      { chapterNumber: 1, title: "第1章", content: "字".repeat(1200) },
      { chapterNumber: 2, title: "第2章", content: "字".repeat(1800) },
    ], { synopsis: "简介" });

    expect(result.totalWords).toBe(3000);
    expect(result.chapterCount).toBe(2);
    expect(result.avgChapterWords).toBe(1500);
  });
});
