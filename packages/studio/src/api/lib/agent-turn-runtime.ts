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
import type { ProviderReasoningPolicy } from "../../shared/provider-catalog.js";
import type { LlmRuntimeFailureCode } from "./llm-runtime-service.js";
import type { RuntimeToolUse, RuntimeToolStreamEvent } from "./provider-adapters/index.js";
import { filterSessionToolsForProvider } from "./session-tool-policy.js";
import { logRequest, normalizeTokenUsage } from "./request-observability.js";

export type AgentTurnItem =
  | { readonly type: "message"; readonly role: "system" | "user" | "assistant"; readonly content: string; readonly reasoning_content?: string; readonly id?: string; readonly metadata?: Record<string, unknown> }
  | { readonly type: "tool_call"; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: "tool_result"; readonly toolCallId: string; readonly name: string; readonly content: string; readonly data?: unknown; readonly metadata?: Record<string, unknown> };

export interface AgentGenerateInput {
  readonly sessionConfig: SessionConfig;
  readonly messages: readonly AgentTurnItem[];
  readonly tools: readonly SessionToolDefinition[];
  readonly permissionMode: SessionPermissionMode;
  readonly canvasContext?: CanvasContext;
  readonly onStreamChunk?: (chunk: string) => void;
  readonly onToolEvent?: (event: RuntimeToolStreamEvent) => void;
  readonly signal?: AbortSignal;
}

export type AgentGenerateResult =
  | { readonly success: true; readonly type?: "message"; readonly content: string; readonly reasoningContent?: string; readonly metadata: NarratorSessionRuntimeMetadata }
  | { readonly success: true; readonly type: "tool_use"; readonly toolUses: readonly RuntimeToolUse[]; readonly reasoningContent?: string; readonly metadata: NarratorSessionRuntimeMetadata }
  | { readonly success: false; readonly code: LlmRuntimeFailureCode | string; readonly error: string; readonly metadata?: Partial<NarratorSessionRuntimeMetadata> };

export type AgentToolExecutionInput = Omit<SessionToolExecutionInput, "sessionConfig"> & {
  readonly sessionConfig: SessionConfig;
};

export type AgentTurnEvent =
  | { readonly type: "assistant_message"; readonly content: string; readonly reasoningContent?: string; readonly runtime: NarratorSessionRuntimeMetadata }
  | { readonly type: "streaming_chunk"; readonly content: string }
  | { readonly type: "reasoning_chunk"; readonly content: string }
  | { readonly type: "tool_call"; readonly id: string; readonly toolName: string; readonly input: Record<string, unknown>; readonly runtime: NarratorSessionRuntimeMetadata }
  | { readonly type: "tool_result"; readonly id: string; readonly toolName: string; readonly result: SessionToolExecutionResult; readonly runtime?: NarratorSessionRuntimeMetadata }
  | { readonly type: "confirmation_required"; readonly id: string; readonly toolName: string; readonly result: SessionToolExecutionResult; readonly sourceToolUseId?: string }
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
  readonly onStreamChunk?: (chunk: string) => void;
  readonly onToolEvent?: (event: RuntimeToolStreamEvent) => void;
  readonly onEvent?: (event: AgentTurnEvent) => void;
  readonly reasoningPolicy?: ProviderReasoningPolicy;
  readonly signal?: AbortSignal;
  /** Fix: silentToolCallThreshold — 连续无文本输出的工具调用次数阈值，超过后注入提示 */
  readonly silentToolCallThreshold?: number;
  /** 工具执行超时（毫秒），默认 60000 */
  readonly toolTimeoutMs?: number;
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

function isContextOverflowError(code: string, errorMessage: string): boolean {
  const overflowIndicators = ["context_length_exceeded", "maximum context length", "token limit", "context window"];
  const combined = `${code} ${errorMessage}`.toLowerCase();
  return overflowIndicators.some(indicator => combined.includes(indicator));
}

