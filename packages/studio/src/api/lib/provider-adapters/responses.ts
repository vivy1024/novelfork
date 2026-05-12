/**
 * ResponsesAdapter — OpenAI Responses API 协议适配器。
 *
 * 从 OpenAiCompatibleAdapter 中提取的 /v1/responses 逻辑，
 * 处理 Responses API 格式的请求和流式响应。
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
  RuntimeToolDefinition,
  RuntimeToolUse,
  GenerateUsage,
  RuntimeChatMessage,
} from "./index.js";
import {
  failure,
  openAiHeaders,
  toProviderSafeToolName,
  toInternalToolName,
  normalizeOpenAiModel,
  readOpenAiError,
  readOpenAiUsage,
  safeJsonParse,
  parseJsonResponse,
} from "./completions.js";
import { resolveResponsesUrls, resolveModelsUrls, resolveCompletionsUrls } from "./url-resolver.js";

// ─── Internal Helpers ────────────────────────────────────────────────────────

function requireConfig(ref: RuntimeProviderRef) {
  if (!ref.apiKey?.trim()) {
    return failure("auth-missing", `API key missing for provider ${ref.providerId}`);
  }
  if (!ref.baseUrl?.trim()) {
    return failure("config-missing", `Base URL missing for provider ${ref.providerId}`);
  }
  return null;
}

/**
 * Make a JSON request trying multiple URL candidates in order.
 */
async function requestJson(ref: RuntimeProviderRef, urls: string[], init: RequestInit): Promise<
  | { readonly success: true; readonly response: Response; readonly payload: unknown }
  | { readonly success: false; readonly code: string; readonly error: string }
> {
  let lastError = "Responses API request failed";

  for (const [index, url] of urls.entries()) {
    const canRetry = index < urls.length - 1;
    try {
      const response = await fetch(url, init);
      const contentType = response.headers.get("content-type") ?? "";

      // For streaming responses, return immediately without parsing JSON
      if (contentType.includes("text/event-stream") || (response.ok && response.body && init.body && String(init.body).includes('"stream":true'))) {
        return { success: true, response, payload: null };
      }

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
        lastError = readOpenAiError(payload, `Request failed with HTTP ${response.status}`);
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

/**
 * Convert RuntimeChatMessage[] to Responses API input items.
 * System messages are extracted to the `instructions` field (not in input array).
 */
function toResponsesInput(messages: readonly RuntimeChatMessage[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      // system goes as instructions, skip from input
      continue;
    }
    if (msg.role === "tool") {
      items.push({ type: "function_call_output", call_id: msg.toolCallId, output: msg.content });
      continue;
    }
    if (msg.role === "assistant" && msg.toolCalls?.length) {
      // Text + function calls
      if (msg.content.trim()) {
        items.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: msg.content }] });
      }
      for (const tc of msg.toolCalls) {
        items.push({ type: "function_call", name: toProviderSafeToolName(tc.name), arguments: JSON.stringify(tc.input), call_id: tc.id });
      }
      continue;
    }
    // user or assistant text
    items.push({
      type: "message",
      role: msg.role,
      content: [{ type: msg.role === "user" ? "input_text" : "output_text", text: msg.content }],
    });
  }
  return items;
}

/**
 * Convert tool definitions to Responses API tools format.
 */
function toResponsesTools(tools: readonly RuntimeToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    name: toProviderSafeToolName(t.name),
    description: t.description,
    parameters: t.inputSchema,
  }));
}

/**
 * Parse a non-streaming Responses API payload into GenerateResult.
 */
function parseResponsesPayload(payload: Record<string, unknown>, tools?: readonly RuntimeToolDefinition[]): GenerateResult {
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
  const toolUses: RuntimeToolUse[] = [];
  let textContent = "";
  let reasoningContent = "";

  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content as Array<Record<string, unknown>>) {
        if (block.type === "output_text" && typeof block.text === "string") textContent += block.text;
      }
    } else if (item.type === "reasoning" && Array.isArray(item.content)) {
      for (const block of item.content as Array<Record<string, unknown>>) {
        if (typeof block.text === "string") reasoningContent += block.text;
      }
    } else if (item.type === "function_call") {
      const providerName = typeof item.name === "string" ? item.name : "";
      const internalName = tools ? toInternalToolName(providerName, tools) : providerName;
      toolUses.push({
        id: typeof item.call_id === "string" ? item.call_id : `call-${toolUses.length + 1}`,
        name: internalName,
        input: typeof item.arguments === "string" ? safeJsonParse(item.arguments) : {},
      });
    }
  }

  const usage = readOpenAiUsage(payload);
  if (toolUses.length > 0) {
    return { success: true, type: "tool_use", toolUses, ...(reasoningContent ? { reasoningContent } : {}), ...(usage ? { usage } : {}) };
  }
  return { success: true, type: "message", content: textContent, ...(reasoningContent ? { reasoningContent } : {}), ...(usage ? { usage } : {}) };
}

/**
 * Consume a Responses API SSE stream.
 *
 * SSE events:
 * - response.output_text.delta → text content
 * - response.reasoning_text.delta → reasoning
 * - response.reasoning_summary_text.delta → reasoning
 * - response.output_item.done → function_call items
 * - response.completed → usage from response object
 */
