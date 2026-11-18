/**
 * 自定义子代理的纯前端/后端共享类型与白名单常量（无 Node 内置模块依赖）。
 */

import { NOVEL_SUBAGENT_ROSTER, ROSTER_FORBIDDEN_TOOLS } from "./roster.js";

export interface CustomSubagentConfig {
  readonly id: string;
  readonly nameZh: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly prompt: string;
  readonly defaultModel?: string;
  readonly basedOn?: string;
  readonly updatedAt: number;
}

const FORBIDDEN_SET = new Set(ROSTER_FORBIDDEN_TOOLS);

/** 允许自定义子代理挑选的安全工具清单（只读、草稿提案与工作流提交）。 */
export const CUSTOM_SUBAGENT_ALLOWED_TOOLS: readonly string[] = Array.from(
  new Set([
    ...NOVEL_SUBAGENT_ROSTER.flatMap((t) => t.tools),
    "chapter.read",
    "chapter.list",
    "lore.read",
    "memory.read",
    "story.timeline",
    "workflow.get_current_step",
    "workflow.submit_step_output",
    "workflow.report_blocker",
  ]),
).filter((tool) => !FORBIDDEN_SET.has(tool));
