/**
 * 自定义子代理的纯前端/后端共享类型与白名单常量（无 Node 内置模块依赖）。
 */

import { NOVEL_SUBAGENT_ROSTER, ROSTER_DRAFT_WRITE_TOOLS, ROSTER_FORBIDDEN_TOOLS } from "./roster.js";

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

/**
 * 自定义子代理不得挑选的工具：名册禁用的写权威源 / 终端 / 再委派工具，加上 Runtime 原生
 * Write / Edit。后者只开给内置「执笔」「返修」模板：它们由工作流按模板认出委派身份、拿到
 * 本章 targetChapterPath，交稿与落盘时还要过草稿写盘审计；自定义子代理不是 Runtime 模板，
 * 认不出委派身份，原生写文件对它完全不受工序约束（basedOn 只是复制来源，不改变这一点）。
 */
export const CUSTOM_SUBAGENT_FORBIDDEN_TOOLS: readonly string[] = [...ROSTER_FORBIDDEN_TOOLS, ...ROSTER_DRAFT_WRITE_TOOLS];

const FORBIDDEN_SET = new Set(CUSTOM_SUBAGENT_FORBIDDEN_TOOLS);

/** 允许自定义子代理挑选的安全工具清单（只读、草稿提案与工作流提交）。 */
export const CUSTOM_SUBAGENT_ALLOWED_TOOLS: readonly string[] = Array.from(
  new Set([
    ...NOVEL_SUBAGENT_ROSTER.flatMap((t) => t.tools),
    "Read",
    "chapter.list",
    "jingwei.read",
    "memory.read",
    "memory.graph",
    "workflow.step",
  ]),
).filter((tool) => !FORBIDDEN_SET.has(tool));
