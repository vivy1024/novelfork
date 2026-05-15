import type { PresetBundle } from "../types.js";

export const cyberpunkStreetBundle: PresetBundle = {
  id: "cyberpunk-street",
  name: "赛博朋克街头",
  category: "bundle",
  description: "赛博朋克题材 + 冷硬颓废文风 + 高科技低生活基底。",
  promptInjection: "使用冷硬颓废语言，围绕义体改造、企业阴谋、底层反抗展开，重点检查技术代价、社会结构和人性边界探讨。",
  compatibleGenres: ["cyberpunk"],
  tags: ["赛博朋克", "义体", "企业", "反抗"],
  genreIds: ["cyberpunk"],
  toneId: "austere-pragmatic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["technology-boundary", "institution-response", "economy-resource", "character-motivation"],
  difficulty: "medium",
  prerequisites: ["作者需要明确技术水平、企业权力结构和义体改造的代价体系。"],
  suitableFor: ["街头佣兵", "企业间谍", "黑客反抗"],
  notSuitableFor: ["无科技元素的古代背景", "轻松日常"],
};