async function consumeResponsesStream(
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
  const toolUses: RuntimeToolUse[] = [];

  try {
    for (;;) {
      if (signal?.aborted) { reader.cancel().catch(() => {}); break; }
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
          const eventType = typeof parsed.type === "string" ? parsed.type : "";

          if (eventType === "response.output_text.delta") {
            const delta = typeof parsed.delta === "string" ? parsed.delta : "";
            if (delta) { fullContent += delta; onStreamChunk(delta); }
          } else if (eventType === "response.reasoning_text.delta" || eventType === "response.reasoning_summary_text.delta") {
            const delta = typeof parsed.delta === "string" ? parsed.delta : "";
            if (delta) reasoningContent += delta;
          } else if (eventType === "response.output_item.done") {
            const item = parsed.item as Record<string, unknown> | undefined;
            if (item?.type === "function_call") {
              const providerName = typeof item.name === "string" ? item.name : "";
              const internalName = tools ? toInternalToolName(providerName, tools) : providerName;
              toolUses.push({
                id: typeof item.call_id === "string" ? item.call_id : `call-${toolUses.length + 1}`,
                name: internalName,
                input: typeof item.arguments === "string" ? safeJsonParse(item.arguments) : {},
              });
            }
          } else if (eventType === "response.completed") {
            const resp = parsed.response as Record<string, unknown> | undefined;
            if (resp) usage = readOpenAiUsage(resp);
          }
        } catch { /* skip malformed SSE */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (toolUses.length > 0) {
    return { success: true, type: "tool_use", toolUses, ...(reasoningContent ? { reasoningContent } : {}), ...(usage ? { usage } : {}) };
  }
  return { success: true, type: "message", content: fullContent, ...(reasoningContent ? { reasoningContent } : {}), ...(usage ? { usage } : {}) };
}

// ─── ResponsesAdapter ────────────────────────────────────────────────────────

/**
 * OpenAI Responses API 协议适配器。
 * 支持 /v1/responses 端点的流式和非流式请求。
 * 模型列表使用 /v1/models（与 completions 相同）。
 * 模型测试使用 /v1/chat/completions（更简单可靠）。
 */
export class ResponsesAdapter implements RuntimeAdapter {
  async listModels(ref: RuntimeProviderRef): Promise<ListModelsResult> {
    const configFailure = requireConfig(ref);
    if (configFailure) return configFailure;

    const urls = resolveModelsUrls(ref.baseUrl!);
    const result = await requestJson(ref, urls, {
      method: "GET",
      headers: openAiHeaders(ref.apiKey!),
    });
    if (!result.success) return result as ListModelsResult;
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
    const configFailure = requireConfig(input);
    if (configFailure) return configFailure;

    const startedAt = Date.now();

    // Use /chat/completions for testing — simpler and more reliable than /responses
    const urls = resolveCompletionsUrls(input.baseUrl!);
    const body = {
      model: input.modelId,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    };

    const result = await requestJson(input, urls, {
      method: "POST",
      headers: openAiHeaders(input.apiKey!),
      body: JSON.stringify(body),
    });
    if (!result.success) return result as TestModelResult;
    if (!result.response.ok) {
      return failure("upstream-error", readOpenAiError(result.payload, `Test failed: HTTP ${result.response.status}`));
    }
    return { success: true, latency: Date.now() - startedAt };
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const configFailure = requireConfig(input);
    if (configFailure) return configFailure;

    const hasTools = Boolean(input.tools?.length);
    const useStreaming = Boolean(input.onStreamChunk);

    // Extract system message as instructions
    const systemMessage = input.messages.find((m) => m.role === "system");
    const instructions = systemMessage && "content" in systemMessage ? systemMessage.content : "";

    const body: Record<string, unknown> = {
      model: input.modelId,
      input: toResponsesInput(input.messages),
      stream: useStreaming,
      ...(instructions ? { instructions } : {}),
      ...(hasTools ? { tools: toResponsesTools(input.tools!) } : {}),
    };

    const urls = resolveResponsesUrls(input.baseUrl!);
    let lastError = "Responses API request failed";

    for (const [index, url] of urls.entries()) {
      const canRetry = index < urls.length - 1;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: openAiHeaders(input.apiKey!),
          body: JSON.stringify(body),
          ...(input.signal ? { signal: input.signal } : {}),
        });

        if (!response.ok) {
          let errorMessage = `Responses request failed with HTTP ${response.status}`;
          try {
            const errorPayload = await parseJsonResponse(response);
            errorMessage = readOpenAiError(errorPayload, errorMessage);
          } catch { /* use default */ }
          if (canRetry && (response.status === 404 || response.status === 405)) {
            lastError = errorMessage;
            continue;
          }
          return failure("upstream-error", errorMessage);
        }

        // Streaming mode: consume SSE events
        if (useStreaming && response.body && input.onStreamChunk) {
          return await consumeResponsesStream(response.body, input.onStreamChunk, input.signal, input.tools);
        }

        // Non-streaming: parse JSON response
        const payload = await parseJsonResponse(response) as Record<string, unknown>;
        return parseResponsesPayload(payload, input.tools);
      } catch (error) {
        if (input.signal?.aborted) return failure("network-error", "Request aborted");
        lastError = error instanceof Error ? error.message : String(error);
        if (canRetry) continue;
        return failure("network-error", lastError);
      }
    }

    return failure("network-error", lastError);
  }
}
