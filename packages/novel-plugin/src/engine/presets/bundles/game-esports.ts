import type { PresetBundle } from "../types.js";

export const gameEsportsBundle: PresetBundle = {
  id: "game-esports",
  name: "游戏电竞竞技",
  category: "bundle",
  description: "游戏题材 + 热血竞技文风 + 数值规则基底。",
  promptInjection: "使用热血竞技语言，围绕游戏规则、操作技巧、团队配合展开，重点检查数值体系一致性、技能描写具体性和比赛节奏。",
  compatibleGenres: ["game"],
  tags: ["游戏", "电竞", "竞技", "数值"],
  genreIds: ["game"],
  toneId: "passionate-heroic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["technology-boundary", "information-flow"],
  difficulty: "easy",
  prerequisites: ["作者需要明确游戏规则体系、等级上限和核心玩法机制。"],
  suitableFor: ["网游竞技", "全息游戏", "电竞职业"],
  notSuitableFor: ["无数值体系的纯文艺", "慢节奏种田"],
};
