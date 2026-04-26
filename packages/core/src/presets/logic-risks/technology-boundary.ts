import type { LogicRiskRule } from "../types.js";

export const technologyBoundaryRisk: LogicRiskRule = {
  id: "technology-boundary",
  name: "技术/魔法边界",
  category: "logic-risk",
  description: "检查技术、魔法、神秘学、修仙能力或 AI 系统是否有输入、限制、代价和失败模式。",
  promptInjection: "任何技术、魔法或超凡能力都必须有边界，不能成为无成本万能解释。",
  riskType: "technology-boundary",
  appliesToSettingBases: [
    "victorian-industrial-occult",
    "sect-family-xianxia",
    "near-future-industrial-scifi",
  ],
  writerConstraint: "写到能力或技术解决问题时，要说明限制、代价、条件、可失败之处和对世界秩序的影响。",
  auditQuestion: "本章是否用技术/魔法无成本解决所有问题，导致世界规则失效？",
  evidenceHints: ["能力无限使用", "技术无能耗维护", "神秘学替代所有调查", "境界/系统没有副作用"],
  uncertainHandling: "标注为需要作者确认，并要求补充能力限制、成本或失败条件。",
};
