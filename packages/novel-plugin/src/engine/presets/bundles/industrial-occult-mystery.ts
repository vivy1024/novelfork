import type { PresetBundle } from "../types.js";

export const industrialOccultMysteryBundle: PresetBundle = {
  id: "industrial-occult-mystery",
  name: "工业神秘悬疑",
  category: "bundle",
  description: "悬疑/科幻题材 + 冷峻质朴文风 + 工业城市神秘学基底。",
  promptInjection: "使用冷峻质朴语言，依托工业城市、机构秩序、报业与神秘组织，重点检查信息传播、机构响应和技术/神秘边界。",
  compatibleGenres: ["mystery", "scifi"],
  tags: ["悬疑", "工业", "神秘学", "冷峻"],
  genreIds: ["mystery", "scifi"],
  toneId: "austere-pragmatic",
  settingBaseId: "victorian-industrial-occult",
  logicRiskIds: ["information-flow", "institution-response", "technology-boundary", "anachronism"],
  difficulty: "hard",
  prerequisites: ["作者需要明确城市权力结构、超凡体系代价和信息传播边界。"],
  suitableFor: ["工业城市悬疑", "克苏鲁/神秘学", "蒸汽或近代架空"],
  notSuitableFor: ["纯轻松日常", "无机构/无调查线的爽文"],
};
