import type { PresetBundle } from "../types.js";

export const nearFutureHardScifiBundle: PresetBundle = {
  id: "near-future-hard-scifi",
  name: "近未来硬科幻",
  category: "bundle",
  description: "科幻题材 + 冷峻质朴文风 + 近未来工业、实验和社会治理基底。",
  promptInjection: "使用冷峻质朴语言，围绕技术、实验、产业化、监管和社会后果展开，重点检查技术边界、组织响应和信息传播。",
  compatibleGenres: ["scifi"],
  tags: ["科幻", "近未来", "工业", "技术治理"],
  genreIds: ["scifi"],
  toneId: "austere-pragmatic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["technology-boundary", "institution-response", "information-flow", "economy-resource"],
  difficulty: "medium",
  prerequisites: ["作者需要明确核心技术的输入、输出、成本、失败模式和社会影响。"],
  suitableFor: ["近未来科幻", "技术惊悚", "工业/实验室叙事"],
  notSuitableFor: ["无技术边界的超能力爽文"],
};
