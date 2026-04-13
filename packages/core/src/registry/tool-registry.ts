/**
 * ToolRegistry — 工具注册表，支持动态注册和执行工具
 * P2-0: 将 agent.ts 中的 18 个硬编码工具迁移到注册表模式
 */

import type { PipelineRunner, PipelineConfig } from "../pipeline/runner.js";
import type { StateManager } from "../state/manager.js";

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export type ToolHandler = (
  pipeline: PipelineRunner,
  state: StateManager,
  config: PipelineConfig,
  args: Record<string, unknown>,
) => Promise<string>;

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool "${tool.definition.name}" is already registered.`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(
    name: string,
    pipeline: PipelineRunner,
    state: StateManager,
    config: PipelineConfig,
    args: Record<string, unknown>,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    return tool.handler(pipeline, state, config, args);
  }
}

/** 全局单例注册表 */
export const globalToolRegistry = new ToolRegistry();
