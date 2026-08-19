/**
 * 把「生成蓝图 / 直接写章」按钮翻译成给叙述者的明确指令。
 *
 * 纪律：前端不自己编排工具执行，也不绕过权限确认；
 * 它只把用户已确认的一句话指示 + 章号交给叙述者，工具链仍由 Runtime 的 Agent Loop 跑。
 */

import type { BeatBudgetItem } from "../../handlers/beat-budget";

export interface WriteRequestPayload {
  readonly mode: "blueprint" | "chapter";
  readonly chapterNumber: number;
  readonly directive: string;
  readonly acceptFocusDefault: boolean;
  /**
   * 作者在写作面板里编辑好的情节点预算。
   *
   * 非空时会原样附在消息里，要求叙述者把它作为 scene.spec 的 beatBudget 传入
   * （scene.spec 的入参注释写明：给了就不让模型另拟一套）。
   */
  readonly beatBudget?: readonly BeatBudgetItem[];
}

/** 作者已编辑节拍时追加的指令段；为空则完全不改变原有消息。 */
function beatBudgetLines(beats: readonly BeatBudgetItem[] | undefined): string[] {
  if (!beats || beats.length === 0) return [];
  return [
    "",
    `我已经排好本章 ${beats.length} 个情节点的字数预算，请原样传入 scene.spec 的 beatBudget 参数，不要另拟一套：`,
    "```json",
    JSON.stringify(beats, null, 2),
    "```",
  ];
}

/** 生成发给叙述者的消息文本。 */
export function buildWriteRequestMessage(payload: WriteRequestPayload): string {
  const chapter = payload.chapterNumber > 0 ? `第 ${payload.chapterNumber} 章` : "下一章";
  const directive = payload.directive.trim();
  const accept = payload.acceptFocusDefault ? "（已确认采用当前焦点的默认目标）" : "";
  const beats = beatBudgetLines(payload.beatBudget);

  if (payload.mode === "blueprint") {
    return [
      `请为${chapter}生成场景蓝图，先不要写正文。`,
      `本章目标：${directive}${accept}`,
      "流程：write.preflight 通过后调用 scene.spec；蓝图给我确认后再写正文。",
      ...beats,
    ].join("\n");
  }

  return [
    `请写${chapter}的正文。`,
    `本章目标：${directive}${accept}`,
    "流程：write.preflight → scene.spec → pipeline.write。preflight 不通过就停下告诉我缺什么，不要先写。",
    ...beats,
  ].join("\n");
}
