import type { LogicRiskRule } from "../types.js";

export const anachronismRisk: LogicRiskRule = {
  id: "anachronism",
  name: "时代错位",
  category: "logic-risk",
  description: "检查文本是否出现超出所选时代/社会基底的物件、制度、话术或技术。",
  promptInjection: "不得无解释使用超出当前 settingBase 的物件、制度、技术和现代话术。",
  riskType: "anachronism",
  appliesToSettingBases: [
    "victorian-industrial-occult",
    "classical-travelogue-jianghu",
    "historical-court-livelihood",
  ],
  writerConstraint: "写作时先确认当前场景允许的物件、职业、制度和术语；若使用明显超时代元素，必须给出架空改造理由。",
  auditQuestion: "本章是否出现了超出所选 settingBase 边界的时代错位元素？",
  evidenceHints: ["现代支付/互联网词汇", "现代行政流程", "超时代武器或医疗手段", "不符合阶层的现代观念"],
  uncertainHandling: "标注为需要作者确认，并要求补充该元素在本世界存在的制度或技术来源。",
};
