import { describe, expect, it } from "vitest";
import { groupSelfReviewIssues, reviewChapterParagraphs, type ParagraphSelfReviewIssue } from "../../engine/compliance/paragraph-self-review";
import {
  buildHumanizeMessage,
  buildPolishMessage,
  DIALOGUE_UNTOUCHED_RULE,
  HANDOFF_TOOL_NAMES,
  HUMANIZE_MAX_LISTED_ISSUES,
  humanizeHandoffIssues,
  PUNCTUATION_STYLE_UNTOUCHED_RULE,
} from "./self-review-handoff";
import { toWireToolName } from "../../engine/workflows/run-brief";
import { NOVEL_RUNTIME_CONTRIBUTION } from "../../runtime-contribution";

function issue(overrides: Partial<ParagraphSelfReviewIssue>): ParagraphSelfReviewIssue {
  return {
    paragraph: 1, paragraphStart: 0, paragraphEnd: 10, start: 0, end: 2,
    matchedText: "不禁", evidence: "他不禁抬头。", ruleId: "deletable-term", reason: "套词", source: "deslop-edit",
    ...overrides,
  };
}

describe("自审交叙述者：对白不进清单", () => {
  it("真实正文：对白里的套词与省略号不出现在人文化清单里", () => {
    const chapter = [
      "“我不禁想笑……你说呢……好不好……”她说。",
      "他不禁抬头，“与此同时，你在哪？”她问。",
    ].join("\n\n");
    const message = buildHumanizeMessage(3, reviewChapterParagraphs(chapter).issues);
    expect(message).toContain("发现了 1 处");
    expect(message).toContain("1. 第 2 段「他不禁抬头，」");
    expect(message).not.toContain("我不禁想笑");
    expect(message).not.toContain("与此同时");
    expect(message).not.toMatch(/^2\. /mu);
  });

  it("兜底：命中文字只出现在对白里的旧格式条目被剔除，叙述里也出现的保留", () => {
    const inDialogue = issue({ evidence: "“我不禁想笑。”她说。", matchedText: "不禁" });
    const inNarration = issue({ evidence: "他不禁抬头，“我不禁想笑。”", matchedText: "不禁" });
    const plain = issue({});
    const ellipsisInQuote = issue({ evidence: "「記著罷，媽媽的……」", matchedText: "……", ruleId: "ellipsis" });
    expect(humanizeHandoffIssues([inDialogue, inNarration, plain, ellipsisInQuote])).toEqual([inNarration, plain]);
  });

  it("指令里写明引号内对白一字不改，人文化与润色两档都有", () => {
    expect(buildHumanizeMessage(1, [issue({})])).toContain(DIALOGUE_UNTOUCHED_RULE);
    expect(buildPolishMessage(1)).toContain(DIALOGUE_UNTOUCHED_RULE);
    expect(DIALOGUE_UNTOUCHED_RULE).toContain("一字不改");
  });

  it("润色指令写明不改标点体例（破折号、省略号、引号形式保持原样）", () => {
    const message = buildPolishMessage(1);
    expect(message).toContain(PUNCTUATION_STYLE_UNTOUCHED_RULE);
    expect(PUNCTUATION_STYLE_UNTOUCHED_RULE).toContain("不改动原文的标点体例");
    expect(PUNCTUATION_STYLE_UNTOUCHED_RULE).toContain("──");
    expect(PUNCTUATION_STYLE_UNTOUCHED_RULE).toContain("省略号");
    expect(PUNCTUATION_STYLE_UNTOUCHED_RULE).toContain("引号");
  });

  it(`清单最多列 ${HUMANIZE_MAX_LISTED_ISSUES} 条，余下只报数量；计数按剔除对白之后算`, () => {
    const many = Array.from({ length: 25 }, (_, index) => issue({ paragraph: index + 1, evidence: `他不禁抬头看第${index + 1}眼。` }));
    const message = buildHumanizeMessage(2, [...many, issue({ evidence: "“我不禁想笑。”" })]);
    expect(message).toContain("发现了 25 处");
    expect(message).toContain(`${HUMANIZE_MAX_LISTED_ISSUES}. 第 ${HUMANIZE_MAX_LISTED_ISSUES} 段`);
    expect(message).not.toContain(`${HUMANIZE_MAX_LISTED_ISSUES + 1}. 第`);
    expect(message).toContain("另有 5 条未列出");
  });

  it("同一句两个破折号：真实自审逐处报两处，交接清单只列一条并注明命中 2 处", () => {
    const chapter = "他站在门口——没有进去——又转身走了。\n\n她感到紧张。";
    const raw = reviewChapterParagraphs(chapter).issues.filter((item) => item.evidence.includes("门口"));
    // 自审结果本身仍是逐处命中（两处破折号、同一条证据原句）
    expect(raw.filter((item) => item.matchedText.includes("——"))).toHaveLength(2);
    const dashRule = raw.find((item) => item.matchedText.includes("——"))!.ruleId;
    const message = buildHumanizeMessage(1, raw);
    const listed = message.split("\n").filter((line) => /^\d+\. /u.test(line) && line.includes("门口"));
    const dashLines = listed.filter((line) => line.includes(raw.find((item) => item.ruleId === dashRule)!.reason));
    expect(dashLines).toHaveLength(1);
    expect(dashLines[0]).toContain("（本句命中 2 处）");
    expect(message).toContain(`发现了 ${raw.length} 处`);
    expect(message).toContain("同句合并后");
  });

  it("归并键是「规则 + 证据原句」：同句不同规则、同规则不同句都各自一条；同句跨段合并段号", () => {
    const a1 = issue({ start: 0, end: 1, ruleId: "dash" });
    const a2 = issue({ start: 3, end: 4, ruleId: "dash" });
    const otherRule = issue({ ruleId: "deletable-term" });
    const otherSentence = issue({ evidence: "她不禁回头。", ruleId: "dash" });
    const sameSentenceLater = issue({ paragraph: 4, start: 40, end: 41, ruleId: "dash" });
    const groups = groupSelfReviewIssues([a1, a2, otherRule, otherSentence, sameSentenceLater]);
    expect(groups.map((group) => [group.issue, group.hitCount, group.paragraphs])).toEqual([
      [a1, 3, [1, 4]],
      [otherRule, 1, [1]],
      [otherSentence, 1, [1]],
    ]);
    const message = buildHumanizeMessage(1, [a1, a2, otherRule]);
    expect(message).toContain("1. 第 1 段「他不禁抬头。」（本句命中 2 处）");
    expect(message).toContain("2. 第 1 段「他不禁抬头。」：套词");
    expect(message).not.toMatch(/^3\. /mu);
    // 没有可合并的命中时不出「同句合并」说明
    expect(buildHumanizeMessage(1, [otherRule])).not.toContain("同句合并");
  });

  it("清单截断按合并后的条数算", () => {
    const repeated = Array.from({ length: 30 }, (_, index) => issue({ start: index, end: index + 1 }));
    const message = buildHumanizeMessage(1, repeated);
    expect(message).toContain("1. 第 1 段「他不禁抬头。」（本句命中 30 处）");
    expect(message).not.toMatch(/^2\. /mu);
    expect(message).not.toContain("另有");
  });

  it("交接指令里提到的每个工具名都在模型可见的工具名集合里（线上名，点换下划线）", () => {
    // 模型可见集合：Runtime 注册的小说工具，名字经同一映射转换（product-runtime 的 toRuntimeToolName 与之逐一对齐，有测试钉住）。
    const visible = new Set((NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((tool) => toWireToolName(tool.definition.name)));
    // 形如 a.b / a_b 的标识符都当工具名检查；点号名一律不在集合里，写错了会直接报出来。
    const mentioned = (message: string) => [...new Set(message.match(/[A-Za-z][A-Za-z0-9]*(?:[._][A-Za-z0-9]+)+/gu) ?? [])];
    const messages = [buildHumanizeMessage(1, [issue({})]), buildPolishMessage(1)];
    for (const message of messages) {
      const names = mentioned(message);
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((name) => !visible.has(name)), message).toEqual([]);
    }
    expect(messages[0]).toContain(HANDOFF_TOOL_NAMES.proposeSelection);
    expect(messages[1]).toContain(HANDOFF_TOOL_NAMES.readChapter);
    expect(HANDOFF_TOOL_NAMES).toEqual({ proposeSelection: "chapter_propose_selection", readChapter: "chapter_read" });
  });

  it("作者硬约束排在人文化手法之前；未给约束时不出硬约束段", () => {
    const issues = [issue({})];
    expect(buildHumanizeMessage(1, issues)).not.toContain("本书硬约束");
    expect(buildHumanizeMessage(1, issues, [])).toBe(buildHumanizeMessage(1, issues));
    const lines = buildHumanizeMessage(1, issues, ["对白只用短句"]).split("\n");
    expect(lines).toContain("- 对白只用短句");
    expect(lines.findIndex((line) => line.startsWith("本书硬约束")))
      .toBeLessThan(lines.findIndex((line) => line.startsWith("- 可选的人文化手法")));
  });
});
