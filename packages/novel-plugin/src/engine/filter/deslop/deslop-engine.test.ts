/**
 * 纯规则去 AI 味引擎的契约测试。
 *
 * 关键约束有两条：
 * 1. 自动改写只动「怎么说」，不得删掉剧情信息；
 * 2. 需要语义判断的项**只标注不改**，正文里必须原样保留，否则规则就在瞎猜。
 */

import { describe, expect, it } from "vitest";
import { deslopText } from "./deslop-engine.js";

describe("确定性改写", () => {
  it("删掉套词后正文变短且不留断口", () => {
    const result = deslopText("他不禁抬起头，不由自主地看向门口。");

    expect(result.text).not.toContain("不禁");
    expect(result.text).not.toContain("不由自主");
    expect(result.text).toContain("抬起头");
    expect(result.text).toContain("看向门口");
    expect(result.stats.resultLength).toBeLessThan(result.stats.originalLength);
  });

  it("否定翻转句式只保留后项", () => {
    const result = deslopText("他不是冷漠，而是绝望。");

    expect(result.text).not.toContain("不是冷漠");
    expect(result.text).toContain("绝望");
    expect(result.edits.some((edit) => edit.rule === "negation-reversal")).toBe(true);
  });

  it("表情与心理套词换成可见动作", () => {
    const result = deslopText("她眼中闪过一丝悲伤，心中涌起一股暖流。");

    expect(result.text).not.toContain("眼中闪过");
    expect(result.text).not.toContain("涌起");
    expect(result.text).toContain("垂下眼");
  });

  it("破折号与省略号收敛为常规标点", () => {
    const result = deslopText("他想说什么——最后什么也没说……");

    expect(result.text).not.toContain("——");
    expect(result.text).not.toContain("……");
  });

  it("弱化副词按预算保留自然使用，只删超额复现", () => {
    const withinBudget = deslopText("他缓缓抬手。".repeat(1) + "风轻轻吹过。");
    expect(withinBudget.edits.filter((edit) => edit.rule === "weak-adverb-budget")).toHaveLength(0);

    const overBudget = deslopText("他缓缓抬手，缓缓转身，微微皱眉，轻轻叹气，淡淡开口。");
    expect(overBudget.edits.some((edit) => edit.rule === "weak-adverb-budget")).toBe(true);
  });

  it("白名单命中的词不动", () => {
    const result = deslopText("缓缓是他的绰号。缓缓抬手，缓缓转身，缓缓皱眉。", {
      whitelist: ["缓缓"],
    });

    expect(result.edits.filter((edit) => edit.rule === "weak-adverb-budget")).toHaveLength(0);
  });
});

describe("需语义判断的项只标注不改", () => {
  it("情绪告知被标注，但正文原样保留", () => {
    const source = "他感到紧张。";
    const result = deslopText(source);

    expect(result.text).toContain("感到紧张");
    const flag = result.manualFlags.find((item) => item.rule === "emotion-telling");
    expect(flag).toBeTruthy();
    expect(flag?.instruction).toContain("身体反应");
  });

  it("上帝视角剧透被标注，不自动删除", () => {
    const result = deslopText("他走出门。他不知道的是，风暴即将来临。");

    expect(result.text).toContain("他不知道的是");
    expect(result.manualFlags.some((item) => item.rule === "omniscient-spoiler")).toBe(true);
  });

  it("连续同主语开头只定位不重写", () => {
    const source = "他推开门。他看见桌子。他坐下来。";
    const result = deslopText(source);

    const flag = result.manualFlags.find((item) => item.rule === "consecutive-subject");
    expect(flag).toBeTruthy();
    expect(flag?.reason).toContain("他");
    // 句首必须原样保留：规则不猜该换成什么。
    expect(result.text).toContain("他推开门");
  });

  it("每条标注都带可执行指示，供叙述者直接消费", () => {
    const result = deslopText("他感到紧张。之所以这样是因为门外有人。首先，他检查了锁。");

    expect(result.manualFlags.length).toBeGreaterThan(0);
    for (const flag of result.manualFlags) {
      expect(flag.instruction.length).toBeGreaterThan(0);
      expect(flag.reason.length).toBeGreaterThan(0);
      expect(flag.excerpt.length).toBeGreaterThan(0);
    }
  });
});

describe("整体不变量", () => {
  it("干净正文不产生任何改动", () => {
    const source = "韩立把药锄扛在肩上，鞋底沾着泥。老仆问他要不要添饭，他摇头，只说炉火别灭。";
    const result = deslopText(source);

    expect(result.text).toBe(source);
    expect(result.edits).toHaveLength(0);
  });

  it("重叠命中只应用一条规则，不产生错位", () => {
    const result = deslopText("他深吸一口气，不禁深吸一口气。");

    const ranges = result.edits.map((edit) => [edit.start, edit.end] as const);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i][0]).toBeGreaterThanOrEqual(ranges[i - 1][1]);
    }
  });

  it("空正文安全返回", () => {
    const result = deslopText("");

    expect(result.text).toBe("");
    expect(result.edits).toHaveLength(0);
    expect(result.manualFlags).toHaveLength(0);
  });
});
