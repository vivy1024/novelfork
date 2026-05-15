export interface SevenTacticSuggestion {
  tacticId: number;
  name: string;
  type: "preset-prompt" | "system-prompt-patch" | "ui-action" | "workflow" | "metadata-action";
  template: string;
  ruleIds: string[];
}

export const SEVEN_TACTICS: SevenTacticSuggestion[] = [
  { tacticId: 1, name: "喂人类范文", type: "preset-prompt", template: "请参考人类范文，保留事实但改写节奏与细节：\n{referenceText}\n\n{text}", ruleIds: ["r05", "r06", "r07"] },
  { tacticId: 2, name: "明确人格提示词", type: "preset-prompt", template: "你是中文网文作者，口吻具体、场景化、少总结。请重写：\n{text}", ruleIds: ["r01", "r02", "r03"] },
  { tacticId: 3, name: "屏蔽鼓励人格", type: "system-prompt-patch", template: "不需要鼓励性语言，只指出问题和修改方向。", ruleIds: ["r01", "r03"] },
  { tacticId: 4, name: "人工改写润色", type: "ui-action", template: "打开可编辑 diff，逐句替换空话、书面对白与形容词堆叠。", ruleIds: ["r04", "r09", "r10", "r11"] },
  { tacticId: 5, name: "朱雀→降重→朱雀循环", type: "workflow", template: "先跑朱雀；按高亮处改写；二次朱雀复检。", ruleIds: ["r12"] },
  { tacticId: 6, name: "章节结尾钩子生成器", type: "preset-prompt", template: "为本章末尾生成一个具体动作驱动的钩子，不使用总结句。", ruleIds: ["r02", "r06"] },
  { tacticId: 7, name: "AI 使用标注", type: "metadata-action", template: "在章节 metadata 中记录 AI 辅助范围与人工改写说明。", ruleIds: ["r12"] },
];

export function suggestSevenTactics(ruleIds: string[]): SevenTacticSuggestion[] {
  const idSet = new Set(ruleIds);
  return SEVEN_TACTICS.filter((tactic) => tactic.ruleIds.some((ruleId) => idSet.has(ruleId)));
}
