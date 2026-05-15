import type { PresetBundle } from "../types.js";

export const farmingDevelopmentBundle: PresetBundle = {
  id: "farming-development",
  name: "种田领地经营",
  category: "bundle",
  description: "种田题材 + 温暖从容文风 + 领地建设基底。",
  promptInjection: "使用温暖从容语言，围绕领地建设、资源积累、人才招揽展开，重点检查建设逻辑合理性、资源来源和发展节奏。",
  compatibleGenres: ["farming"],
  tags: ["种田", "经营", "建设", "发展"],
  genreIds: ["farming"],
  toneId: "austere-pragmatic",
  settingBaseId: "sect-family-xianxia",
  logicRiskIds: ["economy-resource", "technology-boundary", "institution-response"],
  difficulty: "easy",
  prerequisites: ["作者需要明确领地初始条件、可用资源和发展路线图。"],
  suitableFor: ["领地经营", "商业种田", "宗门建设"],
  notSuitableFor: ["纯战斗爽文", "快节奏冒险"],
};
