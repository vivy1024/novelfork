/**
 * 写章请求消息：只验前端有没有如实把作者的决定交给叙述者。
 * 前端不编排工具，因此这里不测工具执行，只测消息内容。
 */
import { describe, expect, it } from "vitest";

import { buildWriteRequestMessage } from "./write-request";
import type { BeatBudgetItem } from "../../handlers/beat-budget";

const BEATS: readonly BeatBudgetItem[] = [
  { summary: "赵铭当场要求改标注", density: "dense", words: 1800, function: "冲突升级" },
  { summary: "回工位写脚本留底", density: "normal", words: 1200 },
];

describe("buildWriteRequestMessage", () => {
  it("没有作者节拍时保持原有消息，不追加任何内容", () => {
    const message = buildWriteRequestMessage({
      mode: "chapter",
      chapterNumber: 13,
      directive: "让薛行之拿到 B-17 原始数据",
      acceptFocusDefault: false,
    });

    expect(message).toBe([
      "请写第 13 章的正文。",
      "本章目标：让薛行之拿到 B-17 原始数据",
      "流程：write.preflight → scene.spec → pipeline.write。preflight 不通过就停下告诉我缺什么，不要先写。",
    ].join("\n"));
    expect(message).not.toContain("beatBudget");
  });

  it("空数组等同于没有节拍", () => {
    const withEmpty = buildWriteRequestMessage({
      mode: "chapter",
      chapterNumber: 13,
      directive: "推进主线",
      acceptFocusDefault: false,
      beatBudget: [],
    });
    const without = buildWriteRequestMessage({
      mode: "chapter",
      chapterNumber: 13,
      directive: "推进主线",
      acceptFocusDefault: false,
    });

    expect(withEmpty).toBe(without);
  });

  it("有作者节拍时要求原样传入 scene.spec，并附完整 JSON", () => {
    const message = buildWriteRequestMessage({
      mode: "chapter",
      chapterNumber: 13,
      directive: "让薛行之拿到 B-17 原始数据",
      acceptFocusDefault: false,
      beatBudget: BEATS,
    });

    expect(message).toContain("原样传入 scene.spec 的 beatBudget 参数");
    expect(message).toContain("不要另拟一套");
    expect(message).toContain("```json");
    expect(message).toContain(JSON.stringify(BEATS, null, 2));
    // 原有流程指令不能被节拍段落挤掉。
    expect(message).toContain("write.preflight → scene.spec → pipeline.write");
  });

  it("蓝图模式同样附带作者节拍", () => {
    const message = buildWriteRequestMessage({
      mode: "blueprint",
      chapterNumber: 13,
      directive: "先给场景蓝图",
      acceptFocusDefault: true,
      beatBudget: BEATS,
    });

    expect(message).toContain("先不要写正文");
    expect(message).toContain("（已确认采用当前焦点的默认目标）");
    expect(message).toContain(JSON.stringify(BEATS, null, 2));
  });
});
