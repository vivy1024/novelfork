import type { PresetBundle } from "../types.js";

export const cultivationHardcoreBundle: PresetBundle = {
  id: "cultivation-hardcore",
  name: "修真硬核体系",
  category: "bundle",
  description: "修真题材 + 严谨克制文风 + 硬核修炼体系基底。",
  promptInjection: "使用严谨克制语言，围绕功法修炼、丹药炼制、法宝祭炼展开，重点检查修炼体系精密性、资源经济和境界突破积累感。",
  compatibleGenres: ["cultivation"],
  tags: ["修真", "硬核", "体系", "炼丹"],
  genreIds: ["cultivation"],
  toneId: "tragic-solitude",
  settingBaseId: "sect-family-xianxia",
  logicRiskIds: ["economy-resource", "technology-boundary", "satisfaction-cost"],
  difficulty: "hard",
  prerequisites: ["作者需要设计精密的修炼体系、灵气运转规则和丹药/法宝分级。"],
  suitableFor: ["凡人修真", "炼丹修真", "体修"],
  notSuitableFor: ["轻松无脑升级", "无体系约束的爽文"],
};
