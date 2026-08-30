import { describe, expect, it } from "vitest";

import { handleChapterAuditV2 } from "./chapter-audit-v2.js";

const baseContentShort = "短";

describe("chapter-audit-v2 S6 章内重复段落", () => {
  it("能被 S6 精准拦下同章重复", () => {
    const dup = "他把文件翻到最后一页，指尖停在签名栏上，墨水还没干。走廊里传来脚步声，他没回头。";
    const content = `${dup}\n\n她把门关上。\n\n${dup}\n\n他合上文件。`;

    const result = handleChapterAuditV2({
      bookId: "test-book",
      chapterNumber: 1,
      content,
    });

    const hit = result.softViolations.find((v) => v.ruleId === "S6");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("soft");
    expect(hit!.description).toContain("重复");
  });

  it("干净正文不触发 S6", () => {
    const content = "他站起来，环顾四周。窗外的月光洒在地板上。她转身推开门。";

    const result = handleChapterAuditV2({
      bookId: "test-book",
      chapterNumber: 1,
      content,
    });

    expect(result.softViolations.some((v) => v.ruleId === "S6")).toBe(false);
  });

  it("checks=['continuity'] 时 S6 跑", () => {
    const dup = "这是为了构造一个让 continuity 能检的重复段落：他说了一句话，又重复了一遍。";
    const content = `${dup}\n\n中间隔一段。\n\n${dup}`;

    const result = handleChapterAuditV2({
      bookId: "test-book",
      chapterNumber: 1,
      content,
      checks: ["continuity"],
    });

    expect(result.softViolations.some((v) => v.ruleId === "S6")).toBe(true);
  });

  it("S7 能拦无证据结清", () => {
    const result = handleChapterAuditV2({
      bookId: "test-book",
      chapterNumber: 16,
      content: "薛行之把报告合上，转身离开实验室。",
      pressureLedger: {
        items: [{ id: "debt-1", kind: "debt", name: "实验债", status: "resolved", lastChapter: 16 }],
      },
    });
    const hit = result.hardViolations.find((v) => v.ruleId === "S7");
    expect(hit).toBeDefined();
    expect(hit!.description).toContain("没有对应证据");
  });

  it("checks 不含 continuity 时 S6 不跑", () => {
    const dup = "这段文字重复出现两次。";
    const content = `${dup}\n\n她快走到门口。\n\n${dup}`;

    const result = handleChapterAuditV2({
      bookId: "test-book",
      chapterNumber: 1,
      content,
      checks: ["rhythm"], // rhythm 白名单不含 S6
    });

    expect(result.softViolations.some((v) => v.ruleId === "S6")).toBe(false);
  });
});
