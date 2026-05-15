import type { PresetBundle } from "../types.js";

export const mortalSectXianxiaBundle: PresetBundle = {
  id: "mortal-sect-xianxia",
  name: "凡人宗门修仙",
  category: "bundle",
  description: "修仙题材 + 悲苦/克制文风 + 宗门家族资源分配基底。",
  promptInjection: "使用悲苦或克制语言，围绕资源稀缺、境界分层、宗门规则和个人修行展开，重点检查资源经济、组织响应和爽点代价。",
  compatibleGenres: ["xianxia"],
  tags: ["修仙", "宗门", "凡人流", "资源"],
  genreIds: ["xianxia"],
  toneId: "tragic-solitude",
  settingBaseId: "sect-family-xianxia",
  logicRiskIds: ["economy-resource", "institution-response", "technology-boundary", "satisfaction-cost"],
  difficulty: "medium",
  prerequisites: ["作者需要明确境界表、资源稀缺性和宗门晋升规则。"],
  suitableFor: ["凡人流", "宗门成长", "家族修仙"],
  notSuitableFor: ["无境界约束的轻喜剧", "主角全程无代价碾压"],
};
