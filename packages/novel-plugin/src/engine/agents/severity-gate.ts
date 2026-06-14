/**
 * 审查严重度门禁（P1-2 / C2）
 *
 * 把审查 issue 映射到 4 级门禁语义，不改动 LLM 面向的 AuditIssue 契约
 * （仍是 critical/warning/info），而是在决策层细化：
 *  - S1 致命：崩人设 / 设定硬冲突 → 阻断采纳，即使修订也需人工复核
 *  - S2 严重：数值断裂 / 伏笔断线等其它 critical → 触发自动修订
 *  - S3 一般：warning → 仅警告
 *  - S4 建议：info → 仅记录
 */
import type { AuditIssue } from "./continuity.js";

export type SeverityGate = "S1" | "S2" | "S3" | "S4";

/** S1 致命类别关键词（崩人设/设定硬冲突，修订难救，倾向直接人工复核） */
const S1_CATEGORY_HINTS = [
  "OOC", "崩人设", "人设", "设定冲突", "正传事件冲突", "世界规则", "正典", "Lore", "Canon", "OOC Check",
];

function matchesS1Category(category: string): boolean {
  const c = category.toLowerCase();
  return S1_CATEGORY_HINTS.some((h) => c.includes(h.toLowerCase()));
}

/** 把单条 issue 映射到 4 级门禁 */
export function classifyGate(issue: AuditIssue): SeverityGate {
  if (issue.severity === "critical") {
    return matchesS1Category(issue.category) ? "S1" : "S2";
  }
  if (issue.severity === "warning") return "S3";
  return "S4";
}

export interface GateDecision {
  /** 是否存在 S1（致命，应阻断采纳并送人工复核） */
  readonly hasBlocking: boolean;
  /** 是否存在 S2（应触发自动修订） */
  readonly hasRevisable: boolean;
  /** 各级计数 */
  readonly counts: Record<SeverityGate, number>;
}

export function evaluateGate(issues: ReadonlyArray<AuditIssue>): GateDecision {
  const counts: Record<SeverityGate, number> = { S1: 0, S2: 0, S3: 0, S4: 0 };
  for (const issue of issues) counts[classifyGate(issue)] += 1;
  return {
    hasBlocking: counts.S1 > 0,
    hasRevisable: counts.S1 > 0 || counts.S2 > 0,
    counts,
  };
}
