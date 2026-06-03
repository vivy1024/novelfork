/**
 * ClaudeCodeAdapter — Claude Code 协议适配器。
 *
 * 扩展 Anthropic Messages 协议，添加 prompt caching beta header
 * 和 extended thinking 支持。
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
  AnthropicAdapter,
  buildAnthropicHeaders,
  toAnthropicMessages,
  toAnthropicTools,
} from "./anthropic.js";
import { failure } from "./completions.js";
import { resolveMessagesUrls, resolveModelsUrls, trimTrailingSlash } from "./url-resolver.js";

// ─── Header Builder ──────────────────────────────────────────────────────────

const PROMPT_CACHING_BETA = "prompt-caching-2024-07-31";

function buildClaudeCodeHeaders(apiKey: string): Record<string, string> {
  return {
    ...buildAnthropicHeaders(apiKey),
    "anthropic-beta": PROMPT_CACHING_BETA,
  };
}

// ─── ClaudeCodeAdapter ───────────────────────────────────────────────────────

/**
 * Claude Code 协议适配器。
 *
 * 与 AnthropicAdapter 逻辑一致，但在所有请求中附加
 * `anthropic-beta: prompt-caching-2024-07-31` header 以启用 prompt caching。
 * 同时显式支持 extended thinking（thinking blocks 在流式和非流式响应中均被解析）。
 */
