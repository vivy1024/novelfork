import { describe, expect, it } from "vitest";

import { detectZhAiFlavor } from "./detector";
import { countNarrativeChars, maskQuoted, tailWindow } from "./masking";

/** 生成足够长的中性正文，用于把密度分母做到千字级。 */
function filler(times: number): string {
  return "林舟沿着石阶往上走，风从谷口灌进来，吹得他衣袖发响。".repeat(times);
}

describe("maskQuoted", () => {
  it("遮住引号内内容且保持长度不变", () => {
    const text = "他说“不是我，而是他”，然后转身。";
    const masked = maskQuoted(text);
    expect(masked.length).toBe(text.length);
    expect(masked).not.toContain("不是我");
    expect(masked).toContain("他说");
    expect(masked).toContain("然后转身");
  });

  it("支持直角引号与英文引号", () => {
    expect(maskQuoted("「不是A，而是B」")).not.toContain("不是A");
    expect(maskQuoted('"不是A，而是B"')).not.toContain("不是A");
  });

  it("未闭合引号只遮到行尾，不吞掉后文", () => {
    const masked = maskQuoted("他说“还没说完\n第二行不是A，而是B。");
    expect(masked).toContain("第二行不是A");
  });

  it("countNarrativeChars 不计入占位符与空白", () => {
    // 遮罩只清引号内文字，引号符号本身保留：他/说/“/”/。= 5
    const masked = maskQuoted("他说“一二三四五”。");
    expect(countNarrativeChars(masked)).toBe(5);
    // 台词越长也不增加叙述层字数
    expect(countNarrativeChars(maskQuoted("他说“一二三四五六七八九十”。"))).toBe(5);
  });
});

describe("tailWindow", () => {
  it("短文本原样返回", () => {
    expect(tailWindow("abc", 600)).toBe("abc");
  });

  it("长文本只取末尾", () => {
    const tail = tailWindow(`${"甲".repeat(700)}结尾句`, 10);
    expect(tail).toContain("结尾句");
    expect([...tail]).toHaveLength(10);
  });
});

describe("语料校准边界", () => {
  /**
   * 下面两条曾被设为 blocking，被 915 章真人长篇否掉：
   * 破折号真人 100% 章节在用（文风取向），「不是A而是B」真人 12%。
   * 阻断它们会天天误报，因此只能是 advisory。
   */
  it("单次「不是A，而是B」不阻断", () => {
    const report = detectZhAiFlavor(`${filler(20)}那不是恐惧，而是一种更冷的东西。`);
    expect(report.blocking.some((item) => item.ruleId === "not-is-comparison")).toBe(false);
  });

  it("破折号不阻断，只在高密度时提示", () => {
    const few = detectZhAiFlavor(`${filler(30)}他停住——门开了。`);
    expect(few.blocking.some((item) => item.ruleId === "em-dash-density")).toBe(false);
    expect(few.advisory.some((item) => item.ruleId === "em-dash-density")).toBe(false);

    const many = detectZhAiFlavor("他停住——门开了——风灌进来——灯灭了——没人说话——他后退。".repeat(2));
    expect(many.advisory.some((item) => item.ruleId === "em-dash-density")).toBe(true);
  });

  it("英文双连字符不算破折号（真人稿里是分隔线）", () => {
    const report = detectZhAiFlavor(`${filler(20)}${"--".repeat(20)}`);
    expect(report.advisory.some((item) => item.ruleId === "em-dash-density")).toBe(false);
  });

  it("常规内心戏「心中暗道」不计入身体反应陈词", () => {
    const report = detectZhAiFlavor("他心中暗道不好。".repeat(8));
    expect(report.advisory.some((item) => item.ruleId === "body-cliche")).toBe(false);
  });
});

