/**
 * 工作流团队编排规划（narrator-team 执行模式的纯函数部分）。
 *
 * subagent 工序由谁干：规划阶段把配方里的委派工序折算成一份「工人名单」，
 * 产品侧按名单为本书建/复用叙述者（书名前缀见 WORKFLOW_WORKER_TITLE_PREFIX），
 * 领导者叙述者在工序简报指引下用 narrator-team 的 team.setup 收编、
 * team.dispatch 派活、team.report 收活，最终仍由领导者本人
 * workflow_submit_step_output 提交闸门——权威写入不因团队编排而旁路。
 */

import type { NovelWorkflowRecipe } from "./novel-workflows.js";

/** 工人叙述者标题前缀：让 team.status 的 availableNarrators 里一眼认出（发现协议按标题匹配）。 */
export const WORKFLOW_WORKER_TITLE_PREFIX = "工作流工人·";

/**
 * 工作流工人的身份标记（写在叙述者 traits 上）。
 *
 * 闸门认它而不是认标题：插件 team.update_member 允许改成员标题，改完必须仍然认得出。
 * 这里是唯一来源，产品运行时适配器（workflow-run-gate）直接 re-export 使用。
 */
export const WORKFLOW_WORKER_TRAIT = "novelfork-workflow-worker";

/**
 * 一本书的固定团队 id：插件按 teamId 存配置，一本书一个，多本书同时跑不会串团队。
 *
 * 只把空白与路径分隔符折成 `-`，中文原样保留（团队 id 是存储键里的普通字符串，
 * 保住书名才看得出这个团队属于哪本书）；bookId 为空时退化成固定的 `team-book`。
 */
export function workflowTeamIdForBook(bookId: string): string {
	const normalized = bookId.trim().replace(/[\\/\s]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
	return `team-${(normalized || "book").slice(0, 96)}`;
}

export interface WorkflowTeamMemberPlan {
  /** 稳定键：同一角色跨工序复用一个工人叙述者。 */
  readonly roleKey: string;
  /** 提议的叙述者标题（含前缀，书单内可查重）。 */
  readonly title: string;
  /** 该工人承接的工序 stepId 列表（图序）。 */
  readonly stepIds: readonly string[];
  /** 配方为该角色指定的模型覆盖（可选）。 */
  readonly model?: string;
}

export interface WorkflowTeamPlan {
  readonly recipeId: string;
  readonly recipeName: string;
  readonly members: readonly WorkflowTeamMemberPlan[];
}

function memberRoleKey(agentId: string, parallelName?: string): string {
  return parallelName ? `${agentId}/${parallelName}` : agentId;
}

/** 从配方图派生工人名单。无委派工序的配方返回空 members（团队编排无事可做）。 */
export function planWorkflowTeam(recipe: NovelWorkflowRecipe): WorkflowTeamPlan {
  const members = new Map<string, { title: string; stepIds: string[]; model?: string }>();
  const add = (roleKey: string, title: string, stepId: string, model?: string) => {
    const existing = members.get(roleKey);
    if (existing) {
      if (!existing.stepIds.includes(stepId)) existing.stepIds.push(stepId);
      return;
    }
    members.set(roleKey, { title, stepIds: [stepId], ...(model ? { model } : {}) });
  };

  for (const node of recipe.nodes) {
    if (node.type !== "step") continue;
    if (node.executionMode !== "subagent") continue;
    const agentId = node.agentId?.trim() || "writer";
    if (node.parallelSubagents && node.parallelSubagents.length > 0) {
      // 并行工序：每个并行子代理一个工人，模型覆盖以并行配置为准。
      for (const parallel of node.parallelSubagents) {
        const name = parallel.name.trim();
        if (!name) continue;
        add(
          memberRoleKey(agentId, name),
          `${WORKFLOW_WORKER_TITLE_PREFIX}${agentId}·${name}`,
          node.id,
          parallel.model ?? node.modelOverride,
        );
      }
      continue;
    }
    add(memberRoleKey(agentId), `${WORKFLOW_WORKER_TITLE_PREFIX}${agentId}`, node.id, node.modelOverride);
  }

  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    members: [...members.entries()].map(([roleKey, m]) => ({
      roleKey,
      title: m.title,
      stepIds: m.stepIds,
      ...(m.model ? { model: m.model } : {}),
    })),
  };
}
