import { describe, expect, it } from "vitest";

import { detectIntraChapterDupParagraphs } from "./post-write-validator.js";

describe("detectIntraChapterDupParagraphs", () => {
  it("完全干净的正文不报错", () => {
    const content = "他走过去，端起杯子，先喝了一口水。\n\n窗外的雨越下越大。";
    expect(detectIntraChapterDupParagraphs(content)).toEqual([]);
  });

  it("同一段落在同一章内重复出现，报错", () => {
    const dup = "他把文件翻到最后一页，指尖停在签名栏上，墨水还没干。走廊里传来脚步声，他没回头。";
    const content = `${dup}\n\n她推开门进来，把伞收在门边。\n\n${dup}\n\n他合上文件。`;
    const violations = detectIntraChapterDupParagraphs(content);
    expect(violations.length).toBe(1);
    expect(violations[0].severity).toBe("error");
    expect(violations[0].rule).toBe("章内重复段落");
    expect(violations[0].description).toContain("重复");
  });

  it("低于最小字数的重复段落不报警", () => {
    const dup = "他点头。"; // 4 chars, below default 20
    const content = `${dup}\n\n她推开门。\n\n${dup}`;
    expect(detectIntraChapterDupParagraphs(content)).toEqual([]);
  });

  it("跨章重复的章节间同一文本不在这道检里报", () => {
    // 这正是 detectCrossChapterRepetition 的职责；本函数只吃同一章正文。
    const dup = "他把文件翻到最后一页，指尖停在签名栏上。走廊里传来脚步声，他没回头。";
    const content = `${dup}\n\n他合上文件。`;
    // 同章只出现一次，不报警。
    expect(detectIntraChapterDupParagraphs(content)).toEqual([]);
  });

  it("三段以上重复都计入同一违规描述", () => {
    const dup = "他把文件翻到最后一页，指尖停在签名栏上，墨水还没干。他合上文件。";
    const content = `${dup}\n\n她推开门。\n\n${dup}\n\n他把伞撑开。\n\n${dup}`;
    // 重复 3 次，本函数会非常明确；样本里列在前 2 条。
    const v = detectIntraChapterDupParagraphs(content);
    expect(v.length).toBe(1);
    expect(v[0].description).toContain("(×");
  });
});
