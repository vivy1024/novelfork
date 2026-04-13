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
  parameters?: ToolParameter[];
  inputSchema?: Record<string, unknown>;
  source?: "builtin" | "mcp" | "plugin";
}

export type ToolHandler = (
  pipeline: PipelineRunner,
  state: StateManager,
  config: PipelineConfig,
  args: Record<string, unknown>,
) => Promise<string>;

// Generic tool handler for MCP/plugin tools
export type GenericToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler | GenericToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool | {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    source?: "builtin" | "mcp" | "plugin";
    handler: GenericToolHandler;
  }): void {
    // Support both old and new registration formats
    const registeredTool: RegisteredTool = "definition" in tool
      ? tool
      : {
          definition: {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            source: tool.source,
          },
          handler: tool.handler as any,
        };

    if (this.tools.has(registeredTool.definition.name)) {
      throw new Error(`Tool "${registeredTool.definition.name}" is already registered.`);
    }
    this.tools.set(registeredTool.definition.name, registeredTool);
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

    try {
      const result = await tool.handler(pipeline as any, state as any, config as any, args);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({ error: String(error) });
    }
  }
}

/** 全局单例注册表 */
export const globalToolRegistry = new ToolRegistry();
