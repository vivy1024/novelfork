import { describe, expect, it } from "vitest";

import {
  checkFactConservation,
  evaluateRevisionEffectiveness,
  STAGNANT_REVISION_PROMPT_WARNING,
} from "./revision-effectiveness.js";

function filler(times: number): string {
  return "林舟踩着湿滑的青石板往巷尾走，雨点顺着檐角砸在门环上。".repeat(times);
}

describe("evaluateRevisionEffectiveness", () => {
  it("真实消除 AI 味病灶时判定非原地换词并建议 keep", () => {
    const before = [
      filler(8),
      "没有灯，没有人，没有一点声音。",
      "他声音不大，却带着不容拒绝的威压。",
      "这一夜注定无人入睡。",
    ].join("");
    const after = [
      filler(8),
      "屋里黑得伸手不见五指，只有灶膛余烬噼啪爆了一声。",
      "他把铜匙拍在案上，压低嗓门道：今晚谁也不许出门。",
      "门闩落下的闷响在廊下回荡，窗纸外刮过一阵冷风。",
    ].join("");

    const report = evaluateRevisionEffectiveness(before, after);
    expect(report.beforeIssueCount).toBeGreaterThanOrEqual(3);
    expect(report.afterIssueCount).toBe(0);
    expect(report.resolvedCount).toBe(report.beforeIssueCount);
    expect(report.remainingIssues).toEqual([]);
    expect(report.changeRatio).toBeGreaterThan(0.03);
    expect(report.stagnantRevision).toBe(false);
    expect(report.recommendedStrategy).toBe("keep");
    expect(report.advisoryNote).toBeUndefined();
  });

  it("只换近义词导致病灶未下降时判定 stagnantRevision=true 并建议 rewrite-paragraph", () => {
    const before = [
      filler(6),
      "没有灯，没有人，没有一点声音。",
      "他声音不大，却带着不容拒绝的意思。",
    ].join("");
    // 只做表面同义替换，两个毒句式骨架原封不动
    const after = [
      filler(6),
      "没有火，没有影，没有半点动静。",
      "他声音不高，却透着不容推辞的分量。",
    ].join("");

    const report = evaluateRevisionEffectiveness(before, after);
    expect(report.beforeIssueCount).toBeGreaterThanOrEqual(2);
    expect(report.afterIssueCount).toBeGreaterThanOrEqual(report.beforeIssueCount);
    expect(report.resolvedCount).toBe(0);
    expect(report.stagnantRevision).toBe(true);
    expect(report.recommendedStrategy).toBe("rewrite-paragraph");
    expect(report.advisoryNote).toContain(STAGNANT_REVISION_PROMPT_WARNING);
  });

  it("文本变动微乎其微（< 3%）即使原本无病灶也判定 stagnantRevision=true", () => {
    const before = `${filler(10)}林舟停步，摸出怀里的账本。`;
    const after = `${filler(10)}林舟停步，摸出怀里的账册。`;

    const report = evaluateRevisionEffectiveness(before, after);
    expect(report.changeRatio).toBeLessThan(0.03);
    expect(report.stagnantRevision).toBe(true);
    expect(report.recommendedStrategy).toBe("rewrite-paragraph");
  });

  it("同时纳入元叙事穿帮与有限视角自我不可见穿帮计数", () => {
    const before = `${filler(6)}上一章留下的线索终于揭晓，我眼中闪过一丝凌厉的寒光。`;
    const after = `${filler(6)}昨夜城门拾得的铜牌此刻发烫，我收紧指节，把牌子按回袖底。`;

    const report = evaluateRevisionEffectiveness(before, after);
    expect(report.beforeIssueCount).toBeGreaterThanOrEqual(2);
    expect(report.afterIssueCount).toBe(0);
    expect(report.stagnantRevision).toBe(false);
  });
});

describe("checkFactConservation", () => {
  it("数字、受保护专名与关键对白均保留时返回 ok=true", () => {
    const before = "林舟翻开青铜账册，指着 4800 灵石的亏空记录。刘管事冷笑：「三日之内你不交出底册，就等着被逐出外门。」";
    const after = "林舟摊开那本青铜账册，指腹压在 4800 灵石的亏空栏上。刘管事把茶碗往桌上一磕：「三日之内你不交出底册，就等着被逐出外门。」";

    const report = checkFactConservation(before, after, ["林舟", "刘管事", "青铜账册"]);
    expect(report.ok).toBe(true);
    expect(report.lostNumbers).toEqual([]);
    expect(report.lostNames).toEqual([]);
    expect(report.lostDialogueCount).toBe(0);
    expect(report.warnings).toEqual([]);
  });

  it("改写丢失关键数字、角色名或关键对白时给出清晰告警", () => {
    const before = "林舟查出刘管事克扣了 4800 灵石和 12% 折旧款。刘管事盯着青铜账册咬牙道：“明天寅时之前把封皮送回庶务堂，否则我先掀你的老底。”";
    const after = "林舟查出管事克扣了一大笔钱。对方盯着桌上的本子，脸色阴沉得吓人，转身走了。";

    const report = checkFactConservation(before, after, ["林舟", "刘管事", "青铜账册"]);
    expect(report.ok).toBe(false);
    expect(report.lostNumbers).toEqual(expect.arrayContaining(["4800", "12%"]));
    expect(report.lostNames).toEqual(expect.arrayContaining(["刘管事", "青铜账册"]));
    expect(report.lostDialogueCount).toBe(1);
    expect(report.warnings.length).toBe(3);
  });

  it("原文中未出现的 protectedNames 不会误报丢失", () => {
    const before = "林舟把 30 两银票压在青石下。";
    const after = "林舟把那 30 两银票塞进青石缝里。";

    const report = checkFactConservation(before, after, ["林舟", "未出场角色"]);
    expect(report.ok).toBe(true);
    expect(report.lostNames).toEqual([]);
  });
});