export class ClaudeCodeAdapter implements RuntimeAdapter {
  async listModels(ref: RuntimeProviderRef): Promise<ListModelsResult> {
    if (!ref.apiKey?.trim()) {
      return failure("auth-missing", `API key missing for provider ${ref.providerId}`);
    }
    if (!ref.baseUrl?.trim()) {
      return failure("config-missing", `Base URL missing for provider ${ref.providerId}`);
    }

    const modelsUrls = resolveModelsUrls(ref.baseUrl!);

    for (const url of modelsUrls) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: buildClaudeCodeHeaders(ref.apiKey!),
        });

        if (response.ok) {
          const payload = await response.json() as { data?: Array<{ id: string; display_name?: string; created_at?: string }> };
          if (Array.isArray(payload.data) && payload.data.length > 0) {
            return {
              success: true,
              models: payload.data.map((m) => ({
                id: m.id,
                name: m.display_name ?? m.id,
                contextWindow: 0,
                maxOutputTokens: 0,
                enabled: true,
                source: "detected" as const,
                lastTestStatus: "untested" as const,
              })),
            };
          }
        }

        // Anthropic format failed, try OpenAI format (Bearer token)
        const openaiResponse = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${ref.apiKey}`, "Content-Type": "application/json" },
        });
        if (openaiResponse.ok) {
          const payload = await openaiResponse.json() as { data?: Array<{ id: string; owned_by?: string }> };
          if (Array.isArray(payload.data) && payload.data.length > 0) {
            return {
              success: true,
              models: payload.data.map((m) => ({
                id: m.id,
                name: m.id,
                contextWindow: 0,
                maxOutputTokens: 0,
                enabled: true,
                source: "detected" as const,
                lastTestStatus: "untested" as const,
              })),
            };
          }
        }
      } catch {
        continue;
      }
    }

    return failure("upstream-error", `获取模型列表失败：所有端点均无响应`);
  }

  async testModel(input: TestModelInput): Promise<TestModelResult> {
    if (!input.apiKey?.trim()) {
      return failure("auth-missing", `API key missing for provider ${input.providerId}`);
    }
    if (!input.baseUrl?.trim()) {
      return failure("config-missing", `Base URL missing for provider ${input.providerId}`);
    }

    const startedAt = Date.now();
    const urls = resolveMessagesUrls(input.baseUrl!);

    for (const [index, url] of urls.entries()) {
      const canRetry = index < urls.length - 1;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: buildClaudeCodeHeaders(input.apiKey!),
          body: JSON.stringify({
            model: input.modelId,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        });

        if (!response.ok) {
          let errorText: string;
          try {
            const payload = await response.json() as Record<string, unknown>;
            const err = payload.error as Record<string, unknown> | undefined;
            errorText = typeof err?.message === "string" ? err.message : `Claude Code API request failed with HTTP ${response.status}`;
          } catch {
            errorText = `Claude Code API request failed with HTTP ${response.status}`;
          }
          if (canRetry && (response.status === 404 || response.status === 405)) {
            continue;
          }
          return failure("upstream-error", errorText);
        }

        return { success: true, latency: Date.now() - startedAt };
      } catch (error) {
        if (canRetry) continue;
        return failure("network-error", error instanceof Error ? error.message : String(error));
      }
    }

    return failure("network-error", "All message endpoints failed");
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    console.log(`[claude-code.generate] hasOnStreamChunk=${typeof input.onStreamChunk}, model=${input.modelId}, baseUrl=${input.baseUrl}`);
    if (!input.apiKey?.trim()) {
      return failure("auth-missing", `API key missing for provider ${input.providerId}`);
    }
    if (!input.baseUrl?.trim()) {
      return failure("config-missing", `Base URL missing for provider ${input.providerId}`);
    }

    const useStreaming = Boolean(input.onStreamChunk);
    const urls = resolveMessagesUrls(input.baseUrl!);

    const body: Record<string, unknown> = {
      model: input.modelId,
      messages: toAnthropicMessages(input.messages),
      max_tokens: 16384,
      ...(useStreaming ? { stream: true } : {}),
      ...(input.tools?.length ? { tools: toAnthropicTools(input.tools) } : {}),
      // Automatic prompt caching (same as anthropic.ts)
      cache_control: { type: "ephemeral" },
    };

    // Extract system message — use content block format with cache_control
    const systemMessage = input.messages.find((m) => m.role === "system");
    if (systemMessage && "content" in systemMessage && systemMessage.content.trim()) {
      body.system = [
        { type: "text", text: systemMessage.content, cache_control: { type: "ephemeral" } },
      ];
    }

    let lastError = "Claude Code messages request failed";

    for (const [index, url] of urls.entries()) {
      const canRetry = index < urls.length - 1;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: buildClaudeCodeHeaders(input.apiKey!),
          body: JSON.stringify(body),
          ...(input.signal ? { signal: input.signal } : {}),
        });

        if (!response.ok) {
          const errorText = await this.readError(response);
          if (canRetry && (response.status === 404 || response.status === 405)) {
            lastError = errorText;
            continue;
          }
          return failure("upstream-error", errorText);
        }

        if (useStreaming && response.body) {
          return await this.consumeStream(response.body, input.onStreamChunk!, input.signal);
        }

        const payload = await response.json() as Record<string, unknown>;
        return this.parseResponse(payload, input.tools);
      } catch (error) {
        if (input.signal?.aborted) {
          return failure("network-error", "Request aborted");
        }
        lastError = error instanceof Error ? error.message : String(error);
        if (canRetry) continue;
        return failure("network-error", lastError);
      }
    }

    return failure("network-error", lastError);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private parseResponse(payload: Record<string, unknown>, tools?: readonly RuntimeToolDefinition[]): GenerateResult {
    const usage = this.readUsage(payload);
    const content = Array.isArray(payload.content) ? payload.content as Array<Record<string, unknown>> : [];

    const toolUses: RuntimeToolUse[] = [];
    let textContent = "";
    let thinkingContent = "";

    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        textContent += block.text;
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        thinkingContent += block.thinking;
      } else if (block.type === "tool_use") {
        const providerName = typeof block.name === "string" ? block.name : "";
        const internalName = tools ? this.toInternalName(providerName, tools) : providerName;
        toolUses.push({
          id: typeof block.id === "string" ? block.id : `tool-call-${toolUses.length + 1}`,
          name: internalName,
          input: this.isRecord(block.input) ? block.input as Record<string, unknown> : {},
        });
      }
    }

    if (toolUses.length > 0) {
      return { success: true, type: "tool_use", toolUses, ...(thinkingContent ? { reasoningContent: thinkingContent } : {}), ...(usage ? { usage } : {}) };
    }

    return { success: true, type: "message", content: textContent, ...(thinkingContent ? { reasoningContent: thinkingContent } : {}), ...(usage ? { usage } : {}) };
  }

  private readUsage(payload: Record<string, unknown>): GenerateUsage | undefined {
    const usage = payload.usage;
    if (!usage || typeof usage !== "object") return undefined;
    const u = usage as Record<string, unknown>;
    const inputTokens = typeof u.input_tokens === "number" ? u.input_tokens : 0;
    const outputTokens = typeof u.output_tokens === "number" ? u.output_tokens : 0;
    if (inputTokens === 0 && outputTokens === 0) return undefined;
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      ...(typeof u.cache_creation_input_tokens === "number" ? { cache_creation_input_tokens: u.cache_creation_input_tokens } : {}),
      ...(typeof u.cache_read_input_tokens === "number" ? { cache_read_input_tokens: u.cache_read_input_tokens } : {}),
    };
  }

  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    onStreamChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let thinkingContent = "";
    let usage: GenerateUsage | undefined;

    const toolUses: RuntimeToolUse[] = [];
    let currentToolId = "";
    let currentToolName = "";
    let currentToolInputJson = "";

    try {
      for (;;) {
        if (signal?.aborted) {
          reader.cancel().catch(() => {});
          if (toolUses.length > 0) {
            return { success: true, type: "tool_use", toolUses, ...(thinkingContent ? { reasoningContent: thinkingContent } : {}), ...(usage ? { usage } : {}) };
          }
          return { success: true, type: "message", content: fullContent, ...(thinkingContent ? { reasoningContent: thinkingContent } : {}), ...(usage ? { usage } : {}) };
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

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;

            if (parsed.type === "content_block_start") {
              const contentBlock = parsed.content_block as Record<string, unknown> | undefined;
              if (contentBlock && contentBlock.type === "tool_use") {
                currentToolId = typeof contentBlock.id === "string" ? contentBlock.id : `tool-call-${toolUses.length + 1}`;
                currentToolName = typeof contentBlock.name === "string" ? contentBlock.name : "";
                currentToolInputJson = "";
              }
            } else if (parsed.type === "content_block_delta") {
              const delta = parsed.delta as Record<string, unknown> | undefined;
              if (delta && delta.type === "text_delta" && typeof delta.text === "string") {
                fullContent += delta.text;
                onStreamChunk(delta.text);
              } else if (delta && delta.type === "thinking_delta" && typeof delta.thinking === "string") {
                thinkingContent += delta.thinking;
              } else if (delta && delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
                currentToolInputJson += delta.partial_json;
              }
            } else if (parsed.type === "content_block_stop") {
              if (currentToolName) {
                let input: Record<string, unknown> = {};
                try {
                  if (currentToolInputJson) {
                    input = JSON.parse(currentToolInputJson) as Record<string, unknown>;
                  }
                } catch { /* malformed tool input */ }
                toolUses.push({ id: currentToolId, name: currentToolName, input });
                currentToolId = "";
                currentToolName = "";
                currentToolInputJson = "";
              }
            } else if (parsed.type === "message_delta") {
              const msgUsage = parsed.usage as Record<string, unknown> | undefined;
              if (msgUsage) {
                const outputTokens = typeof msgUsage.output_tokens === "number" ? msgUsage.output_tokens : 0;
                if (outputTokens > 0) {
                  usage = { input_tokens: usage?.input_tokens ?? 0, output_tokens: outputTokens };
                }
              }
            } else if (parsed.type === "message_start") {
              const message = parsed.message as Record<string, unknown> | undefined;
              if (message?.usage && typeof message.usage === "object") {
                const u = message.usage as Record<string, unknown>;
                const inputTokens = typeof u.input_tokens === "number" ? u.input_tokens : 0;
                usage = { input_tokens: inputTokens, output_tokens: usage?.output_tokens ?? 0 };
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

    if (toolUses.length > 0) {
      return { success: true, type: "tool_use", toolUses, ...(thinkingContent ? { reasoningContent: thinkingContent } : {}), ...(usage ? { usage } : {}) };
    }
    return { success: true, type: "message", content: fullContent, ...(thinkingContent ? { reasoningContent: thinkingContent } : {}), ...(usage ? { usage } : {}) };
  }

  private async readError(response: Response): Promise<string> {
    try {
      const payload = await response.json() as Record<string, unknown>;
      if (payload.error && typeof payload.error === "object") {
        const err = payload.error as Record<string, unknown>;
        if (typeof err.message === "string") return err.message;
      }
    } catch { /* ignore */ }
    return `Claude Code API request failed with HTTP ${response.status}`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private toInternalName(providerName: string, tools: readonly RuntimeToolDefinition[]): string {
    // Find the tool whose provider-safe name matches
    for (const tool of tools) {
      if (tool.name === providerName || tool.name.replace(/[^a-zA-Z0-9_-]/g, "_") === providerName) {
        return tool.name;
      }
    }
    return providerName;
  }
}
