import type { LogicRiskRule } from "../types.js";

export const satisfactionCostRisk: LogicRiskRule = {
  id: "satisfaction-cost",
  name: "爽点代价",
  category: "logic-risk",
  description: "检查打脸、升级、破局、讽刺胜利和技术突破是否承担后果，避免爽点无成本透支。",
  promptInjection: "每个关键爽点都应有代价、后果或后续反应，不能只给满足感而不改变局势。",
  riskType: "satisfaction-cost",
  appliesToSettingBases: [
    "sect-family-xianxia",
    "modern-platform-economy-satire",
    "historical-court-livelihood",
    "near-future-industrial-scifi",
  ],
  writerConstraint: "写打脸、突破、破局、讽刺胜利和技术突破后，要考虑伤势、资源消耗、组织反扑、舆论或制度后果。",
  auditQuestion: "本章爽点是否没有代价、后果或回收压力，导致世界规则被主角特权破坏？",
  evidenceHints: ["越级战斗无伤", "打脸后无人追责", "制度漏洞只服务主角", "技术突破没有事故或成本"],
  uncertainHandling: "标注为需要作者确认，并要求补充爽点后果或降低收益强度。",
};
