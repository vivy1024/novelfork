import type { PresetBundle } from "../types.js";

export const apocalypseSurvivalBundle: PresetBundle = {
  id: "apocalypse-survival",
  name: "末日生存基建",
  category: "bundle",
  description: "末日题材 + 冷峻写实文风 + 资源稀缺生存基底。",
  promptInjection: "使用冷峻写实语言，围绕生存压力、资源博弈、人性考验展开，重点检查资源获取合理性、生存需求描写和人际信任逻辑。",
  compatibleGenres: ["apocalypse"],
  tags: ["末日", "生存", "基建", "人性"],
  genreIds: ["apocalypse"],
  toneId: "austere-pragmatic",
  settingBaseId: "near-future-industrial-scifi",
  logicRiskIds: ["economy-resource", "institution-response", "character-motivation"],
  difficulty: "medium",
  prerequisites: ["作者需要明确末日类型、资源稀缺程度和社会崩溃程度。"],
  suitableFor: ["丧尸末日", "异能觉醒", "基建流"],
  notSuitableFor: ["轻松日常", "无生存压力的爽文"],
};
