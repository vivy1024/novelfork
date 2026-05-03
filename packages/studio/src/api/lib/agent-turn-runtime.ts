import type {
  CanvasContext,
  SessionToolDefinition,
  SessionToolExecutionInput,
  SessionToolExecutionResult,
} from "../../shared/agent-native-workspace.js";
import type {
  NarratorSessionRuntimeMetadata,
  SessionConfig,
  SessionPermissionMode,
} from "../../shared/session-types.js";
import type { LlmRuntimeFailureCode } from "./llm-runtime-service.js";
import type { RuntimeToolUse } from "./provider-adapters/index.js";

export type AgentTurnItem =
  | { readonly type: "message"; readonly role: "system" | "user" | "assistant"; readonly content: string; readonly id?: string; readonly metadata?: Record<string, unknown> }
  | { readonly type: "tool_call"; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: "tool_result"; readonly toolCallId: string; readonly name: string; readonly content: string; readonly data?: unknown; readonly metadata?: Record<string, unknown> };

export interface AgentGenerateInput {
  readonly sessionConfig: SessionConfig;
  readonly messages: readonly AgentTurnItem[];
  readonly tools: readonly SessionToolDefinition[];
  readonly permissionMode: SessionPermissionMode;
  readonly canvasContext?: CanvasContext;
}

export type AgentGenerateResult =
  | { readonly success: true; readonly type?: "message"; readonly content: string; readonly metadata: NarratorSessionRuntimeMetadata }
  | { readonly success: true; readonly type: "tool_use"; readonly toolUses: readonly RuntimeToolUse[]; readonly metadata: NarratorSessionRuntimeMetadata }
  | { readonly success: false; readonly code: LlmRuntimeFailureCode | string; readonly error: string; readonly metadata?: Partial<NarratorSessionRuntimeMetadata> };

export type AgentToolExecutionInput = Omit<SessionToolExecutionInput, "sessionConfig"> & {
  readonly sessionConfig: SessionConfig;
};

export type AgentTurnEvent =
  | { readonly type: "assistant_message"; readonly content: string; readonly runtime: NarratorSessionRuntimeMetadata }
  | { readonly type: "tool_call"; readonly id: string; readonly toolName: string; readonly input: Record<string, unknown>; readonly runtime: NarratorSessionRuntimeMetadata }
  | { readonly type: "tool_result"; readonly id: string; readonly toolName: string; readonly result: SessionToolExecutionResult; readonly runtime?: NarratorSessionRuntimeMetadata }
  | { readonly type: "confirmation_required"; readonly id: string; readonly toolName: string; readonly result: SessionToolExecutionResult }
  | { readonly type: "turn_completed" }
  | { readonly type: "turn_failed"; readonly reason: string; readonly message: string; readonly data?: Record<string, unknown> };

export interface AgentTurnRuntimeInput {
  readonly sessionId: string;
  readonly sessionConfig: SessionConfig;
  readonly messages: readonly AgentTurnItem[];
  readonly systemPrompt: string;
  readonly context?: string;
  readonly tools: readonly SessionToolDefinition[];
  readonly permissionMode: SessionPermissionMode;
  readonly canvasContext?: CanvasContext;
  readonly generate: (input: AgentGenerateInput) => Promise<AgentGenerateResult>;
  readonly executeTool: (input: AgentToolExecutionInput) => Promise<SessionToolExecutionResult>;
  readonly shouldContinueAfterToolResult?: (input: { readonly toolName: string; readonly result: SessionToolExecutionResult }) => boolean;
  readonly maxSteps?: number;
}

function buildSystemContent(systemPrompt: string, context?: string): string {
  const trimmedPrompt = systemPrompt.trim();
  const trimmedContext = context?.trim();
  if (!trimmedContext) return trimmedPrompt;
  if (!trimmedPrompt) return trimmedContext;
  return `${trimmedPrompt}\n\n${trimmedContext}`;
}

function buildInitialMessages(input: AgentTurnRuntimeInput): AgentTurnItem[] {
  const systemContent = buildSystemContent(input.systemPrompt, input.context);
  if (!systemContent) {
    return [...input.messages];
  }

  const [firstMessage, ...restMessages] = input.messages;
  if (firstMessage?.type === "message" && firstMessage.role === "system") {
    return [{ ...firstMessage, content: systemContent }, ...restMessages];
  }

  return [{ type: "message", role: "system", content: systemContent }, ...input.messages];
}

