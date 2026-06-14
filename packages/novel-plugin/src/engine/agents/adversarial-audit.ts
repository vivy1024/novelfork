/**
 * 对抗式审查编排器（P1-1 / C4）
 *
 * 恢复多 agent 体系的"原本意图"：不是会话绑定不同工具，而是同一份正文由多个
 * 独立审查视角各自跑（独立 prompt / 独立调用，互不知对方结论），再用纯函数
 * 合成器交叉裁决。这能暴露单 agent 自审的盲区（它写的它审，容易放过自己）。
 *
 * 3 视角：
 *  - A 连续性审查官：设定/时间线/数值/伏笔/信息边界/世界规则
 *  - B 叙事质量审查官：节奏/弧线/爽点/台词/流水账/视角/配角
 *  - C 文本质量审查官：文风/AI腔/段落/套话/词汇疲劳/敏感词
 */
import type { AuditResult, AuditIssue, ContinuityAuditor } from "./continuity.js";
import type { ContextPackage, RuleStack } from "@vivy1024/novelfork-core";

export type AuditView = "continuity" | "narrative" | "text";

/** 各视角负责的维度 id（取自 continuity.ts 的 37 维定义） */
export const ADVERSARIAL_VIEW_DIMENSIONS: Record<AuditView, ReadonlyArray<number>> = {
  // 连续性：OOC/时间线/设定冲突/战力/数值/伏笔/信息越界/利益链/年代/正传/未来信息/跨书/番外/角色还原/世界规则/关系/正典
  continuity: [1, 2, 3, 4, 5, 6, 9, 11, 12, 28, 29, 30, 31, 34, 35, 36, 37],
  // 叙事质量：节奏/爽点/台词/流水账/支线停滞/弧线/节奏单调/配角降智/配角工具人/读者期待/大纲偏离/视角
  narrative: [7, 13, 14, 15, 16, 17, 19, 24, 25, 26, 32, 33],
  // 文本质量：文风/词汇疲劳/知识库污染/段落等长/套话/公式化转折/列表式/敏感词
  text: [8, 10, 18, 20, 21, 22, 23, 27],
};

export interface AdversarialAuditResult extends AuditResult {
  /** 每个视角的原始结论（便于诊断） */
  readonly views: Record<AuditView, AuditResult>;
  /** 合成时标记为"需复核"的 issue 数（视角间结论冲突） */
  readonly needsReviewCount: number;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function issueKey(issue: AuditIssue): string {
  return `${issue.category}::${issue.description}`.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 合成器（纯函数）：汇总多视角 issue，去重，按严重度排序。
 * passed = 无任何 critical issue。
 */
export function synthesizeAdversarialAudits(
  views: Record<AuditView, AuditResult>,
): { issues: AuditIssue[]; passed: boolean; needsReviewCount: number; summary: string } {
  const seen = new Map<string, AuditIssue>();
  let needsReviewCount = 0;

  for (const view of Object.values(views)) {
    for (const issue of view.issues) {
      const key = issueKey(issue);
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, issue);
      } else if (SEVERITY_RANK[issue.severity] < SEVERITY_RANK[existing.severity]) {
        // 同一问题被另一视角判定更严重 → 取更高严重度，标记需复核
        seen.set(key, issue);
        needsReviewCount += 1;
      }
    }
  }

  const issues = [...seen.values()].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
  );
  const passed = !issues.some((i) => i.severity === "critical");
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const summary = `对抗审查合成：${issues.length} 个问题（${criticalCount} 严重），${needsReviewCount} 项视角间存在分歧需复核。`;

  return { issues, passed, needsReviewCount, summary };
}

export interface AdversarialAuditInput {
  readonly bookDir: string;
  readonly chapterContent: string;
  readonly chapterNumber: number;
  readonly genre?: string;
  readonly chapterIntent?: string;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
}

/**
 * 编排 3 视角独立审查并合成。每个视角是独立的 LLM 调用（互不知对方结论）。
 * auditorFactory 用于按视角创建审查官（可注入不同模型实现 per-pass 路由）。
 */
export async function auditChapterAdversarial(
  input: AdversarialAuditInput,
  auditorFactory: (view: AuditView) => ContinuityAuditor,
): Promise<AdversarialAuditResult> {
  const viewNames: AuditView[] = ["continuity", "narrative", "text"];

  const results = await Promise.all(
    viewNames.map((view) =>
      auditorFactory(view).auditChapter(
        input.bookDir,
        input.chapterContent,
        input.chapterNumber,
        input.genre,
        {
          viewDimensionIds: ADVERSARIAL_VIEW_DIMENSIONS[view],
          ...(input.chapterIntent ? { chapterIntent: input.chapterIntent } : {}),
          ...(input.contextPackage ? { contextPackage: input.contextPackage } : {}),
          ...(input.ruleStack ? { ruleStack: input.ruleStack } : {}),
        },
      ),
    ),
  );

  const views: Record<AuditView, AuditResult> = {
    continuity: results[0]!,
    narrative: results[1]!,
    text: results[2]!,
  };

  const synth = synthesizeAdversarialAudits(views);
  const totalTokens = results.reduce((sum, r) => sum + (r.tokenUsage?.totalTokens ?? 0), 0);

  return {
    passed: synth.passed,
    issues: synth.issues,
    summary: synth.summary,
    views,
    needsReviewCount: synth.needsReviewCount,
    ...(totalTokens > 0 ? { tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens } } : {}),
  };
}
