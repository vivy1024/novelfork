/**
 * CompletionsAdapter — OpenAI Chat Completions 协议适配器。
 *
 * 从 OpenAiCompatibleAdapter 中提取的 /chat/completions 逻辑，
 * 供 openai-compatible 和 codex-platform 复用。
 */

import type { RuntimeModelInput } from "../provider-runtime-store.js";
import type {
  RuntimeProviderRef,
  TestModelInput,
  GenerateInput,
  GenerateResult,
  ListModelsResult,
  TestModelResult,
  RuntimeAdapter,
  RuntimeAdapterFailure,
  RuntimeAdapterFailureCode,
  RuntimeToolDefinition,
  RuntimeToolUse,
  GenerateUsage,
  RuntimeChatMessage,
} from "./index.js";
import { resolveCompletionsUrls, resolveModelsUrls } from "./url-resolver.js";

// ─── Helper Functions ────────────────────────────────────────────────────────

export function failure(code: RuntimeAdapterFailureCode, error: string, capability?: string): RuntimeAdapterFailure {
  return {
    success: false,
    code,
    error,
    ...(capability ? { capability } : {}),
  };
}

function requireOpenAiConfig(ref: RuntimeProviderRef): RuntimeAdapterFailure | null {
  if (!ref.apiKey?.trim()) {
    return failure("auth-missing", `API key missing for provider ${ref.providerId}`);
  }
  if (!ref.baseUrl?.trim()) {
    return failure("config-missing", `Base URL missing for provider ${ref.providerId}`);
  }
  return null;
}

export function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export function readOpenAiError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
  }
  return fallback;
}

export function safeJsonParse(str: string): Record<string, unknown> {
  try { return JSON.parse(str) as Record<string, unknown>; }
  catch { return {}; }
}

export function toProviderSafeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/gu, "_");
}

export function toInternalToolName(name: string, tools: readonly RuntimeToolDefinition[]): string {
  return tools.find((tool) => toProviderSafeToolName(tool.name) === name)?.name ?? name;
}

export function toOpenAiTools(tools: readonly RuntimeToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => {
    const safeName = toProviderSafeToolName(tool.name);
    return {
      type: "function",
      function: {
        name: safeName,
        description: safeName === tool.name ? tool.description : `${tool.description}\n\nInternal tool name: ${tool.name}`,
        parameters: tool.inputSchema,
      },
    };
  });
}

export function toOpenAiMessages(messages: readonly RuntimeChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const msg: Record<string, unknown> = {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toProviderSafeToolName(toolCall.name),
            arguments: JSON.stringify(toolCall.input),
          },
        })),
      };
      // Pass back reasoning_content for DeepSeek thinking mode tool loops
      if (message.reasoning_content) {
        msg.reasoning_content = message.reasoning_content;
      }
      return msg;
    }

    const msg: Record<string, unknown> = { role: message.role, content: message.content };
    // Pass back reasoning_content for DeepSeek thinking mode
    if (message.role === "assistant" && message.reasoning_content) {
      msg.reasoning_content = message.reasoning_content;
    }
    return msg;
  });
}

export function readOpenAiUsage(payload: unknown): GenerateUsage | undefined {
  if (!payload || typeof payload !== "object" || !("usage" in payload)) return undefined;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const promptTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  const completionTokens = typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
  if (promptTokens === 0 && completionTokens === 0) return undefined;
  return {
    input_tokens: promptTokens,
    output_tokens: completionTokens,
  };
}

export function readOpenAiToolUses(payload: unknown, tools: readonly RuntimeToolDefinition[] = []): RuntimeToolUse[] {
  const choices = payload && typeof payload === "object" && Array.isArray((payload as { choices?: unknown }).choices)
    ? (payload as { choices: unknown[] }).choices
    : [];
  const firstChoice = choices[0];
  const message = firstChoice && typeof firstChoice === "object" && "message" in firstChoice
    ? (firstChoice as { message?: unknown }).message
    : undefined;
  const toolCalls = message && typeof message === "object" && Array.isArray((message as { tool_calls?: unknown }).tool_calls)
    ? (message as { tool_calls: unknown[] }).tool_calls
    : [];

  return toolCalls.flatMap((toolCall, index) => {
    if (!isRecord(toolCall) || toolCall.type !== "function" || !isRecord(toolCall.function)) {
      return [];
    }

    const providerName = typeof toolCall.function.name === "string" ? toolCall.function.name : "";
    if (!providerName) {
      return [];
    }

    return [{
      id: typeof toolCall.id === "string" && toolCall.id.trim().length > 0 ? toolCall.id : `tool-call-${index + 1}`,
      name: toInternalToolName(providerName, tools),
      input: parseToolArguments(toolCall.function.arguments),
    }];
  });
}