describe("毒句式（blocking）", () => {
  it("检出反序「是A，不是B」但不误伤「还是/只是/就是」", () => {
    const bad = detectZhAiFlavor(`${filler(20)}这是选择，不是妥协。`);
    expect(bad.blocking.some((item) => item.ruleId === "reverse-not-is")).toBe(true);

    const ok = detectZhAiFlavor(`${filler(20)}他还是走了，不是因为怕。他只是累，不是想放弃。`);
    expect(ok.blocking.some((item) => item.ruleId === "reverse-not-is")).toBe(false);
  });

  it("检出无情绪声线", () => {
    const report = detectZhAiFlavor(`${filler(20)}他声音不大，却带着不容拒绝的意思。`);
    expect(report.blocking.some((item) => item.ruleId === "voice-contrast")).toBe(true);
  });

  it("检出否定排比，单个否定不报", () => {
    const bad = detectZhAiFlavor(`${filler(20)}没有灯，没有人，没有一点声音。`);
    expect(bad.blocking.some((item) => item.ruleId === "negation-parade")).toBe(true);

    const ok = detectZhAiFlavor(`${filler(20)}屋里没有灯。`);
    expect(ok.blocking.some((item) => item.ruleId === "negation-parade")).toBe(false);
  });

  it("章尾预告腔只在文末窗口内判定", () => {
    const atTail = detectZhAiFlavor(`${filler(20)}他推开门。他不知道的是，门后还有一个人。`);
    expect(atTail.blocking.some((item) => item.ruleId === "trailer-ending")).toBe(true);

    // 同样的句子出现在开头、且距文末超过窗口，则不报
    const atHead = detectZhAiFlavor(`他不知道的是，门后还有人。${filler(60)}`);
    expect(atHead.blocking.some((item) => item.ruleId === "trailer-ending")).toBe(false);
  });

  it("检出章尾盖章式总结", () => {
    const report = detectZhAiFlavor(`${filler(20)}这一夜注定无人入睡。`);
    expect(report.blocking.some((item) => item.ruleId === "trailer-summary")).toBe(true);
  });

  it("台词里的毒句式不计入", () => {
    const inSpeech = detectZhAiFlavor(`${filler(20)}他开口：“没有灯，没有人，没有声音。”`);
    expect(inSpeech.blocking.some((item) => item.ruleId === "negation-parade")).toBe(false);
  });

  it("五条 blocking 规则全部真人低频（语料校准结论）", () => {
    // 真人 915 章命中率：反序对比 1%、否定排比 3%、其余 0%
    const clean = detectZhAiFlavor(filler(40));
    expect(clean.blocking).toEqual([]);
  });
});

describe("密度型（advisory）", () => {
  it("低密度弱化副词不报", () => {
    const report = detectZhAiFlavor(`${filler(40)}他缓缓抬头。`);
    expect(report.advisory.some((item) => item.ruleId === "weak-adverb-density")).toBe(false);
  });

  it("高密度弱化副词报出并给出次/千字", () => {
    const report = detectZhAiFlavor(`${"他缓缓抬头，微微皱眉，轻轻叹了口气，淡淡地说。".repeat(6)}`);
    const hit = report.advisory.find((item) => item.ruleId === "weak-adverb-density");
    expect(hit).toBeTruthy();
    expect(hit!.perThousand!).toBeGreaterThanOrEqual(3);
    expect(hit!.samples.length).toBeLessThanOrEqual(5);
  });

  it("身体反应陈词达阈值才报", () => {
    const report = detectZhAiFlavor("他深吸一口气，眼中闪过一丝寒意，嘴角勾起。".repeat(4));
    expect(report.advisory.some((item) => item.ruleId === "body-cliche")).toBe(true);
  });
});

describe("白名单", () => {
  it("主角绰号叫「缓缓」时不计入弱化副词", () => {
    const text = "缓缓抬头看他。缓缓不说话。缓缓转身走了。缓缓又停下。缓缓看着门。";
    const without = detectZhAiFlavor(text);
    const withList = detectZhAiFlavor(text, { whitelist: ["缓缓"] });
    expect(without.advisory.some((item) => item.ruleId === "weak-adverb-density")).toBe(true);
    expect(withList.advisory.some((item) => item.ruleId === "weak-adverb-density")).toBe(false);
  });
});

describe("反向门禁（过度压缩）", () => {
  it("微动作尾巴高密度归入 overcompressed 而非 advisory", () => {
    const report = detectZhAiFlavor("他停了一下。看了下门。皱了下眉。抬了一下手。又停了下。".repeat(3));
    expect(report.overcompressed.some((item) => item.ruleId === "micro-action-tic")).toBe(true);
    expect(report.advisory.some((item) => item.ruleId === "micro-action-tic")).toBe(false);
    expect(report.summary).toContain("过度压缩");
  });
});

describe("分档与删除比例", () => {
  it("干净文本判 clean，删除上限为 0", () => {
    const report = detectZhAiFlavor(filler(30));
    expect(report.grade).toBe("clean");
    expect(report.maxDeleteRatio).toBe(0);
    expect(report.summary).toContain("未检出");
  });

  it("毒句式命中至少判中度，不会被归为轻度", () => {
    const report = detectZhAiFlavor(`${filler(30)}没有灯，没有人，没有声音。`);
    expect(report.blocking.length).toBeGreaterThan(0);
    expect(report.grade).toBe("moderate");
    expect(report.maxDeleteRatio).toBe(0.25);
  });

  it("重度对应 35% 删除上限", () => {
    const report = detectZhAiFlavor("他缓缓抬头，微微皱眉，轻轻叹气，淡淡地说，悄悄退开。".repeat(10));
    expect(report.grade).toBe("severe");
    expect(report.maxDeleteRatio).toBe(0.35);
  });

  it("报告始终带叙述层字数，便于核对密度", () => {
    const report = detectZhAiFlavor(filler(10));
    expect(report.narrativeChars).toBeGreaterThan(100);
  });

  it("空文本不抛异常", () => {
    const report = detectZhAiFlavor("");
    expect(report.grade).toBe("clean");
    expect(report.narrativeChars).toBe(0);
  });
});
