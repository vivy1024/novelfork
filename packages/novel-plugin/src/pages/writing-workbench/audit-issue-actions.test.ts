import { describe, expect, it } from "vitest";

import {
  extractQuotedHint,
  isAutoFixableIssue,
  locateAuditIssueQuote,
  buildAuditFixProposalMessage,
} from "./audit-issue-actions";

const CONTENT = "林舟抬手抹掉鼻血，键盘上已经溅了三滴。守门人仍旧站在通道尽头。";

describe("audit-issue-actions", () => {
  it("优先抽取「」引文作为定位 hint", () => {
    expect(extractQuotedHint("描写后盖章：「键盘上已经溅了三滴」")).toBe("键盘上已经溅了三滴");
  });

  it("引文在正文中则 strategy=anchor，否则回退最长命中片段", () => {
    const anchored = locateAuditIssueQuote(CONTENT, {
      description: "总结句盖章：「键盘上已经溅了三滴」",
    });
    expect(anchored).toEqual({ quote: "键盘上已经溅了三滴", strategy: "anchor" });

    const fallback = locateAuditIssueQuote(CONTENT, {
      description: "键盘上已经溅了三滴这种细节被总结盖章了",
    });
    expect(fallback.strategy).toBe("quote");
    expect(fallback.quote && CONTENT.replace(/\s+/g, "").includes(fallback.quote.replace(/\s+/g, ""))).toBe(true);

    expect(locateAuditIssueQuote(CONTENT, { description: "完全无关的外星设定" }).strategy).toBe("none");
  });

  it("auto_fixable 要求能定位且不是结构类/info", () => {
    const locate = { quote: "键盘上已经溅了三滴", strategy: "anchor" as const };
    expect(isAutoFixableIssue({ severity: "warning", category: "文风检查" }, locate)).toBe(true);
    expect(isAutoFixableIssue({ severity: "info", category: "文风检查" }, locate)).toBe(false);
    expect(isAutoFixableIssue({ severity: "critical", category: "时间线检查" }, locate)).toBe(false);
    expect(isAutoFixableIssue({ severity: "warning", category: "文风检查" }, { quote: null, strategy: "none" })).toBe(false);
  });

  it("修订提案消息要求 spot-fix 且不直接覆盖正文", () => {
    const message = buildAuditFixProposalMessage({
      chapterNumber: 12,
      issue: { severity: "warning", category: "文风检查", description: "总结盖章", suggestion: "删掉总结句" },
      quote: "键盘上已经溅了三滴",
    });
    expect(message).toContain("第 12 章");
    expect(message).toContain("不要直接覆盖正文");
    expect(message).toContain("spot-fix");
    expect(message).toContain("键盘上已经溅了三滴");
  });
});
