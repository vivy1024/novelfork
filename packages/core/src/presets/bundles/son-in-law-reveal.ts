import type { PresetBundle } from "../types.js";

export const sonInLawRevealBundle: PresetBundle = {
  id: "son-in-law-reveal",
  name: "赘婿身份逆转",
  category: "bundle",
  description: "赘婿题材 + 隐忍爆发文风 + 都市豪门基底。",
  promptInjection: "使用隐忍爆发语言，围绕身份隐藏、打脸逆转、势力展示展开，重点检查隐藏身份合理性、打脸铺垫层次和女主角色深度。",
  compatibleGenres: ["son-in-law"],
  tags: ["赘婿", "逆转", "打脸", "身份"],
  genreIds: ["son-in-law"],
  toneId: "passionate-heroic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["character-motivation", "information-flow", "satisfaction-cost"],
  difficulty: "easy",
  prerequisites: ["作者需要明确主角真实身份、隐藏原因和打脸节奏规划。"],
  suitableFor: ["豪门赘婿", "都市赘婿", "古代赘婿"],
  notSuitableFor: ["无身份反差的设定", "纯修仙战斗"],
};
