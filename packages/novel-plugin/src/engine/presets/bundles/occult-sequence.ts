import type { PresetBundle } from "../types.js";

export const occultSequenceBundle: PresetBundle = {
  id: "occult-sequence",
  name: "诡秘序列晋升",
  category: "bundle",
  description: "诡秘题材 + 阴郁克制文风 + 序列途径基底。",
  promptInjection: "使用阴郁克制语言，围绕序列晋升、未知探索、代价与风险展开，重点检查力量体系代价、恐惧氛围营造和线索铺垫逻辑。",
  compatibleGenres: ["occult"],
  tags: ["诡秘", "序列", "克苏鲁", "悬疑"],
  genreIds: ["occult"],
  toneId: "tragic-solitude",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["technology-boundary", "information-flow", "character-motivation", "satisfaction-cost"],
  difficulty: "hard",
  prerequisites: ["作者需要明确序列/途径体系、晋升代价和世界观的恐怖层级。"],
  suitableFor: ["序列晋升", "蒸汽诡秘", "都市诡异"],
  notSuitableFor: ["轻松日常", "无代价的力量获取"],
};
