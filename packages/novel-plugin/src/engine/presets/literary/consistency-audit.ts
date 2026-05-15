import type { Preset } from "../types.js";

export const consistencyAuditLiteraryPreset: Preset = {
  id: "literary-consistency-audit",
  name: "一致性审计",
  category: "literary",
  description: "每隔固定章节检查人设、时间线、伏笔和设定一致性。",
  promptInjection: "写作时主动维护人设、时间线、设定和伏笔一致性；每 5 章建议审计一次人物行为、事件顺序、设定边界和未回收伏笔。",
  tags: ["一致性", "审计"],
  postWriteChecks: [
    {
      checkId: "literary-consistency-audit",
      name: "一致性审计提示",
      description: "提示后续章节审计聚合人设、时间线和伏笔风险。",
      checkType: "custom",
      threshold: 5,
      suggestion: "每 5 章执行一次人设/时间线/伏笔一致性检查。",
    },
  ],
};
