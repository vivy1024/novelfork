import type { PresetBundle } from "../types.js";

export const fanfictionCrossoverBundle: PresetBundle = {
  id: "fanfiction-crossover",
  name: "同人穿越改命",
  category: "bundle",
  description: "同人题材 + 轻松热血文风 + 原作世界基底。",
  promptInjection: "使用轻松热血语言，围绕原作剧情改变、角色互动、蝴蝶效应展开，重点检查原作角色性格一致性、先知信息运用和原创内容比例。",
  compatibleGenres: ["fanfiction"],
  tags: ["同人", "穿越", "改命", "原作"],
  genreIds: ["fanfiction"],
  toneId: "passionate-heroic",
  settingBaseId: "sect-family-xianxia",
  logicRiskIds: ["character-motivation", "information-flow", "satisfaction-cost"],
  difficulty: "medium",
  prerequisites: ["作者需要熟悉原作设定、角色性格和关键剧情节点。"],
  suitableFor: ["穿越同人", "反派同人", "综漫同人"],
  notSuitableFor: ["与原作完全无关的原创", "纯原创世界观"],
};
