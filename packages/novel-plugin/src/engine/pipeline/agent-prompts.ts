/**
 * Agent System Prompt — 已迁移至 system-prompt-builder.ts。
 *
 * 此文件仅保留极简的向后兼容重导出，供 engine/index.ts barrel 使用。
 * 新代码请直接使用 system-prompt-builder.ts 中的 buildSystemPrompt()。
 */

import { getAgentRole, AGENT_ROLES } from "./agent-roles.js";

/**
 * 根据 agentId 获取角色 prompt 字符串（向后兼容）。
 * @deprecated 使用 system-prompt-builder.ts 的 buildSystemPrompt() 代替。
 */
export function getAgentSystemPrompt(agentId?: string): string {
  const role = getAgentRole(agentId);
  const parts = [
    role.identity,
    role.domainKnowledge ? `\n\n## 领域知识\n${role.domainKnowledge}` : "",
    role.workflow ? `\n\n## 工具使用（强制流程）\n${role.workflow}` : "",
    role.outputSpec ? `\n\n## 输出规范\n${role.outputSpec}` : "",
    role.constraints ? `\n\n## 约束\n${role.constraints}` : "",
  ];
  return parts.join("");
}

/**
 * @deprecated 直接使用 AGENT_ROLES 代替。
 */
export const AGENT_SYSTEM_PROMPTS: Record<string, string> = (() => {
  const result: Record<string, string> = {};
  for (const [key, role] of Object.entries(AGENT_ROLES)) {
    if (key === "default") continue;
    result[key] = getAgentSystemPrompt(key);
  }
  return result;
})();
