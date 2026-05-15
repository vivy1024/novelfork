import type { PresetBundle } from "../types.js";

export const infiniteFlowSurvivalBundle: PresetBundle = {
  id: "infinite-flow-survival",
  name: "无限流副本求生",
  category: "bundle",
  description: "无限流题材 + 紧张悬疑文风 + 副本规则基底。",
  promptInjection: "使用紧张悬疑语言，围绕副本规则解谜、极限生存、队友博弈展开，重点检查副本规则自洽性、主线推进和角色情感重量。",
  compatibleGenres: ["infinite-flow"],
  tags: ["无限流", "副本", "解谜", "生存"],
  genreIds: ["infinite-flow"],
  toneId: "austere-pragmatic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["information-flow", "character-motivation", "satisfaction-cost"],
  difficulty: "hard",
  prerequisites: ["作者需要明确副本规则设计方法、主线悬念和角色淘汰机制。"],
  suitableFor: ["恐怖副本", "规则怪谈", "竞技无限"],
  notSuitableFor: ["轻松日常", "无规则限制的纯战斗"],
};
