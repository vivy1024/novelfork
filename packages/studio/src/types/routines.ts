/**
 * 套路系统类型定义
 */

export interface Command {
  id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

export interface Tool {
  name: string;
  enabled: boolean;
  description?: string;
  loadCommand?: string;
}

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export interface ToolPermission {
  tool: string;
  permission: PermissionBehavior;
  pattern?: string;
  source: 'user' | 'project' | 'managed';
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

export interface SubAgent {
  id: string;
  name: string;
  description: string;
  type: 'general-purpose' | 'specialized';
  systemPrompt: string;
  enabled: boolean;
  toolPermissions?: ToolPermission[];
}

export interface Prompt {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
}

export interface MCPTool {
  id: string;
  serverName: string;
  toolName: string;
  enabled: boolean;
  approved: boolean;
}

export interface Routines {
  commands: Command[];
  tools: Tool[];
  permissions: ToolPermission[];
  globalSkills: Skill[];
  projectSkills: Skill[];
  subAgents: SubAgent[];
  globalPrompts: Prompt[];
  systemPrompts: Prompt[];
  mcpTools: MCPTool[];
}

export const DEFAULT_ROUTINES: Routines = {
  commands: [],
  tools: [],
  permissions: [],
  globalSkills: [],
  projectSkills: [],
  subAgents: [],
  globalPrompts: [],
  systemPrompts: [],
  mcpTools: [],
};
