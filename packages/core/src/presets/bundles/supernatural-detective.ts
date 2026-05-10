import type { PresetBundle } from "../types.js";

export const supernaturalDetectiveBundle: PresetBundle = {
  id: "supernatural-detective",
  name: "灵异侦探驱邪",
  category: "bundle",
  description: "灵异题材 + 悬疑紧张文风 + 民俗超自然基底。",
  promptInjection: "使用悬疑紧张语言，围绕灵异调查、驱邪除魔、民俗传说展开，重点检查鬼怪规则一致性、恐怖氛围铺垫和因果逻辑。",
  compatibleGenres: ["supernatural"],
  tags: ["灵异", "侦探", "驱邪", "民俗"],
  genreIds: ["supernatural"],
  toneId: "tragic-solitude",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["information-flow", "character-motivation", "satisfaction-cost"],
  difficulty: "medium",
  prerequisites: ["作者需要明确灵异规则体系、主角能力边界和恐怖氛围营造方法。"],
  suitableFor: ["灵异侦探", "民俗灵异", "都市灵异"],
  notSuitableFor: ["无超自然元素的纯推理", "轻松日常"],
};
