/**
 * Agent 写作管线编排
 * 串行执行 Explorer → Planner → Writer → Auditor 流程
 */

import { runAgentLoop, type AgentLoopOptions } from "./agent.js";
import type { PipelineConfig } from "./runner.js";

export interface PipelineStep {
  role: string;
  instruction: string;
}

export interface PipelineResult {
  readonly exploration?: string;
  readonly plan?: string;
  readonly draft?: string;
  readonly audit?: string;
  readonly metadata: {
    bookId?: string;
    model: string;
    steps: number;
  };
}

export interface PipelineError {
  readonly error: string;
  readonly step: number;
  readonly stepRole: string;
}

/**
 * 执行完整的写作管线：探索 → 规划 → 写作 → 审计
 * 任一步失败返回 PipelineError，不假装成功。
 */
export async function runWritingPipeline(
  config: PipelineConfig,
  bookId: string,
  userIntent: string,
  options?: AgentLoopOptions,
): Promise<PipelineResult | PipelineError> {
  // Step 1: Explorer — 分析当前状态
  const exploration = await runAgentLoop(config,
    `分析书籍 ${bookId} 的当前创作状态。用户意图：${userIntent}`,
    { ...options, agentId: "explorer", maxTurns: 3 },
  );
  if (!exploration || exploration.startsWith("Error:")) {
    return { error: exploration || "探索步骤失败", step: 1, stepRole: "explorer" };
  }

  // Step 2: Planner — 制定章节大纲
  const plan = await runAgentLoop(config,
    `根据以下探索结果制定下一章的大纲：\n\n${exploration.slice(0, 4000)}\n\n用户意图：${userIntent}`,
    { ...options, agentId: "planner", maxTurns: 3 },
  );
  if (!plan || plan.startsWith("Error:")) {
    return { error: plan || "规划步骤失败", step: 2, stepRole: "planner" };
  }

  // Step 3: Writer — 生成正文
  const draft = await runAgentLoop(config,
    `根据以下大纲生成章节正文：\n\n${plan.slice(0, 4000)}`,
    { ...options, agentId: "writer", maxTurns: 3 },
  );
  if (!draft || draft.startsWith("Error:")) {
    return { error: draft || "写作步骤失败", step: 3, stepRole: "writer" };
  }

  // Step 4: Auditor — 审计质量
  const audit = await runAgentLoop(config,
    `审计以下章节正文的质量（连续性、设定一致性、AI 痕迹）：\n\n${draft.slice(0, 4000)}`,
    { ...options, agentId: "auditor", maxTurns: 3 },
  );
  if (!audit || audit.startsWith("Error:")) {
    return { error: audit || "审计步骤失败", step: 4, stepRole: "auditor" };
  }

  return {
    exploration,
    plan,
    draft,
    audit,
    metadata: { bookId, model: config.model, steps: 4 },
  };
}

/**
 * 仅执行审计流程（用于单独审校某章）
 */
export async function runAuditPipeline(
  config: PipelineConfig,
  bookId: string,
  chapterContent: string,
  options?: AgentLoopOptions,
): Promise<string> {
  return runAgentLoop(config,
    `审计以下章节正文的质量：\n\n${chapterContent.slice(0, 8000)}`,
    { ...options, agentId: "auditor", maxTurns: 3 },
  );
}
