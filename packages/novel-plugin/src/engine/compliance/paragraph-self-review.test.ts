import { describe, expect, it } from "vitest";
import { reviewChapterParagraphs } from "./paragraph-self-review.js";

describe("段落级只读自审", () => {
  it("按空行分段，返回原文偏移、原句和现有规则原因", () => {
    const chapter = "韩立把药锄放下。\r\n\r\n他不禁抬头，看见门开了。\r\n\r\n她感到紧张。";
    const report = reviewChapterParagraphs(chapter);

    expect(report.status).toBe("issues-found");
    expect(report.paragraphCount).toBe(3);
    const edit = report.issues.find((issue) => issue.ruleId === "deletable-term");
    expect(edit).toMatchObject({
      paragraph: 2,
      paragraphStart: chapter.indexOf("他不禁"),
      matchedText: "不禁",
      evidence: "他不禁抬头，看见门开了。",
      source: "deslop-edit",
    });
    expect(edit?.reason).toContain("不禁");
    expect(chapter.slice(edit!.start, edit!.end)).toBe(edit?.matchedText);

    const manual = report.issues.find((issue) => issue.ruleId === "emotion-telling");
    expect(manual).toMatchObject({
      paragraph: 3,
      matchedText: "她感到紧张",
      evidence: "她感到紧张。",
      source: "deslop-manual-flag",
    });
    expect(manual?.reason).toContain("情绪");
    expect(manual?.suggestion).toContain("身体反应");
    expect(report.issues.map((issue) => issue.start)).toEqual([...report.issues.map((issue) => issue.start)].sort((a, b) => a - b));
    expect(chapter).toContain("不禁");
  });

  it("连续同主语命中保留原文中的完整三句证据", () => {
    const chapter = "他推开门。他看见桌子。他坐下来。";
    const issue = reviewChapterParagraphs(chapter).issues.find((item) => item.ruleId === "consecutive-subject");

    expect(issue).toMatchObject({ matchedText: chapter, evidence: chapter, paragraph: 1 });
    expect(chapter.slice(issue!.start, issue!.end)).toBe(chapter);
  });

  it("白名单沿用现有去套话规则，不自行引入新判定", () => {
    const chapter = "他不禁抬头。";
    expect(reviewChapterParagraphs(chapter, { whitelist: ["不禁"] }).issues).toHaveLength(0);
  });

  it("干净正文给出清楚空态，不宣称人工比例", () => {
    const report = reviewChapterParagraphs("韩立把药锄扛在肩上，鞋底沾着泥。");
    expect(report).toMatchObject({ status: "clear", paragraphCount: 1, issues: [] });
    expect(report.message).toContain("未发现");
    expect(report.methodology).toContain("不估算 AI 生成概率或人工写作比例");
    expect("aiRatio" in report).toBe(false);
  });

  it.each(["", " \r\n\r\n\t "])("空白正文返回未检查状态", (chapter) => {
    const report = reviewChapterParagraphs(chapter);
    expect(report).toMatchObject({ status: "empty-input", paragraphCount: 0, issues: [] });
    expect(report.message).toBe("暂无正文可检查。");
  });
});
