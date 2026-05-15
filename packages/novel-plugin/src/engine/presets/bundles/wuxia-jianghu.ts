import type { PresetBundle } from "../types.js";

export const wuxiaJianghuBundle: PresetBundle = {
  id: "wuxia-jianghu",
  name: "武侠江湖恩怨",
  category: "bundle",
  description: "武侠题材 + 古典侠义文风 + 江湖门派基底。",
  promptInjection: "使用古典侠义语言，围绕江湖恩怨、武功修炼、门派纷争展开，重点检查武功描写画面感、时代背景一致性和人物语言辨识度。",
  compatibleGenres: ["wuxia"],
  tags: ["武侠", "江湖", "侠义", "恩怨"],
  genreIds: ["wuxia"],
  toneId: "tragic-solitude",
  settingBaseId: "sect-family-xianxia",
  logicRiskIds: ["anachronism", "character-motivation", "geography-transport"],
  difficulty: "medium",
  prerequisites: ["作者需要明确武功体系、门派关系和时代背景。"],
  suitableFor: ["成长复仇", "群像江湖", "悬疑武侠"],
  notSuitableFor: ["无武功设定的纯言情", "现代都市背景"],
};