function emergencyTruncateMessages(messages: AgentTurnItem[], keepRecent: number = 10): AgentTurnItem[] {
  if (messages.length <= keepRecent + 2) return messages;

  const firstSystem = messages.find(m => m.type === "message" && m.role === "system");
  // Keep at most 1/3 of messages — aggressive truncation to ensure the retry
  // fits within context limits even if individual messages are large.
  // The 1/3 ratio is a heuristic: system prompt ≈ 1/3, recent context ≈ 1/3,
  // leaving 1/3 headroom for the model's response.
  const actualKeep = Math.min(keepRecent, Math.floor(messages.length / 3));
  let recentMessages = messages.slice(-actualKeep);

  // Ensure we don't start with an orphaned tool_result (models reject this)
  while (recentMessages.length > 0 && recentMessages[0]!.type === "tool_result") {
    recentMessages = recentMessages.slice(1);
  }

  const truncationNotice: AgentTurnItem = {
    type: "message",
    role: "system",
    content: "[对话历史已因上下文溢出被紧急压缩。以下是最近的对话内容。]",
  };

  return firstSystem
    ? [firstSystem, truncationNotice, ...recentMessages]
    : [truncationNotice, ...recentMessages];
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

function getContextAwareInstruction(toolName: string, result: SessionToolExecutionResult): string {
  const base = TOOL_RESULT_CONTINUATION_INSTRUCTION;
  if (toolName === "Write" || toolName === "Edit") {
    return `${base}\n\n提示：文件已修改。如果这是关键改动，考虑运行 typecheck 或相关测试验证正确性。`;
  }
  if (toolName === "Bash" && !result.ok) {
    return `${base}\n\n提示：命令执行失败。请分析错误原因，不要盲目重试相同命令。`;
  }
  return base;
}

/** 截断过长的工具结果，保留头尾 + 省略提示 */
const MAX_TOOL_RESULT_CHARS = 30000;
const TRUNCATE_HEAD = 20000;
const TRUNCATE_TAIL = 5000;

function truncateToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  const omitted = content.length - TRUNCATE_HEAD - TRUNCATE_TAIL;
  return `${content.slice(0, TRUNCATE_HEAD)}\n\n[... 已省略 ${omitted} 字符 (约 ${Math.round(omitted / 4)} tokens) ...]\n\n${content.slice(-TRUNCATE_TAIL)}`;
}

