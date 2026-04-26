import type { PresetBundle } from "../types.js";

export const classicalTravelXianxiaBundle: PresetBundle = {
  id: "classical-travel-xianxia",
  name: "古典游历仙侠",
  category: "bundle",
  description: "仙侠题材 + 古典意境文风 + 游历、志怪、地方秩序基底。",
  promptInjection: "使用古典意境语言，以旅途见闻、地方风物和民俗秩序组织章节，重点检查交通、日常材料和人物动机。",
  compatibleGenres: ["xianxia"],
  tags: ["仙侠", "游历", "古典", "志怪"],
  genreIds: ["xianxia"],
  toneId: "classical-imagery",
  settingBaseId: "classical-travelogue-jianghu",
  logicRiskIds: ["geography-transport", "character-motivation", "information-flow"],
  difficulty: "medium",
  prerequisites: ["作者需要准备旅途路线、地方风俗和单元事件。"],
  suitableFor: ["游历仙侠", "志怪单元剧", "轻仙侠日常"],
  notSuitableFor: ["高密度升级打脸", "纯战争/朝堂主线"],
};
