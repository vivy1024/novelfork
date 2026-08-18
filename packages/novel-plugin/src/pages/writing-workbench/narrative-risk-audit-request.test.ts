/**
 * 叙事审计指令构造的契约测试。
 *
 * 这条指令唯一的价值是把隔离纪律写死。如果它没有明确禁止传大纲/意图，
 * 叙述者会顺手把这些一起塞给子代理，零继承审计立刻退化成自我确认。
 */

import { describe, expect, it } from "vitest";
import { buildNarrativeRiskAuditMessage } from "./narrative-risk-audit-request";

describe("叙事审计指令", () => {
  it("点名使用风险卡 skill，不靠叙述者自己猜方法", () => {
    const message = buildNarrativeRiskAuditMessage({ content: "他推开门。", chapterNumber: 12 });

    expect(message).toContain("nf-narrative-risk-audit");
  });

  it("要求零继承子代理，并逐项列出禁止传入的上下文", () => {
    const message = buildNarrativeRiskAuditMessage({ content: "他推开门。" });

    expect(message).toContain("fork_turns=none");
    for (const forbidden of ["大纲", "卷纲", "人物档案", "经纬条目", "叙事记忆", "章节蓝图", "写作意图"]) {
      expect(message, `缺少禁止项：${forbidden}`).toContain(forbidden);
    }
  });

  it("明确禁止暗示答案与告知章号，避免引导子代理", () => {
    const message = buildNarrativeRiskAuditMessage({ content: "他推开门。", chapterNumber: 7 });

    expect(message).toContain("不要在 prompt 里暗示");
    expect(message).toContain("不要告诉它这是第几章");
  });

  it("声明只报告不改稿，且拿不准的交回作者", () => {
    const message = buildNarrativeRiskAuditMessage({ content: "他推开门。" });

    expect(message).toContain("不改稿");
    expect(message).toContain("[需复核]");
  });

  it("带章号时在指令里标出目标章节", () => {
    const message = buildNarrativeRiskAuditMessage({ content: "他推开门。", chapterNumber: 12 });
    expect(message).toContain("第 12 章");
  });

  it("没有章号时退回中性称呼，不编造章号", () => {
    const message = buildNarrativeRiskAuditMessage({ content: "他推开门。" });

    expect(message).toContain("当前章节");
    expect(message).not.toMatch(/第 \d+ 章/);
  });

  it("正文原样带入，子代理才有可审的材料", () => {
    const content = "他推开门，屋里没人。桌上放着一封信。";
    const message = buildNarrativeRiskAuditMessage({ content });

    expect(message).toContain(content);
  });

  it("超长正文截断并如实告知，不静默丢内容", () => {
    const long = "他推开门。".repeat(3000);
    const message = buildNarrativeRiskAuditMessage({ content: long });

    expect(message).toContain("已截断");
    expect(message.length).toBeLessThan(long.length);
  });

  it("正文在长度以内时不出现截断说明", () => {
    const message = buildNarrativeRiskAuditMessage({ content: "他推开门。" });
    expect(message).not.toContain("已截断");
  });
});
