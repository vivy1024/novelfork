import type { LogicRiskRule } from "../types.js";

export const informationFlowRisk: LogicRiskRule = {
  id: "information-flow",
  name: "信息传播速度",
  category: "logic-risk",
  description: "检查角色和机构掌握信息的速度是否符合时代、交通和权限边界。",
  promptInjection: "角色只能通过当前 settingBase 允许的媒介获得信息，不得无解释即时掌握远方或机密消息。",
  riskType: "information-flow",
  appliesToSettingBases: [
    "victorian-industrial-occult",
    "classical-travelogue-jianghu",
    "historical-court-livelihood",
    "near-future-industrial-scifi",
  ],
  writerConstraint: "写到消息、情报、公告、传闻时，必须说明来源、媒介、延迟和权限。",
  auditQuestion: "本章是否出现信息传播速度超过所选 settingBase 边界的情况？",
  evidenceHints: ["远方消息即时抵达", "普通人掌握机密", "组织无成本同步行动", "角色提前知道未公开情报"],
  uncertainHandling: "标注为需要作者确认，并要求补充信息来源或调整事件时间差。",
};
