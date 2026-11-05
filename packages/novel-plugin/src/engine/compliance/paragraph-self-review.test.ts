import { describe, expect, it } from "vitest";
import { ELLIPSIS_CLUSTER_MIN, ELLIPSIS_CLUSTER_WINDOW, reviewChapterParagraphs } from "./paragraph-self-review.js";

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

describe("段落自审：对白不检查、省略号按密度", () => {
  it("引号内对白不命中任何规则（各类引号、繁简、对白里的套词）", () => {
    const chapter = [
      "「記著罷，媽媽的……」阿Ｑ回過頭去說。",
      "「你們可看見過殺頭麼？」阿Ｑ說，「咳，好看。殺革命黨。唉，好看好看，……」",
      "“秃儿。驴……”阿Q骂。",
      "『革命了……你知道？……』‘君子动口不动手……’",
      "“我不禁想起，与此同时，你在哪里？”赵太爷问。",
      "“他感到紧张。首先，我们要走。”",
    ].join("\n\n");
    const report = reviewChapterParagraphs(chapter);
    expect(report.issues).toEqual([]);
    expect(report.status).toBe("clear");
  });

  it("同一段里叙述命中照报，证据只含叙述部分", () => {
    const chapter = "他不禁抬头，“我不禁想笑……”她说。";
    const issues = reviewChapterParagraphs(chapter).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ ruleId: "deletable-term", start: chapter.indexOf("不禁"), evidence: "他不禁抬头，" });
    expect(issues[0]!.evidence).not.toContain("“");
  });

  it("跨过对白的连续句式不报（只要一部分落在对白里就整条丢弃）", () => {
    const chapter = "他推开门。“他看见桌子。”他坐下来。";
    expect(reviewChapterParagraphs(chapter).issues.filter((issue) => issue.ruleId === "consecutive-subject")).toEqual([]);
  });

  it("未闭合的引号只遮到行尾，不吞掉下一段的叙述", () => {
    const chapter = "“我不禁想说……\n\n他不禁抬头。";
    const issues = reviewChapterParagraphs(chapter).issues;
    expect(issues.map((issue) => [issue.paragraph, issue.ruleId])).toEqual([[2, "deletable-term"]]);
  });

  it("叙述里零散的省略号是正常用法，不命中", () => {
    const chapter = [
      "阿Ｑ想了一想……終於站起來，往土穀祠走去。",
      "天色暗了，他還坐在牆根下……看那一片白光。",
      `他走了很远${"，路边是田".repeat(50)}……才停下。`,
    ].join("\n\n");
    expect(reviewChapterParagraphs(chapter).issues).toEqual([]);
  });

  it(`同段 ${ELLIPSIS_CLUSTER_WINDOW} 字内连用 ${ELLIPSIS_CLUSTER_MIN} 处以上才命中，串里每处都报`, () => {
    const dense = "他走……又停……又走……又停……兩隻腳卻沒有動。";
    const issues = reviewChapterParagraphs(dense).issues;
    expect(issues.map((issue) => issue.ruleId)).toEqual(["ellipsis", "ellipsis", "ellipsis", "ellipsis"]);
    expect(issues[0]!.reason).toContain("连用");

    const twoOnly = "他走……又停……两只脚却没有动。";
    expect(reviewChapterParagraphs(twoOnly).issues).toEqual([]);

    // 三处分在不同段：不算同一串
    expect(reviewChapterParagraphs("他走……\n\n又停……\n\n又走……").issues).toEqual([]);

    // 三处跨度超过窗口：不算连用
    const spread = `他走……${"田".repeat(ELLIPSIS_CLUSTER_WINDOW)}又停……又走……`;
    expect(reviewChapterParagraphs(spread).issues).toEqual([]);
  });

  it("对白里的省略号不计入叙述密度", () => {
    const chapter = "“走……停……走……”他走……又停。";
    expect(reviewChapterParagraphs(chapter).issues).toEqual([]);
  });
});
