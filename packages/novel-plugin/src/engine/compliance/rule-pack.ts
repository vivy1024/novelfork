import type { RulePackMetadata } from "./types.js";

export const NOVELFORK_RISK_RULE_PACK: RulePackMetadata = {
  id: "NOVELFORK_RISK_RULE_PACK",
  name: "NovelFork 投稿风险自检规则",
  version: "2026.08",
  source: "NovelFork 内置词典、正文完整性检查与章节审计结果",
  confidence: "medium",
  effectiveAt: "2026-08-12",
  note: "这是本地编辑辅助规则，不是平台官方审核规则；命中结果只用于人工复核。",
};

export const LOCAL_FORMAT_RULE_SOURCE = "NovelFork 本地正文完整性规则";
export const LOCAL_SENSITIVE_RULE_SOURCE = "NovelFork 内置/作者导入敏感词典";
export const CHAPTER_AUDIT_RULE_SOURCE = "NovelFork 章节审计结果";
