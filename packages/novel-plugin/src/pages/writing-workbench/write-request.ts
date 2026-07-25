/**
 * 把「生成蓝图 / 直接写章」按钮翻译成给叙述者的明确指令。
 *
 * 纪律：前端不自己编排工具执行，也不绕过权限确认；
 * 它只把用户已确认的一句话指示 + 章号交给叙述者，工具链仍由 Runtime 的 Agent Loop 跑。
 */

export interface WriteRequestPayload {
  readonly mode: "blueprint" | "chapter";
  readonly chapterNumber: number;
  readonly directive: string;
  readonly acceptFocusDefault: boolean;
}

/** 生成发给叙述者的消息文本。 */
export function buildWriteRequestMessage(payload: WriteRequestPayload): string {
  const chapter = payload.chapterNumber > 0 ? `第 ${payload.chapterNumber} 章` : "下一章";
  const directive = payload.directive.trim();
  const accept = payload.acceptFocusDefault ? "（已确认采用当前焦点的默认目标）" : "";

  if (payload.mode === "blueprint") {
    return [
      `请为${chapter}生成场景蓝图，先不要写正文。`,
      `本章目标：${directive}${accept}`,
      "流程：write.preflight 通过后调用 scene.spec；蓝图给我确认后再写正文。",
    ].join("\n");
  }

  return [
    `请写${chapter}的正文。`,
    `本章目标：${directive}${accept}`,
    "流程：write.preflight → scene.spec → pipeline.write。preflight 不通过就停下告诉我缺什么，不要先写。",
  ].join("\n");
}
