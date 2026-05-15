import type { PresetBundle } from "../types.js";

export const systemFlowGrowthBundle: PresetBundle = {
  id: "system-flow-growth",
  name: "系统流稳步成长",
  category: "bundle",
  description: "系统流题材 + 轻松幽默文风 + 任务奖励基底。",
  promptInjection: "使用轻松幽默语言，围绕系统任务、奖励兑现、等级提升展开，重点检查系统规则一致性、奖励限制和主角自主性。",
  compatibleGenres: ["system-flow"],
  tags: ["系统", "成长", "任务", "奖励"],
  genreIds: ["system-flow"],
  toneId: "passionate-heroic",
  settingBaseId: "sect-family-xianxia",
  logicRiskIds: ["economy-resource", "satisfaction-cost", "technology-boundary"],
  difficulty: "easy",
  prerequisites: ["作者需要明确系统类型、奖励规则和成长上限。"],
  suitableFor: ["签到系统", "任务系统", "模拟器系统"],
  notSuitableFor: ["无外挂的纯实力流", "严肃文学向"],
};
