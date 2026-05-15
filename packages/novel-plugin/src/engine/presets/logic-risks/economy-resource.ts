import type { LogicRiskRule } from "../types.js";

export const economyResourceRisk: LogicRiskRule = {
  id: "economy-resource",
  name: "经济/资源体系",
  category: "logic-risk",
  description: "检查金钱、资源、材料、灵石、资金和奖励是否有来源、稀缺性和流通规则。",
  promptInjection: "任何资源、奖励、技术材料或修炼物资都应有来源、成本、稀缺性和流通限制。",
  riskType: "economy-resource",
  appliesToSettingBases: [
    "sect-family-xianxia",
    "modern-platform-economy-satire",
    "historical-court-livelihood",
    "near-future-industrial-scifi",
  ],
  writerConstraint: "写到奖励、财富、资源、设备、灵材和经费时，要交代谁提供、为什么提供、代价由谁承担。",
  auditQuestion: "本章是否出现资源凭空出现、前后稀缺性不一致或经济链条断裂？",
  evidenceHints: ["前期稀缺资源后期随意发放", "奖励没有资金来源", "技术没有材料和维护", "组织长期运行却无收入"],
  uncertainHandling: "标注为需要作者确认，并要求补充资源来源、成本或稀缺边界。",
};
