import type { PresetBundle } from "../types.js";

export const historicalGovernanceBundle: PresetBundle = {
  id: "historical-governance",
  name: "历史穿越治世",
  category: "bundle",
  description: "历史穿越题材 + 古典/质朴文风 + 朝堂民生、财政军政和技术差基底。",
  promptInjection: "使用古典或质朴语言，围绕朝堂、民生、财政、军政和技术推广展开，重点检查财政资源、技术扩散和机构响应。",
  compatibleGenres: ["history"],
  tags: ["历史", "穿越", "治世", "民生"],
  genreIds: ["history"],
  toneId: "austere-pragmatic",
  settingBaseId: "historical-court-livelihood",
  logicRiskIds: ["economy-resource", "institution-response", "geography-transport", "anachronism"],
  difficulty: "hard",
  prerequisites: ["作者需要明确时代参照、财政结构、技术推广路径和政治阻力。"],
  suitableFor: ["历史穿越", "朝堂民生", "技术改良"],
  notSuitableFor: ["不愿处理财政和制度成本的快节奏爽文"],
};
