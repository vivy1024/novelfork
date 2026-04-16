/**
 * 工具执行器
 * 统一工具注册、调用、结果处理
 */

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  workspaceRoot: string;
  userId: string;
  sessionId: string;
  permissions: Set<string>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export class ToolExecutor {
  private tools = new Map<string, ToolDefinition>();

  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 获取所有已注册工具
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具定义
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 验证工具参数
   */
  private validateParameters(
    tool: ToolDefinition,
    params: Record<string, unknown>
  ): { valid: boolean; error?: string } {
    for (const param of tool.parameters) {
      const value = params[param.name];

      // 检查必需参数
      if (param.required && value === undefined) {
        return {
          valid: false,
          error: `Missing required parameter: ${param.name}`,
        };
      }

      // 检查参数类型
      if (value !== undefined) {
        const actualType = Array.isArray(value) ? "array" : typeof value;
        if (actualType !== param.type) {
          return {
            valid: false,
            error: `Parameter "${param.name}" must be of type ${param.type}, got ${actualType}`,
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * 执行工具
   */
  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        success: false,
        error: `Tool "${toolName}" not found`,
      };
    }

    // 验证参数
    const validation = this.validateParameters(tool, params);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // 应用默认参数
    const finalParams = { ...params };
    for (const param of tool.parameters) {
      if (finalParams[param.name] === undefined && param.default !== undefined) {
        finalParams[param.name] = param.default;
      }
    }

    // 执行工具
    try {
      const result = await tool.execute(finalParams, context);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// 全局工具执行器实例
export const toolExecutor = new ToolExecutor();
