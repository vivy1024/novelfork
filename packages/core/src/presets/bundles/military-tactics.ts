import type { PresetBundle } from "../types.js";

export const militaryTacticsBundle: PresetBundle = {
  id: "military-tactics",
  name: "军事战术热血",
  category: "bundle",
  description: "军事题材 + 硬朗热血文风 + 军队组织基底。",
  promptInjection: "使用硬朗热血语言，围绕战术执行、团队协作、军人荣誉展开，重点检查武器装备时代性、战术合理性和后勤补给。",
  compatibleGenres: ["military"],
  tags: ["军事", "战术", "热血", "团队"],
  genreIds: ["military"],
  toneId: "passionate-heroic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["technology-boundary", "institution-response", "geography-transport"],
  difficulty: "medium",
  prerequisites: ["作者需要了解基本军事知识、武器装备和战术原则。"],
  suitableFor: ["特种兵", "抗战", "未来战争"],
  notSuitableFor: ["无军事元素的纯修仙", "轻松日常"],
};
