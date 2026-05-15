import type { PresetBundle } from "../types.js";

export const cthulhuInvestigatorBundle: PresetBundle = {
  id: "cthulhu-investigator",
  name: "克苏鲁调查员",
  category: "bundle",
  description: "克苏鲁题材 + 阴郁压抑文风 + 禁忌知识基底。",
  promptInjection: "使用阴郁压抑语言，围绕超自然调查、理智消耗、禁忌真相展开，重点检查恐惧层次递进、人类渺小感和理智变化表现。",
  compatibleGenres: ["cthulhu"],
  tags: ["克苏鲁", "调查", "恐惧", "理智"],
  genreIds: ["cthulhu"],
  toneId: "tragic-solitude",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["information-flow", "character-motivation", "satisfaction-cost"],
  difficulty: "hard",
  prerequisites: ["作者需要了解克苏鲁神话体系、恐惧营造技巧和理智机制设计。"],
  suitableFor: ["调查员模式", "历史克苏鲁", "生存克苏鲁"],
  notSuitableFor: ["主角轻松碾压的爽文", "轻松日常"],
};
