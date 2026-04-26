import type { LogicRiskRule } from "../types.js";

export const characterMotivationRisk: LogicRiskRule = {
  id: "character-motivation",
  name: "人物动机与阶层行为",
  category: "logic-risk",
  description: "检查角色行为是否符合其身份、阶层、信息、利益、恐惧、关系和前史。",
  promptInjection: "角色行动必须符合其已知信息、身份位置、利益和恐惧；不得只为推动剧情突然改变立场。",
  riskType: "character-motivation",
  appliesToSettingBases: [
    "victorian-industrial-occult",
    "classical-travelogue-jianghu",
    "sect-family-xianxia",
    "modern-platform-economy-satire",
    "historical-court-livelihood",
    "near-future-industrial-scifi",
  ],
  writerConstraint: "写角色选择时，要明确其知道什么、害怕什么、想得到什么、会失去什么。",
  auditQuestion: "本章是否出现角色只为剧情服务而突然违背身份、利益或前史？",
  evidenceHints: ["反派突然降智", "配角无理由牺牲", "底层角色无缘由熟悉上层规则", "主角无代价改变核心价值观"],
  uncertainHandling: "标注为需要作者确认，并要求补充动机、信息来源或前史铺垫。",
};