function buildFailureEvent(reply: Extract<AgentGenerateResult, { success: false }>): AgentTurnEvent {
  return {
    type: "turn_failed",
    reason: reply.code,
    message: reply.error,
    ...(reply.metadata ? { data: { metadata: reply.metadata } } : {}),
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function toolSignature(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}:${stableJson(input)}`;
}

const TOOL_RESULT_CONTINUATION_INSTRUCTION = "工具已完成。请先总结已经获得的信息，判断是否足够进入下一步。如果信息足够，请继续执行下一步；不要重复读取同一资源。";

function toolResultContent(result: SessionToolExecutionResult): string {
  return result.summary ? `${result.summary}\n\n${TOOL_RESULT_CONTINUATION_INSTRUCTION}` : TOOL_RESULT_CONTINUATION_INSTRUCTION;
}

function createDuplicateToolResult(firstResult: SessionToolExecutionResult): SessionToolExecutionResult {
  return {
    ok: true,
    summary: "已拦截重复工具调用：该工具与参数在本轮中已经执行过，请基于已有结果继续下一步。",
    data: {
      status: "duplicate-tool-call",
      firstSummary: firstResult.summary,
    },
  };
}

function isPendingConfirmationResult(result: SessionToolExecutionResult): boolean {
  return result.ok && (
    Boolean(result.confirmation)
    || (
      result.data !== null
      && typeof result.data === "object"
      && (result.data as { status?: unknown }).status === "pending-confirmation"
    )
  );
}

export async function runAgentTurn(input: AgentTurnRuntimeInput): Promise<AgentTurnEvent[]> {
  const events: AgentTurnEvent[] = [];
  const messages = buildInitialMessages(input);
  const maxSteps = Math.max(0, input.maxSteps ?? 6);
  let executedToolSteps = 0;
  const recentToolCalls: string[] = [];
  const toolResultsBySignature = new Map<string, SessionToolExecutionResult>();

  for (;;) {
    const reply = await input.generate({
      sessionConfig: input.sessionConfig,
      messages,
      tools: input.tools,
      permissionMode: input.permissionMode,
      ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
    });

    if (!reply.success) {
      events.push(buildFailureEvent(reply));
      return events;
    }

    if (reply.type !== "tool_use") {
      const content = reply.content.trim();
      if (!content) {
        events.push({ type: "turn_failed", reason: "empty-response", message: "Agent runtime returned an empty response" });
        return events;
      }
      events.push(
        { type: "assistant_message", content, runtime: reply.metadata },
        { type: "turn_completed" },
      );
      return events;
    }

    if (reply.toolUses.length === 0) {
      events.push({ type: "turn_failed", reason: "empty-tool-use", message: "Agent runtime received a tool_use reply without executable tools" });
      return events;
    }

    for (const toolUse of reply.toolUses) {
      if (executedToolSteps >= maxSteps) {
        events.push({
          type: "turn_failed",
          reason: "tool-loop-limit",
          message: `工具循环超过 ${maxSteps} 步，已停止本轮调用。`,
          data: { maxSteps, recentToolCalls },
        });
        return events;
      }

      const toolCallEvent: AgentTurnEvent = {
        type: "tool_call",
        id: toolUse.id,
        toolName: toolUse.name,
        input: toolUse.input,
        runtime: reply.metadata,
      };
      events.push(toolCallEvent);
      messages.push({ type: "tool_call", id: toolUse.id, name: toolUse.name, input: toolUse.input });
      recentToolCalls.push(toolUse.name);

      const signature = toolSignature(toolUse.name, toolUse.input);
      const duplicateResult = toolResultsBySignature.get(signature);
      const toolResult = duplicateResult
        ? createDuplicateToolResult(duplicateResult)
        : await input.executeTool({
          sessionId: input.sessionId,
          toolName: toolUse.name,
          input: toolUse.input,
          permissionMode: input.permissionMode,
          sessionConfig: input.sessionConfig,
          ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
        });
      executedToolSteps += 1;
      if (!duplicateResult) {
        toolResultsBySignature.set(signature, toolResult);
      }
      events.push({
        type: "tool_result",
        id: toolUse.id,
        toolName: toolUse.name,
        result: toolResult,
        runtime: reply.metadata,
      });
      messages.push({
        type: "tool_result",
        toolCallId: toolUse.id,
        name: toolUse.name,
        content: toolResultContent(toolResult),
        ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
        metadata: { toolResult },
      });

      if (isPendingConfirmationResult(toolResult)) {
        events.push({
          type: "confirmation_required",
          id: toolResult.confirmation?.id ?? toolUse.id,
          toolName: toolUse.name,
          result: toolResult,
        });
        return events;
      }

      if (input.shouldContinueAfterToolResult && !input.shouldContinueAfterToolResult({ toolName: toolUse.name, result: toolResult })) {
        events.push({
          type: "turn_failed",
          reason: toolResult.error ?? "tool-execution-failed",
          message: toolResult.summary,
        });
        return events;
      }
    }
  }
}