export function normalizeOpenAiModel(value: unknown): RuntimeModelInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const model = value as Record<string, unknown>;
  const id = typeof model.id === "string" ? model.id : undefined;
  if (!id) {
    return null;
  }

  const contextWindow = typeof model.context_window === "number"
    ? model.context_window
    : typeof model.contextWindow === "number"
      ? model.contextWindow
      : 0;
  const maxOutputTokens = typeof model.max_output_tokens === "number"
    ? model.max_output_tokens
    : typeof model.maxOutputTokens === "number"
      ? model.maxOutputTokens
      : 0;

  return {
    id,
    name: typeof model.name === "string" ? model.name : id,
    contextWindow,
    maxOutputTokens,
    enabled: true,
    source: "detected",
    lastTestStatus: "untested",
    supportsFunctionCalling: true,
    supportsStreaming: true,
  };
}

/** Finalize accumulated OpenAI streaming tool_calls into RuntimeToolUse[] */
export function finalizeOpenAiStreamToolCalls(
  accumulators: Map<number, { id: string; name: string; arguments: string }>,
  tools?: readonly RuntimeToolDefinition[],
): RuntimeToolUse[] {
  const result: RuntimeToolUse[] = [];
  for (const [index, acc] of accumulators) {
    if (!acc.name) continue;
    let input: Record<string, unknown> = {};
    try {
      if (acc.arguments) input = JSON.parse(acc.arguments) as Record<string, unknown>;
    } catch { /* malformed arguments */ }
    result.push({
      id: acc.id || `tool-call-${index + 1}`,
      name: toInternalToolName(acc.name, tools ?? []),
      input,
    });
  }
  return result;
}

// ─── Internal Helpers (not exported) ─────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { rawArguments: value };
  }
}

/**
 * Make a JSON request to an OpenAI-compatible endpoint, trying multiple URL candidates.
 */
async function requestOpenAiJson(ref: RuntimeProviderRef, urls: string[], init: RequestInit): Promise<
  | { readonly success: true; readonly response: Response; readonly payload: unknown }
  | RuntimeAdapterFailure
> {
  let lastError = "OpenAI-compatible request failed";

  for (const [index, url] of urls.entries()) {
    const canRetry = index < urls.length - 1;
    try {
      const response = await fetch(url, init);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        lastError = `Upstream returned non-JSON response from ${url}`;
        if (canRetry) continue;
        return failure("upstream-error", lastError);
      }

      let payload: unknown;
      try {
        payload = await parseJsonResponse(response);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (canRetry) continue;
        return failure("upstream-error", lastError);
      }

      if (!response.ok && canRetry && (response.status === 404 || response.status === 405)) {
        lastError = readOpenAiError(payload, `OpenAI-compatible request failed with HTTP ${response.status}`);
        continue;
      }

      return { success: true, response, payload };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (canRetry) continue;
      return failure("network-error", lastError);
    }
  }

  return failure("network-error", lastError);
}

// ─── CompletionsAdapter ──────────────────────────────────────────────────────

/**
 * OpenAI Chat Completions 协议适配器。
 * 支持 /chat/completions 端点的流式和非流式请求，
 * 以及 /models 端点的模型列表获取。
 */
export class CompletionsAdapter implements RuntimeAdapter {
  async listModels(ref: RuntimeProviderRef): Promise<ListModelsResult> {
    const configFailure = requireOpenAiConfig(ref);
    if (configFailure) return configFailure;

    const urls = resolveModelsUrls(ref.baseUrl!);
    const result = await requestOpenAiJson(ref, urls, {
      method: "GET",
      headers: openAiHeaders(ref.apiKey!),
    });
    if (!result.success) return result;
    const { response, payload } = result;
    if (!response.ok) {
      return failure("upstream-error", readOpenAiError(payload, `Model list failed with HTTP ${response.status}`));
    }

    const data = payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
    return {
      success: true,
      models: data.map((model) => normalizeOpenAiModel(model)).filter((model): model is RuntimeModelInput => Boolean(model)),
    };
  }

