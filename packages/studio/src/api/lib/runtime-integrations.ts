/**
 * Runtime Integrations — MCP tool bridge, hook executor, and AgentTool handler.
 *
 * These modules bridge the standalone implementations (mcp-client-runtime, subagent-runtime)
 * into the session tool executor and agent turn runtime.
 */

import { runSubagent, type SubagentConfig } from "./subagent-runtime.js";
import type { SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";

// --- MCP Tool Bridge ---

export interface McpToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface McpToolBridgeConfig {
  readonly serverId: string;
  readonly tools: readonly McpToolDefinition[];
  readonly callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface SessionToolLike {
  readonly name: string;
  readonly description?: string;
  readonly risk: string;
  readonly inputSchema?: unknown;
}

export interface McpToolBridge {
  getSessionTools(): SessionToolLike[];
  execute(toolName: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown }>;
}

export function createMcpToolBridge(config: McpToolBridgeConfig): McpToolBridge {
  return {
    getSessionTools(): SessionToolLike[] {
      return config.tools.map((tool) => ({
        name: `mcp:${config.serverId}:${tool.name}`,
        description: tool.description,
        risk: "read", // MCP tools default to read risk; write tools need explicit policy
        inputSchema: tool.inputSchema,
      }));
    },

    async execute(toolName: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown }> {
      if (!config.callTool) {
        return { ok: false, data: { error: "MCP callTool not configured" } };
      }
      const result = await config.callTool(toolName, args);
      return { ok: true, data: result };
    },
  };
}

// --- Hook Executor ---

export type HookPoint = "before_turn" | "after_turn" | "before_tool" | "after_tool" | "before_candidate_apply" | "after_chapter_save";

export interface HookDefinition {
  readonly id: string;
  readonly point: HookPoint;
  readonly handler: (context: unknown) => Promise<{ ok: boolean; message?: string }>;
}

export interface HookEvent {
  readonly hookId: string;
  readonly point: HookPoint;
  readonly ok: boolean;
  readonly message?: string;
  readonly error?: string;
  readonly timestamp: number;
}

export interface HookExecutor {
  runHooks(point: HookPoint, context: unknown): Promise<HookEvent[]>;
}

export function createHookExecutor(hooks: readonly HookDefinition[]): HookExecutor {
  return {
    async runHooks(point: HookPoint, context: unknown): Promise<HookEvent[]> {
      const matching = hooks.filter((h) => h.point === point);
      const events: HookEvent[] = [];

      for (const hook of matching) {
        try {
          const result = await hook.handler(context);
          events.push({ hookId: hook.id, point, ok: result.ok, message: result.message, timestamp: Date.now() });
        } catch (error) {
          events.push({ hookId: hook.id, point, ok: false, error: error instanceof Error ? error.message : String(error), timestamp: Date.now() });
        }
      }

      return events;
    },
  };
}

// --- AgentTool Handler ---

export interface AgentToolInput {
  readonly agentId: string;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly tools: readonly string[];
  readonly maxSteps: number;
}

export interface AgentToolHandler {
  execute(input: AgentToolInput): Promise<SessionToolExecutionResult>;
}

export function createAgentToolHandler(deps: {
  generate: (input: { messages: readonly { role: string; content: string }[]; systemPrompt: string; modelId: string; providerId: string }) => Promise<{ success: boolean; type: string; content?: string; toolUses?: readonly { id: string; name: string; input: Record<string, unknown> }[] }>;
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<{ ok: boolean; summary: string; data?: unknown }>;
}): AgentToolHandler {
  return {
    async execute(input: AgentToolInput): Promise<SessionToolExecutionResult> {
      const config: SubagentConfig = {
        id: input.agentId,
        name: input.agentId,
        systemPrompt: input.systemPrompt,
        modelId: input.modelId,
        providerId: input.providerId,
        tools: input.tools,
        maxSteps: input.maxSteps,
      };

      const result = await runSubagent({
        config,
        prompt: input.prompt,
        generate: async (genInput) => deps.generate({
          messages: genInput.messages.map((m) => ({ role: m.role, content: m.content })),
          systemPrompt: genInput.systemPrompt,
          modelId: genInput.modelId,
          providerId: genInput.providerId,
        }) as never,
        executeTool: deps.executeTool,
      });

      return {
        ok: result.ok,
        summary: result.content ?? (result.ok ? "子代理执行完成" : `子代理停止：${result.stopReason}`),
        data: { agentId: input.agentId, stopReason: result.stopReason, toolResults: result.toolResults },
      };
    },
  };
}
