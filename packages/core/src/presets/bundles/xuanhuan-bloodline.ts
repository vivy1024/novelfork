import type { PresetBundle } from "../types.js";

export const xuanhuanBloodlineBundle: PresetBundle = {
  id: "xuanhuan-bloodline",
  name: "玄幻血脉觉醒",
  category: "bundle",
  description: "玄幻题材 + 热血张扬文风 + 大陆等级体系基底。",
  promptInjection: "使用热血张扬语言，围绕等级碾压、血脉觉醒、势力争霸展开，重点检查等级体系一致性、金手指限制和配角智商。",
  compatibleGenres: ["xuanhuan"],
  tags: ["玄幻", "血脉", "等级", "逆袭"],
  genreIds: ["xuanhuan"],
  toneId: "passionate-heroic",
  settingBaseId: "sect-family-xianxia",
  logicRiskIds: ["economy-resource", "satisfaction-cost", "character-motivation"],
  difficulty: "easy",
  prerequisites: ["作者需要明确等级体系、血脉分类和金手指的限制条件。"],
  suitableFor: ["废柴逆袭", "大世界流", "血脉觉醒"],
  notSuitableFor: ["低调种田", "纯文艺向"],
};