  async testModel(input: TestModelInput): Promise<TestModelResult> {
    const configFailure = requireOpenAiConfig(input);
    if (configFailure) return configFailure;

    const startedAt = Date.now();
    const result = await this.sendChatCompletion(input, [{ role: "user", content: "ping" }], 1);
    if (!result.success) {
      return result;
    }
    return { success: true, latency: Date.now() - startedAt };
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const configFailure = requireOpenAiConfig(input);
    if (configFailure) return configFailure;

    const useStreaming = Boolean(input.onStreamChunk);
    console.log(`[completions.generate] useStreaming=${useStreaming}, model=${input.modelId}`);

    if (useStreaming) {
      return this.sendStreamingChatCompletion(input, input.messages, input.tools, input.onStreamChunk!, input.signal);
    }

    return this.sendChatCompletion(input, input.messages, undefined, input.tools, input.signal);
  }

  // ─── Non-streaming ───────────────────────────────────────────────────────

  private async sendChatCompletion(
    input: TestModelInput | GenerateInput,
    messages: readonly RuntimeChatMessage[],
    maxTokens?: number,
    tools?: readonly RuntimeToolDefinition[],
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    const hasTools = Boolean(tools?.length);
    const body = {
      model: input.modelId,
      messages: toOpenAiMessages(messages),
      stream: false,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(hasTools ? { tools: toOpenAiTools(tools!), tool_choice: "auto" } : {}),
    };

    const urls = resolveCompletionsUrls(input.baseUrl!);
    const result = await requestOpenAiJson(input, urls, {
      method: "POST",
      headers: openAiHeaders(input.apiKey!),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!result.success) return result;
    const { response, payload } = result;
    if (!response.ok) {
      return failure("upstream-error", readOpenAiError(payload, `Chat completion failed with HTTP ${response.status}`));
    }

    const toolUses = readOpenAiToolUses(payload, tools);
    const usage = readOpenAiUsage(payload);
    if (toolUses.length > 0) {
      return { success: true, type: "tool_use", toolUses, ...(usage ? { usage } : {}) };
    }

    const choices = payload && typeof payload === "object" && Array.isArray((payload as { choices?: unknown }).choices)
      ? (payload as { choices: unknown[] }).choices
      : [];
    const firstChoice = choices[0];
    const content = firstChoice && typeof firstChoice === "object"
      && "message" in firstChoice
      && (firstChoice as { message?: unknown }).message
      && typeof (firstChoice as { message: { content?: unknown } }).message.content === "string"
        ? (firstChoice as { message: { content: string } }).message.content
        : "";
    // DeepSeek reasoning_content
    const reasoningContent = firstChoice && typeof firstChoice === "object"
      && "message" in firstChoice
      && (firstChoice as { message?: unknown }).message
      && typeof (firstChoice as { message: { reasoning_content?: unknown } }).message.reasoning_content === "string"
        ? (firstChoice as { message: { reasoning_content: string } }).message.reasoning_content
        : undefined;
    return { success: true, type: "message", content, ...(reasoningContent ? { reasoningContent } : {}), ...(usage ? { usage } : {}) };
  }

  // ─── Streaming ───────────────────────────────────────────────────────────

  private async sendStreamingChatCompletion(
    input: GenerateInput,
    messages: readonly RuntimeChatMessage[],
    tools: readonly RuntimeToolDefinition[] | undefined,
    onStreamChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    const hasTools = Boolean(tools?.length);
    const body = {
      model: input.modelId,
      messages: toOpenAiMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(hasTools ? { tools: toOpenAiTools(tools!), tool_choice: "auto" } : {}),
    };

    const urls = resolveCompletionsUrls(input.baseUrl!);
    let lastError = "OpenAI-compatible streaming request failed";

    for (const [index, url] of urls.entries()) {
      const canRetry = index < urls.length - 1;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: openAiHeaders(input.apiKey!),
          body: JSON.stringify(body),
          signal,
        });

        if (!response.ok) {
          let errorMessage = `Chat completion failed with HTTP ${response.status}`;
          try {
            const errorPayload = await parseJsonResponse(response);
            errorMessage = readOpenAiError(errorPayload, errorMessage);
          } catch { /* use default error message */ }
          if (canRetry && (response.status === 404 || response.status === 405)) {
            lastError = errorMessage;
            continue;
          }
          return failure("upstream-error", errorMessage);
        }

        if (!response.body) {
          return failure("upstream-error", "Streaming response has no body");
        }

        console.log(`[streaming] Connected to ${url}, status=${response.status}, content-type=${response.headers.get("content-type")}`);
        return await this.consumeStream(response.body, onStreamChunk, signal, tools ?? undefined);
      } catch (error) {
        if (signal?.aborted) {
          return failure("network-error", "Request aborted");
        }
        lastError = error instanceof Error ? error.message : String(error);
        if (canRetry) continue;
        return failure("network-error", lastError);
      }
    }

    return failure("network-error", lastError);
  }

  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    onStreamChunk: (chunk: string) => void,
    signal?: AbortSignal,
    tools?: readonly RuntimeToolDefinition[],
  ): Promise<GenerateResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let reasoningContent = "";
    let usage: GenerateUsage | undefined;

    // Tool calls accumulation (OpenAI streams tool_calls as deltas)
    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();

    try {
      for (;;) {
        if (signal?.aborted) {
          reader.cancel().catch(() => {});
          if (toolCallAccumulators.size > 0) {
            const toolUses = finalizeOpenAiStreamToolCalls(toolCallAccumulators, tools);
            if (toolUses.length > 0) return { success: true, type: "tool_use", toolUses, ...(reasoningContent ? { reasoningContent } : {}), ...(usage ? { usage } : {}) };
          }
          return {
            success: true,
            type: "message",
            content: fullContent,
            ...(reasoningContent ? { reasoningContent } : {}),
            ...(usage ? { usage } : {}),
          };
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;

            // Extract usage from the final chunk
            if (parsed.usage && typeof parsed.usage === "object") {
              const u = parsed.usage as Record<string, unknown>;
              const promptTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
              const completionTokens = typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
              if (promptTokens > 0 || completionTokens > 0) {
                usage = { input_tokens: promptTokens, output_tokens: completionTokens };
              }
            }

            const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
            const choice = choices[0] as Record<string, unknown> | undefined;
            if (!choice) continue;

            const delta = typeof choice.delta === "object" && choice.delta ? choice.delta as Record<string, unknown> : undefined;
            if (!delta) continue;

            // Reasoning content delta (DeepSeek thinking mode)
            if ("reasoning_content" in delta) {
              const rc = delta.reasoning_content;
              if (typeof rc === "string" && rc.length > 0) {
                reasoningContent += rc;
              }
            }

            // Text content delta
            if ("content" in delta) {
              const content = delta.content;
              if (typeof content === "string" && content.length > 0) {
                fullContent += content;
                onStreamChunk(content);
              }
            }

            // Tool calls delta
            if ("tool_calls" in delta && Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
                const idx = typeof tc.index === "number" ? tc.index : 0;
                if (!toolCallAccumulators.has(idx)) {
                  toolCallAccumulators.set(idx, { id: "", name: "", arguments: "" });
                }
                const acc = toolCallAccumulators.get(idx)!;
                if (typeof tc.id === "string") acc.id = tc.id;
                const fn = tc.function as Record<string, unknown> | undefined;
                if (fn) {
                  if (typeof fn.name === "string" && fn.name) acc.name = fn.name;
                  if (typeof fn.arguments === "string") acc.arguments += fn.arguments;
                }
              }
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // If tool calls were accumulated, return as tool_use
    if (toolCallAccumulators.size > 0) {
      const toolUses = finalizeOpenAiStreamToolCalls(toolCallAccumulators, tools);
      if (toolUses.length > 0) {
        return { success: true, type: "tool_use", toolUses, ...(reasoningContent ? { reasoningContent } : {}), ...(usage ? { usage } : {}) };
      }
    }

    return {
      success: true,
      type: "message",
      content: fullContent,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(usage ? { usage } : {}),
    };
  }
}
