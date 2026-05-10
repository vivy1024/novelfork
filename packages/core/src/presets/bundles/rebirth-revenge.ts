import type { PresetBundle } from "../types.js";

export const rebirthRevengeBundle: PresetBundle = {
  id: "rebirth-revenge",
  name: "重生复仇布局",
  category: "bundle",
  description: "重生题材 + 隐忍冷静文风 + 都市商战基底。",
  promptInjection: "使用隐忍冷静语言，围绕先知布局、步步为营、复仇逆转展开，重点检查先知信息边界、蝴蝶效应和心理变化合理性。",
  compatibleGenres: ["rebirth"],
  tags: ["重生", "复仇", "布局", "逆转"],
  genreIds: ["rebirth"],
  toneId: "austere-pragmatic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["information-flow", "character-motivation", "economy-resource"],
  difficulty: "easy",
  prerequisites: ["作者需要明确重生时间点、先知信息范围和核心复仇目标。"],
  suitableFor: ["商业重生", "复仇重生", "学生时代重生"],
  notSuitableFor: ["无先知优势的设定", "纯修仙战斗"],
};
