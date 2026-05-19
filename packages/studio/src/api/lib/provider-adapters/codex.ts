/**
 * CodexAdapter — Codex 协议适配器。
 *
 * 本质上是 OpenAI Chat Completions 协议，额外支持：
 * - reasoning_effort 参数（low/medium/high）
 * - service_tier 参数（可选，"priority" 用于 Fast Mode）
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
  toOpenAiMessages,
  toOpenAiTools,
  normalizeOpenAiModel,
  readOpenAiError,
  readOpenAiToolUses,
  readOpenAiUsage,
  parseJsonResponse,
  finalizeOpenAiStreamToolCalls,
} from "./completions.js";
import { resolveCompletionsUrls, resolveModelsUrls } from "./url-resolver.js";

// ─── Internal Helpers ────────────────────────────────────────────────────────

function requireCodexConfig(ref: RuntimeProviderRef) {
  if (!ref.apiKey?.trim()) {
    return failure("auth-missing", `API key missing for provider ${ref.providerId}`);
  }
  if (!ref.baseUrl?.trim()) {
    return failure("config-missing", `Base URL missing for provider ${ref.providerId}`);
  }
  return null;
}

async function requestCodexJson(ref: RuntimeProviderRef, urls: string[], init: RequestInit): Promise<
  | { readonly success: true; readonly response: Response; readonly payload: unknown }
  | ReturnType<typeof failure>
> {
  let lastError = "Codex request failed";

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
        lastError = readOpenAiError(payload, `Codex request failed with HTTP ${response.status}`);
        continue;
      }

      return { success: true as const, response, payload };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (canRetry) continue;
      return failure("network-error", lastError);
    }
  }

  return failure("network-error", lastError);
}

// ─── CodexAdapter ────────────────────────────────────────────────────────────

/**
 * Codex 协议适配器。
 *
 * 兼容 OpenAI Chat Completions 格式，额外在请求体中注入：
 * - reasoning_effort: "low" | "medium" | "high"（默认 "medium"）
 * - service_tier: "priority" | undefined（可选，用于 Fast Mode）
 */
export class CodexAdapter implements RuntimeAdapter {
  async listModels(ref: RuntimeProviderRef): Promise<ListModelsResult> {
    const configFailure = requireCodexConfig(ref);
    if (configFailure) return configFailure;

    const urls = resolveModelsUrls(ref.baseUrl!);
    const result = await requestCodexJson(ref, urls, {
      method: "GET",
      headers: openAiHeaders(ref.apiKey!),
    });
    if (!result.success) return result;
    const { response, payload } = result;
    if (!response.ok) {
      return failure("upstream-error", readOpenAiError(payload, `Codex model list failed with HTTP ${response.status}`));
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
    const configFailure = requireCodexConfig(input);
    if (configFailure) return configFailure;

    const startedAt = Date.now();
    const body = {
      model: input.modelId,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
      reasoning_effort: "medium",
    };

    const urls = resolveCompletionsUrls(input.baseUrl!);
    const result = await requestCodexJson(input, urls, {
      method: "POST",
      headers: openAiHeaders(input.apiKey!),
      body: JSON.stringify(body),
    });
    if (!result.success) return result;
    if (!result.response.ok) {
      return failure("upstream-error", readOpenAiError(result.payload, `Codex test failed with HTTP ${result.response.status}`));
    }
    return { success: true, latency: Date.now() - startedAt };
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const configFailure = requireCodexConfig(input);
    if (configFailure) return configFailure;

    const useStreaming = Boolean(input.onStreamChunk);
    console.log(`[codex.generate] useStreaming=${useStreaming}, model=${input.modelId}`);

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
    const reasoningEffort = ("reasoningEffort" in input && input.reasoningEffort) ? input.reasoningEffort : "medium";
    const serviceTier = ("serviceTier" in input && input.serviceTier) ? input.serviceTier : undefined;
    const body: Record<string, unknown> = {
      model: input.modelId,
      messages: toOpenAiMessages(messages),
      stream: false,
      reasoning_effort: reasoningEffort,
      ...(serviceTier ? { service_tier: serviceTier } : {}),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(hasTools ? { tools: toOpenAiTools(tools!), tool_choice: "auto" } : {}),
    };

    const urls = resolveCompletionsUrls(input.baseUrl!);
    const result = await requestCodexJson(input, urls, {
      method: "POST",
      headers: openAiHeaders(input.apiKey!),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!result.success) return result;
    const { response, payload } = result;
    if (!response.ok) {
      return failure("upstream-error", readOpenAiError(payload, `Codex completion failed with HTTP ${response.status}`));
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
    const reasoningEffort = input.reasoningEffort ?? "medium";
    const serviceTier = input.serviceTier;
    const body: Record<string, unknown> = {
      model: input.modelId,
      messages: toOpenAiMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: reasoningEffort,
      ...(serviceTier ? { service_tier: serviceTier } : {}),
      ...(hasTools ? { tools: toOpenAiTools(tools!), tool_choice: "auto" } : {}),
    };

    const urls = resolveCompletionsUrls(input.baseUrl!);
    let lastError = "Codex streaming request failed";

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
          let errorMessage = `Codex completion failed with HTTP ${response.status}`;
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

        console.log(`[codex.streaming] Connected to ${url}, status=${response.status}`);
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

            // Reasoning content delta
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
