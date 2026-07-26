import { describe, expect, it } from "vitest";

import {
  checkBeatBudget,
  parseBeatBudget,
  renderBeatBudget,
  type BeatBudgetItem,
} from "./beat-budget";

/** 一组合规的情节点：合计 3000，落在 3000-3300 区间。 */
const validBeats: BeatBudgetItem[] = [
  { summary: "林舟在账本上发现四千八百灵石的转出记录", density: "dense", words: 600, function: "信息揭示" },
  { summary: "守门人拦下他，要求出示身份令牌", density: "normal", words: 500, function: "冲突升级" },
  { summary: "他绕到侧门，回忆师兄交代的暗号", density: "normal", words: 450 },
  { summary: "赶路至山门后山，天色转暗", density: "sparse", words: 100 },
  { summary: "第二次交涉失败，被推倒在石阶上", density: "dense", words: 700, function: "情绪低点" },
  { summary: "他掏出那枚旧铃，守门人脸色变了", density: "dense", words: 650, function: "反转" },
];

describe("checkBeatBudget — 总和校验", () => {
  it("合规预算返回 ok 且给出核对行", () => {
    const report = checkBeatBudget({ chapterTarget: 3000, beats: validBeats });
    expect(report.ok).toBe(true);
    expect(report.total).toBe(3000);
    expect(report.ceiling).toBe(3300);
    expect(report.denseCount).toBe(3);
    expect(report.budgetLine).toBe("预算合计：3000字（目标3000，范围3000-3300）");
    expect(report.findings).toEqual([]);
  });

  it("总和低于目标判 block，并要求拆细而非加字数", () => {
    const report = checkBeatBudget({
      chapterTarget: 3000,
      beats: [{ summary: "林舟发现账本异常记录", density: "dense", words: 800 }],
    });
    expect(report.ok).toBe(false);
    const finding = report.findings.find((item) => item.code === "sum-below-target");
    expect(finding?.severity).toBe("block");
    expect(finding?.whatHappened).toContain("800 字");
    expect(finding?.suggestedAction).toContain("拆得更细");
  });

  it("总和超出上浮上限判 block", () => {
    const report = checkBeatBudget({
      chapterTarget: 3000,
      beats: [{ summary: "林舟与守门人长谈整夜细节", density: "dense", words: 4000 }],
    });
    expect(report.ok).toBe(false);
    const finding = report.findings.find((item) => item.code === "sum-above-ceiling");
    expect(finding?.severity).toBe("block");
    expect(finding?.whatHappened).toContain("3300");
  });

  it("上浮系数可配置", () => {
    const report = checkBeatBudget({
      chapterTarget: 1000,
      beats: [{ summary: "林舟推门进入内院查看", density: "dense", words: 1400 }],
      overflowRatio: 0.5,
    });
    expect(report.ceiling).toBe(1500);
    expect(report.ok).toBe(true);
  });

  it("没有情节点判 block 并说明后果", () => {
    const report = checkBeatBudget({ chapterTarget: 3000, beats: [] });
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.code).toBe("no-beats");
    expect(report.findings[0]?.whyItMatters).toContain("平均用力");
    expect(report.summary).toContain("未拆情节点");
  });
});

describe("checkBeatBudget — 单点密度", () => {
  it("密点字数不足只 warn，不阻断", () => {
    const report = checkBeatBudget({
      chapterTarget: 1000,
      beats: [
        { summary: "林舟掏出旧铃摊在掌心", density: "dense", words: 120 },
        { summary: "守门人后退半步不再说话", density: "normal", words: 880 },
      ],
    });
    const finding = report.findings.find((item) => item.code === "dense-beat-too-thin");
    expect(finding?.severity).toBe("warn");
    expect(report.ok).toBe(true);
    expect(finding?.whatHappened).toContain("只分配了 120 字");
  });

  it("疏点写太长只 warn", () => {
    const report = checkBeatBudget({
      chapterTarget: 1000,
      beats: [
        { summary: "赶路穿过整片林子并观察沿途景物", density: "sparse", words: 400 },
        { summary: "林舟在山门前停下整理衣袖", density: "dense", words: 600 },
      ],
    });
    const finding = report.findings.find((item) => item.code === "sparse-beat-too-fat");
    expect(finding?.severity).toBe("warn");
    expect(finding?.whyItMatters).toContain("注水");
  });

  it("情节点描述过短会被指出", () => {
    const report = checkBeatBudget({
      chapterTarget: 500,
      beats: [{ summary: "发现线索", density: "dense", words: 500 }],
    });
    const finding = report.findings.find((item) => item.code === "vague-beat-summary");
    expect(finding?.severity).toBe("warn");
    expect(finding?.suggestedAction).toContain("4800");
  });

  it("全章无密点时提示确认是否呼吸章", () => {
    const report = checkBeatBudget({
      chapterTarget: 600,
      beats: [
        { summary: "两人在灶房闲聊今年的收成", density: "normal", words: 300 },
        { summary: "他把柴劈完靠在墙边歇息", density: "normal", words: 300 },
      ],
    });
    const finding = report.findings.find((item) => item.code === "no-dense-beat");
    expect(finding?.severity).toBe("warn");
    expect(finding?.suggestedAction).toContain("呼吸章");
    expect(report.ok).toBe(true);
  });

  it("每条 finding 都带完整人话三段式", () => {
    const report = checkBeatBudget({
      chapterTarget: 3000,
      beats: [{ summary: "短", density: "dense", words: 100 }],
    });
    expect(report.findings.length).toBeGreaterThanOrEqual(2);
    for (const finding of report.findings) {
      expect(finding.whatHappened.length).toBeGreaterThan(5);
      expect(finding.whyItMatters.length).toBeGreaterThan(5);
      expect(finding.suggestedAction.length).toBeGreaterThan(5);
    }
  });
});

describe("parseBeatBudget", () => {
  it("解析合法输入并归一 density", () => {
    const parsed = parseBeatBudget([
      { summary: "林舟发现账本异常", density: "dense", words: 300, function: "信息揭示" },
      { summary: "过场赶路", density: "不存在", words: 80 },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.function).toBe("信息揭示");
    expect(parsed[1]?.density).toBe("normal");
  });

  it("丢弃空条目，容忍脏字数", () => {
    const parsed = parseBeatBudget([{}, { summary: "有效条目内容", words: "x" }, null]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.words).toBe(0);
  });

  it("非数组返回空", () => {
    expect(parseBeatBudget("x")).toEqual([]);
    expect(parseBeatBudget(null)).toEqual([]);
  });
});

describe("renderBeatBudget", () => {
  it("渲染成带密度与字数的可注入文本", () => {
    const text = renderBeatBudget(validBeats.slice(0, 2));
    expect(text).toContain("1. 林舟在账本上发现四千八百灵石的转出记录【信息揭示·密600】");
    expect(text).toContain("2. 守门人拦下他，要求出示身份令牌【冲突升级·中500】");
  });

  it("空列表返回空串", () => {
    expect(renderBeatBudget([])).toBe("");
  });
});
