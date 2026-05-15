import type { PresetBundle } from "../types.js";

export const lightNovelCampusBundle: PresetBundle = {
  id: "light-novel-campus",
  name: "轻小说校园日常",
  category: "bundle",
  description: "轻小说题材 + 轻松幽默文风 + 校园日常基底。",
  promptInjection: "使用轻松幽默语言，围绕角色互动、日常趣事、恋爱进展展开，重点检查对话趣味性、画面感描写和角色辨识度。",
  compatibleGenres: ["light-novel"],
  tags: ["轻小说", "校园", "日常", "恋爱"],
  genreIds: ["light-novel"],
  toneId: "passionate-heroic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["character-motivation"],
  difficulty: "easy",
  prerequisites: ["作者需要明确角色设定、校园背景和核心关系线。"],
  suitableFor: ["校园日常", "后宫喜剧", "恋爱喜剧"],
  notSuitableFor: ["严肃文学", "纯战斗向"],
};
