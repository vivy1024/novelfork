import type { LogicRiskRule } from "../types.js";

export const institutionResponseRisk: LogicRiskRule = {
  id: "institution-response",
  name: "权力机构响应",
  category: "logic-risk",
  description: "检查警察、教会、宗门、朝廷、平台、公司或监管机构的反应是否符合成本与权限。",
  promptInjection: "重大事件会触发机构响应，但响应必须受信息、程序、成本、权限和遮掩需求限制。",
  riskType: "institution-response",
  appliesToSettingBases: [
    "victorian-industrial-occult",
    "sect-family-xianxia",
    "modern-platform-economy-satire",
    "historical-court-livelihood",
    "near-future-industrial-scifi",
  ],
  writerConstraint: "写重大冲突、暴露、事故或违法行为时，要考虑相关机构是否会知道、何时知道、如何行动、为什么暂不行动。",
  auditQuestion: "本章机构反应是否过慢、过快、全知或完全缺席？",
  evidenceHints: ["重大事件无人追责", "机构瞬间全知", "规则只惩罚配角", "平台/宗门/朝廷无成本动员"],
  uncertainHandling: "标注为需要作者确认，并要求补充机构未响应或快速响应的理由。",
};
