import type { PresetBundle } from "../types.js";

export const politicsCareerBundle: PresetBundle = {
  id: "politics-career",
  name: "官场权谋博弈",
  category: "bundle",
  description: "官场题材 + 沉稳内敛文风 + 体制运作基底。",
  promptInjection: "使用沉稳内敛语言，围绕权力博弈、人情世故、布局兑现展开，重点检查体制规则合理性、人物利益动机和程序正义。",
  compatibleGenres: ["politics"],
  tags: ["官场", "权谋", "博弈", "晋升"],
  genreIds: ["politics"],
  toneId: "austere-pragmatic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["institution-response", "character-motivation", "information-flow"],
  difficulty: "hard",
  prerequisites: ["作者需要了解基本的体制运作规则、晋升机制和官场潜规则。"],
  suitableFor: ["基层崛起", "改革派", "古代官场"],
  notSuitableFor: ["无政治元素的纯战斗", "轻松日常"],
};