function toolResultContent(result: SessionToolExecutionResult, toolName?: string): string {
  const instruction = toolName ? getContextAwareInstruction(toolName, result) : TOOL_RESULT_CONTINUATION_INSTRUCTION;
  let content = result.summary ?? "";
  // 将 data 中的关键结果附加到 content（让模型能看到实际数据）
  if (result.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    // Glob: 文件列表
    if (Array.isArray(data.matches) && data.matches.length > 0) {
      content += "\n\n" + (data.matches as string[]).join("\n");
    }
    // Grep: 匹配行
    if (Array.isArray(data.results) && data.results.length > 0) {
      content += "\n\n" + (data.results as string[]).join("\n");
    }
    // Read/LearningGuide: 文件内容
    if (typeof data.content === "string" && data.content.trim()) {
      content += "\n\n" + data.content;
    }
    // Grep fallback: output 字段
    if (typeof data.output === "string" && data.output.trim()) {
      content += "\n\n" + data.output;
    }
    // Terminal read: 终端输出
    if (typeof data.terminalId === "string" && typeof data.output === "string") {
      // already handled above
    }
    // Browser: text/html/result
    if (typeof data.text === "string" && data.text.trim()) {
      content += "\n\n" + data.text;
    }
    if (typeof data.html === "string" && data.html.trim()) {
      content += "\n\n" + data.html;
    }
    if (typeof data.result === "string" && data.result.trim() && !data.text && !data.html) {
      content += "\n\n" + data.result;
    }
    // Hooks list / generic arrays with meaningful string content
    if (Array.isArray(data.hooks) && data.hooks.length > 0 && !data.matches && !data.results) {
      content += "\n\n" + (data.hooks as Array<{ description?: string; done?: boolean }>).map((h, i) => `${i + 1}. ${h.done ? "[已兑现]" : "[待兑现]"} ${h.description ?? ""}`).join("\n");
    }
    // LearningGuide list/search: docs array
    if (Array.isArray(data.docs) && data.docs.length > 0) {
      content += "\n\n" + (data.docs as Array<{ id?: string; title?: string }>).map(d => `- ${d.title ?? d.id ?? ""}`).join("\n");
    }
    // Recall/search results
    if (Array.isArray(data.sessions) && data.sessions.length > 0 && !data.docs) {
      content += "\n\n" + (data.sessions as Array<{ id?: string; title?: string }>).map(s => `- ${s.title ?? s.id ?? ""}`).join("\n");
    }
    // Terminal list
    if (data.terminals && typeof data.terminals === "object" && !Array.isArray(data.terminals)) {
      const terms = data.terminals as { running?: Array<{ id: string; name: string }>; exited?: Array<{ id: string; name: string }> };
      if (terms.running?.length) content += "\n\n运行中: " + terms.running.map(t => `${t.name}(${t.id})`).join(", ");
    }
  }
  return content ? truncateToolResult(`${content}\n\n${instruction}`) : instruction;
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
  const emit = (event: AgentTurnEvent) => { events.push(event); input.onEvent?.(event); };
  const messages = buildInitialMessages(input);
  const filteredTools = filterSessionToolsForProvider(input.tools, input.sessionConfig.toolPolicy, {
    permissionMode: input.permissionMode,
    ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
  });
  if (input.tools.length > 0 && filteredTools.tools.length === 0) {
    emit({
      type: "turn_failed",
      reason: "policy-disabled",
      message: "当前 session 工具策略禁用了所有可发送给模型的工具。",
      data: { deniedTools: filteredTools.deniedTools },
    });
    return events;
  }
  const maxSteps = Math.max(0, input.maxSteps ?? 30);
  let executedToolSteps = 0;
  let hasAttemptedOverflowRecovery = false;
  const recentToolCalls: string[] = [];
  const toolResultsBySignature = new Map<string, SessionToolExecutionResult>();
  // Error recovery: track consecutive failures per tool name
  const consecutiveFailures = new Map<string, number>();
  // Fix: silentToolCallThreshold — 跟踪连续无文本输出的工具调用次数
  let consecutiveSilentToolCalls = 0;
  const silentThreshold = input.silentToolCallThreshold ?? -1; // -1 = disabled

  const emitStreamChunk = input.onStreamChunk
    ? (chunk: string) => {
        events.push({ type: "streaming_chunk", content: chunk });
        input.onStreamChunk!(chunk);
      }
    : undefined;

  const emitToolEvent = input.onToolEvent;

  for (;;) {
    if (input.signal?.aborted) {
      console.log(JSON.stringify({ component: "agent-turn-runtime", event: "aborted", sessionId: input.sessionId, executedToolSteps }));
      emit({ type: "turn_completed" });
      return events;
    }

    const generateStartedAt = Date.now();
    const reply = await input.generate({
      sessionConfig: input.sessionConfig,
      messages,
      tools: filteredTools.tools,
      permissionMode: input.permissionMode,
      ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
      ...(emitStreamChunk ? { onStreamChunk: emitStreamChunk } : {}),
      ...(emitToolEvent ? { onToolEvent: emitToolEvent } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const generateDurationMs = Date.now() - generateStartedAt;

    // Log AI request for usage history
    logRequest({
      timestamp: new Date().toISOString(),
      method: "AI",
      endpoint: "agent-turn",
      status: reply.success ? 200 : 500,
      duration: generateDurationMs,
      userId: "system",
      requestKind: "agent-turn",
      narrator: input.sessionId,
      provider: reply.success ? (reply.metadata.providerName || reply.metadata.providerId) : (reply.metadata?.providerName || reply.metadata?.providerId),
      model: reply.success ? reply.metadata.modelId : reply.metadata?.modelId,
      tokens: normalizeTokenUsage(
        reply.success && reply.metadata.usage
          ? {
              input: reply.metadata.usage.input_tokens,
              output: reply.metadata.usage.output_tokens,
              total: (reply.metadata.usage.input_tokens ?? 0) + (reply.metadata.usage.output_tokens ?? 0),
            }
          : undefined,
      ),
      requestDomain: "ai",
      sessionId: input.sessionId,
      ...(reply.success ? {} : { aiStatus: "error", errorSummary: reply.error }),
    });

    if (!reply.success) {
      console.log(JSON.stringify({ component: "agent-turn-runtime", event: "generate-failed", sessionId: input.sessionId, code: reply.code, durationMs: generateDurationMs }));

      // Attempt context overflow recovery (max 1 retry)
      if (!hasAttemptedOverflowRecovery && isContextOverflowError(reply.code, reply.error)) {
        hasAttemptedOverflowRecovery = true;
        const originalCount = messages.length;
        const truncated = emergencyTruncateMessages(messages);

        if (truncated.length < originalCount) {
          console.log(JSON.stringify({ component: "agent-turn-runtime", event: "context-overflow-detected", sessionId: input.sessionId, originalCount, truncatedCount: truncated.length }));

          // Replace messages with truncated version
          messages.length = 0;
          messages.push(...truncated);

          console.log(JSON.stringify({ component: "agent-turn-runtime", event: "context-overflow-retry", sessionId: input.sessionId, messageCount: messages.length }));

          // Retry generate with truncated messages
          const retryStartedAt = Date.now();
          const retryReply = await input.generate({
            sessionConfig: input.sessionConfig,
            messages,
            tools: filteredTools.tools,
            permissionMode: input.permissionMode,
            ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
            ...(emitStreamChunk ? { onStreamChunk: emitStreamChunk } : {}),
            ...(emitToolEvent ? { onToolEvent: emitToolEvent } : {}),
            ...(input.signal ? { signal: input.signal } : {}),
          });
          const retryDurationMs = Date.now() - retryStartedAt;

          // Log retry AI request for usage history
          logRequest({
            timestamp: new Date().toISOString(),
            method: "AI",
            endpoint: "agent-turn",
            status: retryReply.success ? 200 : 500,
            duration: retryDurationMs,
            userId: "system",
            requestKind: "agent-turn-retry",
            narrator: input.sessionId,
            provider: retryReply.success ? (retryReply.metadata.providerName || retryReply.metadata.providerId) : (retryReply.metadata?.providerName || retryReply.metadata?.providerId),
            model: retryReply.success ? retryReply.metadata.modelId : retryReply.metadata?.modelId,
            tokens: normalizeTokenUsage(
              retryReply.success && retryReply.metadata.usage
                ? {
                    input: retryReply.metadata.usage.input_tokens,
                    output: retryReply.metadata.usage.output_tokens,
                    total: (retryReply.metadata.usage.input_tokens ?? 0) + (retryReply.metadata.usage.output_tokens ?? 0),
                  }
                : undefined,
            ),
            requestDomain: "ai",
            sessionId: input.sessionId,
            ...(retryReply.success ? {} : { aiStatus: "error", errorSummary: retryReply.error }),
          });

          if (retryReply.success) {
            console.log(JSON.stringify({ component: "agent-turn-runtime", event: "context-overflow-recovery-success", sessionId: input.sessionId }));
            // Re-assign and continue the loop by processing retryReply below
            // We need to handle the retryReply the same way as a normal reply
            if (retryReply.type !== "tool_use") {
              const content = retryReply.content.trim();
              if (!content) {
                emit({ type: "turn_failed", reason: "empty-response", message: "Agent runtime returned an empty response after overflow recovery" });
                return events;
              }
              consecutiveSilentToolCalls = 0;
              emit({ type: "assistant_message", content, reasoningContent: retryReply.reasoningContent, runtime: retryReply.metadata });
              emit({ type: "turn_completed" });
              return events;
            }
            // For tool_use after recovery, push tool calls into messages and continue the loop
            // We'll let the next iteration handle it by injecting an assistant placeholder
            // Actually, we need to process tool_use inline here — fall through won't work cleanly.
            // Simplest: re-enter the loop by using `continue` after setting up state.
            // But we can't reassign `reply` (const). Instead, just continue — next iteration will re-generate.
            // The truncated messages are already set, so next loop iteration will call generate() again.
            // But wait — we already got a successful retryReply with tool_use. We should not re-generate.
            // Best approach: push the tool uses as messages and continue the loop to execute them.
            if (retryReply.reasoningContent) {
              const retryPolicy = input.reasoningPolicy ?? "passback-on-tool-loop";
              if (retryPolicy !== "strip") {
                messages.push({ type: "message", role: "assistant", content: "", reasoning_content: retryReply.reasoningContent });
              }
            }
            for (const toolUse of retryReply.toolUses) {
              if (executedToolSteps >= maxSteps) {
                emit({ type: "turn_failed", reason: "tool-loop-limit", message: `工具循环超过 ${maxSteps} 步，已停止本轮调用。可在设置 → AI 代理 → 每条消息最大轮次中调高此限制。`, data: { maxSteps, recentToolCalls } });
                return events;
              }
              emit({ type: "tool_call", id: toolUse.id, toolName: toolUse.name, input: toolUse.input, runtime: retryReply.metadata });
              messages.push({ type: "tool_call", id: toolUse.id, name: toolUse.name, input: toolUse.input });
              recentToolCalls.push(toolUse.name);

              const toolStartedAt = Date.now();
              const signature = toolSignature(toolUse.name, toolUse.input);
              const duplicateResult = toolResultsBySignature.get(signature);
              const toolResult = duplicateResult
                ? createDuplicateToolResult(duplicateResult)
                : await withToolTimeout(
                    input.executeTool({
                      sessionId: input.sessionId,
                      toolName: toolUse.name,
                      toolCallId: toolUse.id,
                      input: toolUse.input,
                      permissionMode: input.permissionMode,
                      sessionConfig: input.sessionConfig,
                      ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
                    }),
                    input.toolTimeoutMs ?? 60000,
                    toolUse.name,
                    input.signal,
                  );
              const toolDurationMs = Date.now() - toolStartedAt;
              executedToolSteps += 1;
              console.log(JSON.stringify({ component: "agent-turn-runtime", event: "tool-executed", sessionId: input.sessionId, toolName: toolUse.name, ok: toolResult.ok, durationMs: toolDurationMs, duplicate: Boolean(duplicateResult), step: executedToolSteps }));
              if (!duplicateResult) {
                toolResultsBySignature.set(signature, toolResult);
              }
              emit({ type: "tool_result", id: toolUse.id, toolName: toolUse.name, result: toolResult, runtime: retryReply.metadata });
              messages.push({
                type: "tool_result",
                toolCallId: toolUse.id,
                name: toolUse.name,
                content: toolResultContent(toolResult, toolUse.name),
                ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
                metadata: { toolResult },
              });

              if (isPendingConfirmationResult(toolResult)) {
                emit({ type: "confirmation_required", id: toolResult.confirmation?.id ?? toolUse.id, toolName: toolUse.name, result: toolResult, sourceToolUseId: toolUse.id });
                return events;
              }
              if (input.shouldContinueAfterToolResult && !input.shouldContinueAfterToolResult({ toolName: toolUse.name, result: toolResult })) {
                emit({ type: "turn_failed", reason: toolResult.error ?? "tool-execution-failed", message: toolResult.summary });
                return events;
              }
              consecutiveSilentToolCalls += 1;
            }
            // After processing retry tool uses, continue the main loop for next generate
            continue;
          } else {
            console.log(JSON.stringify({ component: "agent-turn-runtime", event: "context-overflow-recovery-failed", sessionId: input.sessionId, code: retryReply.code }));
            // Fall through to emit failure with the retry's error
            emit(buildFailureEvent(retryReply));
            return events;
          }
        }
      }

      emit(buildFailureEvent(reply));
      return events;
    }

    const usage = reply.metadata?.usage;
    console.log(JSON.stringify({ component: "agent-turn-runtime", event: "generate-ok", sessionId: input.sessionId, type: reply.type ?? "message", durationMs: generateDurationMs, ...(usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : {}) }));

    if (reply.type !== "tool_use") {
      const content = reply.content.trim();
      if (!content) {
        emit({ type: "turn_failed", reason: "empty-response", message: "Agent runtime returned an empty response" });
        return events;
      }
      consecutiveSilentToolCalls = 0; // Fix: reset on assistant message
      emit(
        { type: "assistant_message", content, reasoningContent: reply.reasoningContent, runtime: reply.metadata },
      );
      emit(
        { type: "turn_completed" },
      );
      return events;
    }

    if (reply.toolUses.length === 0) {
      emit({ type: "turn_failed", reason: "empty-tool-use", message: "Agent runtime received a tool_use reply without executable tools" });
      return events;
    }

    // Insert assistant message with reasoning_content before tool calls
    // Controlled by reasoningPolicy: strip (never), passback-on-tool-loop (default, tool loops only), always-passback (always)
    const policy = input.reasoningPolicy ?? "passback-on-tool-loop";
    if (reply.reasoningContent && policy !== "strip") {
      messages.push({ type: "message", role: "assistant", content: "", reasoning_content: reply.reasoningContent });
    }

    // Determine if all tools in this batch are read-only (parallelizable)
    const PARALLEL_SAFE_TOOLS = new Set([
      "Read", "Glob", "Grep", "WebSearch", "WebFetch",
      "GetGoals", "LearningGuide", "Recall",
    ]);

    const allParallelSafe = reply.toolUses.length > 1 && reply.toolUses.every(tu => PARALLEL_SAFE_TOOLS.has(tu.name));

    if (allParallelSafe) {
      // --- Parallel execution path ---
      // Pre-check: enough steps remaining?
      if (executedToolSteps + reply.toolUses.length > maxSteps) {
        emit({
          type: "turn_failed",
          reason: "tool-loop-limit",
          message: `工具循环超过 ${maxSteps} 步，已停止本轮调用。可在设置 → AI 代理 → 每条消息最大轮次中调高此限制。`,
          data: { maxSteps, recentToolCalls },
        });
        return events;
      }

      console.log(JSON.stringify({ component: "agent-turn-runtime", event: "parallel-tool-execution", count: reply.toolUses.length, sessionId: input.sessionId }));

      // Emit all tool_call events first
      for (const toolUse of reply.toolUses) {
        emit({
          type: "tool_call",
          id: toolUse.id,
          toolName: toolUse.name,
          input: toolUse.input,
          runtime: reply.metadata,
        });
        messages.push({ type: "tool_call", id: toolUse.id, name: toolUse.name, input: toolUse.input });
        recentToolCalls.push(toolUse.name);
      }

      // Execute all tools in parallel
      const parallelResults = await Promise.all(
        reply.toolUses.map(async (toolUse) => {
          const toolStartedAt = Date.now();
          const signature = toolSignature(toolUse.name, toolUse.input);
          const duplicateResult = toolResultsBySignature.get(signature);
          let toolResult: SessionToolExecutionResult;
          try {
            toolResult = duplicateResult
              ? createDuplicateToolResult(duplicateResult)
              : await withToolTimeout(
                  input.executeTool({
                    sessionId: input.sessionId,
                    toolName: toolUse.name,
                    toolCallId: toolUse.id,
                    input: toolUse.input,
                    permissionMode: input.permissionMode,
                    sessionConfig: input.sessionConfig,
                    ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
                  }),
                  input.toolTimeoutMs ?? 60000,
                  toolUse.name,
                  input.signal,
                );
          } catch (err) {
            console.log(JSON.stringify({ component: "agent-turn-runtime", event: "tool-execution-error", sessionId: input.sessionId, toolName: toolUse.name, error: err instanceof Error ? err.message : String(err) }));
            toolResult = { ok: false, error: "tool-execution-error", summary: `工具 ${toolUse.name} 执行异常: ${err instanceof Error ? err.message : String(err)}` };
          }
          const toolDurationMs = Date.now() - toolStartedAt;
          return { toolUse, toolResult, toolDurationMs, signature, isDuplicate: Boolean(duplicateResult) };
        }),
      );

      // Process results sequentially to maintain event order
      for (let { toolUse, toolResult, toolDurationMs, signature, isDuplicate } of parallelResults) {
        if (input.signal?.aborted) {
          emit({ type: "turn_completed" });
          return events;
        }

        executedToolSteps += 1;
        console.log(JSON.stringify({ component: "agent-turn-runtime", event: "tool-executed", sessionId: input.sessionId, toolName: toolUse.name, ok: toolResult.ok, durationMs: toolDurationMs, duplicate: isDuplicate, step: executedToolSteps }));
        if (!isDuplicate) {
          toolResultsBySignature.set(signature, toolResult);
        }

        // Error recovery: track consecutive failures
        if (!toolResult.ok) {
          const count = (consecutiveFailures.get(toolUse.name) ?? 0) + 1;
          consecutiveFailures.set(toolUse.name, count);
          if (count >= 3) {
            toolResult = { ...toolResult, summary: `${toolResult.summary ?? ""}\n\n❌ 该工具已连续失败 ${count} 次，请停下来向用户说明情况。` };
          } else if (count >= 2) {
            toolResult = { ...toolResult, summary: `${toolResult.summary ?? ""}\n\n⚠️ 该工具已连续失败 ${count} 次，请考虑换一种方法。` };
          }
        } else {
          consecutiveFailures.delete(toolUse.name);
        }

        emit({
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
          content: toolResultContent(toolResult, toolUse.name),
          ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
          metadata: { toolResult },
        });

        if (isPendingConfirmationResult(toolResult)) {
          emit({
            type: "confirmation_required",
            id: toolResult.confirmation?.id ?? toolUse.id,
            toolName: toolUse.name,
            result: toolResult,
            sourceToolUseId: toolUse.id,
          });
          return events;
        }

        if (input.shouldContinueAfterToolResult && !input.shouldContinueAfterToolResult({ toolName: toolUse.name, result: toolResult })) {
          emit({
            type: "turn_failed",
            reason: toolResult.error ?? "tool-execution-failed",
            message: toolResult.summary,
          });
          return events;
        }

        consecutiveSilentToolCalls += 1;
      }
    } else {
      // --- Sequential execution path (existing behavior) ---
      for (const toolUse of reply.toolUses) {
        if (executedToolSteps >= maxSteps) {
          emit({
            type: "turn_failed",
            reason: "tool-loop-limit",
            message: `工具循环超过 ${maxSteps} 步，已停止本轮调用。可在设置 → AI 代理 → 每条消息最大轮次中调高此限制。`,
            data: { maxSteps, recentToolCalls },
          });
          return events;
        }

        emit({
          type: "tool_call",
          id: toolUse.id,
          toolName: toolUse.name,
          input: toolUse.input,
          runtime: reply.metadata,
        });
        messages.push({ type: "tool_call", id: toolUse.id, name: toolUse.name, input: toolUse.input });
        recentToolCalls.push(toolUse.name);

        const toolStartedAt = Date.now();
        const signature = toolSignature(toolUse.name, toolUse.input);
        const duplicateResult = toolResultsBySignature.get(signature);
        let toolResult: SessionToolExecutionResult;
        try {
          toolResult = duplicateResult
            ? createDuplicateToolResult(duplicateResult)
            : await withToolTimeout(
                input.executeTool({
                  sessionId: input.sessionId,
                  toolName: toolUse.name,
                  toolCallId: toolUse.id,
                  input: toolUse.input,
                  permissionMode: input.permissionMode,
                  sessionConfig: input.sessionConfig,
                  ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
                }),
                input.toolTimeoutMs ?? 60000,
                toolUse.name,
                input.signal,
              );        } catch (err) {
          console.log(JSON.stringify({ component: "agent-turn-runtime", event: "tool-execution-error", sessionId: input.sessionId, toolName: toolUse.name, error: err instanceof Error ? err.message : String(err) }));
          toolResult = { ok: false, error: "tool-execution-error", summary: `工具 ${toolUse.name} 执行异常: ${err instanceof Error ? err.message : String(err)}` };
        }
        const toolDurationMs = Date.now() - toolStartedAt;
        executedToolSteps += 1;
        console.log(JSON.stringify({ component: "agent-turn-runtime", event: "tool-executed", sessionId: input.sessionId, toolName: toolUse.name, ok: toolResult.ok, durationMs: toolDurationMs, duplicate: Boolean(duplicateResult), step: executedToolSteps }));
        if (!duplicateResult) {
          toolResultsBySignature.set(signature, toolResult);
        }

        // Error recovery: track consecutive failures
        if (!toolResult.ok) {
          const count = (consecutiveFailures.get(toolUse.name) ?? 0) + 1;
          consecutiveFailures.set(toolUse.name, count);
          if (count >= 3) {
            toolResult = { ...toolResult, summary: `${toolResult.summary ?? ""}\n\n❌ 该工具已连续失败 ${count} 次，请停下来向用户说明情况。` };
          } else if (count >= 2) {
            toolResult = { ...toolResult, summary: `${toolResult.summary ?? ""}\n\n⚠️ 该工具已连续失败 ${count} 次，请考虑换一种方法。` };
          }
        } else {
          consecutiveFailures.delete(toolUse.name);
        }

        emit({
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
          content: toolResultContent(toolResult, toolUse.name),
          ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
          metadata: { toolResult },
        });

        if (isPendingConfirmationResult(toolResult)) {
          emit({
            type: "confirmation_required",
            id: toolResult.confirmation?.id ?? toolUse.id,
            toolName: toolUse.name,
            result: toolResult,
            sourceToolUseId: toolUse.id,
          });
          return events;
        }

        if (input.shouldContinueAfterToolResult && !input.shouldContinueAfterToolResult({ toolName: toolUse.name, result: toolResult })) {
          emit({
            type: "turn_failed",
            reason: toolResult.error ?? "tool-execution-failed",
            message: toolResult.summary,
          });
          return events;
        }

        // Fix: silentToolCallThreshold — 递增连续无文本输出计数
        consecutiveSilentToolCalls += 1;
      }
    }

    // Fix: silentToolCallThreshold — 超过阈值时注入提示
    if (silentThreshold > 0 && consecutiveSilentToolCalls >= silentThreshold) {
      messages.push({
        type: "message",
        role: "system",
        content: `注意：你已经连续执行了 ${consecutiveSilentToolCalls} 次工具调用而没有向用户输出任何文字。请在下一步中向用户汇报当前进展或结果。`,
      });
    }
  }
}

function withToolTimeout(
  promise: Promise<SessionToolExecutionResult>,
  timeoutMs: number,
  toolName: string,
  signal?: AbortSignal,
): Promise<SessionToolExecutionResult> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result: SessionToolExecutionResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({
        ok: false,
        error: "tool-timeout",
        summary: `工具 ${toolName} 执行超时（${Math.round(timeoutMs / 1000)}s）。`,
      });
    }, timeoutMs);

    const onAbort = () => {
      done({
        ok: false,
        error: "tool-aborted",
        summary: `工具 ${toolName} 已被用户中断。`,
      });
    };
    if (signal?.aborted) { done({ ok: false, error: "tool-aborted", summary: `工具 ${toolName} 已被用户中断。` }); return; }
    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then((result) => {
      done(result);
    }).catch((error) => {
      done({
        ok: false,
        error: "tool-execution-error",
        summary: `工具 ${toolName} 执行异常：${error instanceof Error ? error.message : String(error)}`,
      });
    });
  });
}
