import type { PresetBundle } from "../types.js";

export const institutionalCultivationSatireBundle: PresetBundle = {
  id: "institutional-cultivation-satire",
  name: "制度修仙讽刺",
  category: "bundle",
  description: "都市/修仙题材 + 黑色幽默文风 + 现代平台经济讽刺基底。",
  promptInjection: "使用黑色幽默和制度话术错位，把修仙能力映射到贷款、绩效、审核和平台规则，重点检查制度逻辑、经济链条和爽点后果。",
  compatibleGenres: ["urban", "xianxia"],
  tags: ["讽刺", "制度", "平台经济", "修仙"],
  genreIds: ["urban", "xianxia"],
  toneId: "dark-humor-social",
  settingBaseId: "modern-platform-economy-satire",
  logicRiskIds: ["institution-response", "economy-resource", "satisfaction-cost", "character-motivation"],
  difficulty: "hard",
  prerequisites: ["作者需要明确现实映射对象、制度链条和架空安全距离。"],
  suitableFor: ["制度讽刺", "黑色幽默", "现实映射修仙"],
  notSuitableFor: ["纯段子合集", "不希望处理现实制度压力的轻松文"],
};
