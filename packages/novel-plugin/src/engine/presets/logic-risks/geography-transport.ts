import type { LogicRiskRule } from "../types.js";

export const geographyTransportRisk: LogicRiskRule = {
  id: "geography-transport",
  name: "地理/交通",
  category: "logic-risk",
  description: "检查人物移动、军政调动、商贸流通和旅途时间是否符合交通条件。",
  promptInjection: "人物和组织移动必须受当前 settingBase 的交通工具、距离、地形、安全和成本限制。",
  riskType: "geography-transport",
  appliesToSettingBases: [
    "classical-travelogue-jianghu",
    "historical-court-livelihood",
    "sect-family-xianxia",
    "victorian-industrial-occult",
  ],
  writerConstraint: "写到赶路、调兵、送信、商贸和逃亡时，要考虑路线、时间、成本和途中风险。",
  auditQuestion: "本章是否出现移动速度、运输能力或地理距离不符合 settingBase 的情况？",
  evidenceHints: ["一天跨越过大距离", "军队无粮草移动", "商贸无运输成本", "角色无解释出现在远方"],
  uncertainHandling: "标注为需要作者确认，并要求补充路线、交通工具、时间跨度或传送条件。",
};
