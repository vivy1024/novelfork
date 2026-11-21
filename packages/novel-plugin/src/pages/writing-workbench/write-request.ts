/**
 * 把「生成蓝图 / 直接写章」按钮翻译成给叙述者的明确指令。
 *
 * 纪律：前端不自己编排工具执行，也不绕过权限确认；
 * 它只把用户已确认的一句话指示 + 章号交给叙述者，工具链仍由 Runtime 的 Agent Loop 跑。
 */

import type { BeatBudgetItem } from "../../handlers/beat-budget";
import { toWireToolName } from "../../engine/workflows/run-brief";

export interface WriteRequestPayload {
  readonly mode: "blueprint" | "chapter";
  readonly chapterNumber: number;
  readonly directive: string;
  readonly acceptFocusDefault: boolean;
  /**
   * 作者在写作面板里编辑好的情节点预算。
   *
   * 非空时会原样附在消息里，要求叙述者传入 chapter.blueprint 的 sceneSpec.beatBudget。
   */
  readonly beatBudget?: readonly BeatBudgetItem[];
  /** 作者显式点选的机制卡 ID 列表（直通 chapter.blueprint 的 pinnedMechanismIds）。 */
  readonly pinnedMechanismIds?: readonly string[];
  /** 作者显式点选的文风范文 ID 列表（直通 chapter.preflight 的 pinnedSampleIds）。 */
  readonly pinnedSampleIds?: readonly string[];
  /** 作者指定的信息增量锚点（直通 chapter.blueprint 的 infoAnchors）。 */
  readonly infoAnchors?: readonly string[];
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

/** 作者已编辑节拍时追加的指令段；为空则完全不改变原有消息。 */
function beatBudgetLines(beats: readonly BeatBudgetItem[] | undefined): string[] {
  if (!beats || beats.length === 0) return [];
  return [
    "",
    `我已经排好本章 ${beats.length} 个情节点的字数预算，请原样传入 ${toWireToolName("chapter.blueprint")} 的 sceneSpec.beatBudget 参数，不要另拟一套：`,
    "```json",
    JSON.stringify(beats, null, 2),
    "```",
  ];
}

/** 作者在筹备台点选机制卡 / 范文 / 信息锚点时的结构化直通参数段；均为空时不输出任何额外行。 */
function structuredPrepLines(payload: WriteRequestPayload): string[] {
  const pinnedMechanismIds = normalizeStringList(payload.pinnedMechanismIds);
  const pinnedSampleIds = normalizeStringList(payload.pinnedSampleIds);
  const infoAnchors = normalizeStringList(payload.infoAnchors);
  if (pinnedMechanismIds.length === 0 && pinnedSampleIds.length === 0 && infoAnchors.length === 0) {
    return [];
  }

  const lines: string[] = [
    "",
    "【筹备台结构化直通参数（调用工具时请原样传入，并按高密度施工控制卡产出 microBeats + infoPayloads + reactionPairs）】",
  ];
  if (pinnedSampleIds.length > 0) {
    lines.push(
      `- 调用 ${toWireToolName("chapter.preflight")} 时原样传入 \`pinnedSampleIds\`：${JSON.stringify(pinnedSampleIds)}`,
    );
  }
  if (pinnedMechanismIds.length > 0) {
    lines.push(
      `- 调用 ${toWireToolName("chapter.blueprint")} 时原样传入 \`pinnedMechanismIds\`：${JSON.stringify(pinnedMechanismIds)}`,
    );
  }
  if (infoAnchors.length > 0) {
    lines.push(
      `- 调用 ${toWireToolName("chapter.blueprint")} 时原样传入 \`infoAnchors\`：${JSON.stringify(infoAnchors)}`,
    );
  }
  lines.push(
    `- 提交 ${toWireToolName("chapter.blueprint")} 的每个场景请包含 \`microBeats\`（因果小节拍）与 \`infoPayloads\`（具体信息增量/物证/规则细节），杜绝空洞大词与环境描写注水。`,
  );
  return lines;
}

/** 生成发给叙述者的消息文本。 */
export function buildWriteRequestMessage(payload: WriteRequestPayload): string {
  const chapter = payload.chapterNumber > 0 ? `第 ${payload.chapterNumber} 章` : "下一章";
  const directive = payload.directive.trim();
  const accept = payload.acceptFocusDefault ? "（已确认采用当前焦点的默认目标）" : "";
  const beats = beatBudgetLines(payload.beatBudget);
  const prep = structuredPrepLines(payload);

  if (payload.mode === "blueprint") {
    return [
      `请为${chapter}生成场景蓝图，先不要写正文。`,
      `本章目标：${directive}${accept}`,
      `流程：${toWireToolName("chapter.preflight")} 通过后调用 ${toWireToolName("chapter.blueprint")}；蓝图给我确认后再写正文。`,
      ...beats,
      ...prep,
    ].join("\n");
  }

  return [
    `请写${chapter}的正文。`,
    `本章目标：${directive}${accept}`,
    `流程：${toWireToolName("chapter.preflight")} → ${toWireToolName("chapter.blueprint")} → 原生 Write 按预检返回的 targetChapterPath 写入章节文件 → ${toWireToolName("chapter.commit")}（mode=new，filePath 为刚写入的章节相对路径）。预检不通过就停下告诉我缺什么，不要先写。`,
    ...beats,
    ...prep,
  ].join("\n");
}
