import type { PresetBundle } from "../types.js";

export const transmigrationKnowledgeBundle: PresetBundle = {
  id: "transmigration-knowledge",
  name: "穿越知识碾压",
  category: "bundle",
  description: "穿越题材 + 从容睿智文风 + 异世发展基底。",
  promptInjection: "使用从容睿智语言，围绕现代知识转化、文化碰撞、势力建设展开，重点检查知识应用合理性、蝴蝶效应和文化适应过程。",
  compatibleGenres: ["transmigration"],
  tags: ["穿越", "知识", "发展", "碾压"],
  genreIds: ["transmigration"],
  toneId: "austere-pragmatic",
  settingBaseId: "sect-family-xianxia",
  logicRiskIds: ["anachronism", "technology-boundary", "economy-resource", "information-flow"],
  difficulty: "medium",
  prerequisites: ["作者需要明确穿越目标时代/世界的技术水平和社会结构。"],
  suitableFor: ["历史穿越", "异世穿越", "种田发展"],
  notSuitableFor: ["纯战斗爽文", "无需知识优势的设定"],
};
