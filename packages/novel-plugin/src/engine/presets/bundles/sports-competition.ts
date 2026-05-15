import type { PresetBundle } from "../types.js";

export const sportsCompetitionBundle: PresetBundle = {
  id: "sports-competition",
  name: "体育竞技热血",
  category: "bundle",
  description: "体育题材 + 热血燃向文风 + 竞技规则基底。",
  promptInjection: "使用热血燃向语言，围绕比赛对抗、技术突破、团队配合展开，重点检查运动规则准确性、比赛描写画面感和训练合理性。",
  compatibleGenres: ["sports"],
  tags: ["体育", "竞技", "热血", "成长"],
  genreIds: ["sports"],
  toneId: "passionate-heroic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["character-motivation", "satisfaction-cost"],
  difficulty: "medium",
  prerequisites: ["作者需要对所写运动有专业了解，包括规则、技术和训练方法。"],
  suitableFor: ["篮球足球", "格斗拳击", "电竞"],
  notSuitableFor: ["无竞技元素的设定", "纯修仙战斗"],
};
