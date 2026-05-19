/**
 * AnthropicAdapter — Anthropic Messages 协议适配器。
 *
 * 从 AnthropicCompatibleAdapter 中提取的 /messages 逻辑，
 * 供 anthropic-compatible 和 claude-code 复用。
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
  RuntimeAdapterFailureCode,
  RuntimeToolDefinition,
  RuntimeToolUse,
  GenerateUsage,
  RuntimeChatMessage,
  RuntimeToolStreamEvent,
} from "./index.js";
import { failure, toProviderSafeToolName, toInternalToolName } from "./completions.js";
import { detectModelProvider, encodeDeepSeekToolName, decodeDeepSeekToolName, needsDeepSeekToolNameEncoding, resolveModelId, type ModelTransformContext } from "./model-transforms.js";
import { resolveMessagesUrls, resolveModelsUrls, trimTrailingSlash } from "./url-resolver.js";

// ─── Exported Helpers (for ClaudeCodeAdapter reuse) ──────────────────────────

const ANTHROPIC_VERSION = "2023-06-01";

export function buildAnthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };
}

export function toAnthropicMessages(messages: readonly RuntimeChatMessage[], ctx?: ModelTransformContext): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  const encodeName = (name: string) => {
    if (ctx && detectModelProvider(ctx.modelId, ctx.providerId, ctx.baseUrl) === "deepseek") {
      return needsDeepSeekToolNameEncoding(name) ? encodeDeepSeekToolName(name) : name;
    }
    return toProviderSafeToolName(name);
  };

  for (const message of messages) {
    if (message.role === "system") continue; // system is handled separately

    if (message.role === "tool") {
      result.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
        }],
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const content: Array<Record<string, unknown>> = [];
      // Pass back thinking block if present (Claude extended thinking + tools)
      if (message.reasoning_content) {
        content.push({ type: "thinking", thinking: message.reasoning_content, signature: message.reasoning_signature ?? "" });
      }
      if (message.content.trim()) {
        content.push({ type: "text", text: message.content });
      }
      for (const toolCall of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: encodeName(toolCall.name),
          input: toolCall.input,
        });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    // Plain assistant message — may have thinking content
    if (message.role === "assistant" && message.reasoning_content) {
      const content: Array<Record<string, unknown>> = [
        { type: "thinking", thinking: message.reasoning_content, signature: message.reasoning_signature ?? "" },
        ...(message.content.trim() ? [{ type: "text", text: message.content }] : []),
      ];
      result.push({ role: "assistant", content });
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  return result;
}

export function toAnthropicTools(tools: readonly RuntimeToolDefinition[], ctx?: ModelTransformContext): Array<Record<string, unknown>> {
  const encodeName = (name: string) => {
    if (ctx && detectModelProvider(ctx.modelId, ctx.providerId, ctx.baseUrl) === "deepseek") {
      return needsDeepSeekToolNameEncoding(name) ? encodeDeepSeekToolName(name) : name;
    }
    return toProviderSafeToolName(name);
  };
  return tools.map((tool) => ({
    name: encodeName(tool.name),
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAnthropicUsage(payload: Record<string, unknown>): GenerateUsage | undefined {
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

function parseAnthropicResponse(payload: Record<string, unknown>, tools?: readonly RuntimeToolDefinition[]): GenerateResult {
  const usage = readAnthropicUsage(payload);
  const content = Array.isArray(payload.content) ? payload.content as Array<Record<string, unknown>> : [];

  const toolUses: RuntimeToolUse[] = [];
  let textContent = "";
  let thinkingContent = "";
  let thinkingSignature = "";

  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      textContent += block.text;
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      thinkingContent += block.thinking;
      if (typeof block.signature === "string" && block.signature) thinkingSignature = block.signature;
    } else if (block.type === "tool_use") {
      const providerName = typeof block.name === "string" ? block.name : "";
      const internalName = tools ? toInternalToolName(providerName, tools) : providerName;
      toolUses.push({
        id: typeof block.id === "string" ? block.id : `tool-call-${toolUses.length + 1}`,
        name: internalName,
        input: isRecord(block.input) ? block.input as Record<string, unknown> : {},
      });
    }
  }

  if (toolUses.length > 0) {
    return { success: true, type: "tool_use", toolUses, ...(thinkingContent ? { reasoningContent: thinkingContent, reasoningSignature: thinkingSignature || undefined } : {}), ...(usage ? { usage } : {}) };
  }

  return { success: true, type: "message", content: textContent, ...(thinkingContent ? { reasoningContent: thinkingContent, reasoningSignature: thinkingSignature || undefined } : {}), ...(usage ? { usage } : {}) };
}

async function consumeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onStreamChunk: (chunk: string) => void,
  signal?: AbortSignal,
  onToolEvent?: (event: RuntimeToolStreamEvent) => void,
): Promise<GenerateResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let thinkingContent = "";
  let thinkingSignature = "";
  let usage: GenerateUsage | undefined;

  // Tool use accumulation
  const toolUses: RuntimeToolUse[] = [];
  let currentToolId = "";
  let currentToolName = "";
  let currentToolInputJson = "";

  // Throttle tool input chunk emissions: max once per 200ms or 100 chars since last emit
  let lastToolInputEmitTime = 0;
  let lastToolInputEmitLength = 0;

  try {
    for (;;) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {});
        if (toolUses.length > 0) {
          return { success: true, type: "tool_use", toolUses, ...(thinkingContent ? { reasoningContent: thinkingContent, reasoningSignature: thinkingSignature || undefined } : {}), ...(usage ? { usage } : {}) };
        }
        return { success: true, type: "message", content: fullContent, ...(thinkingContent ? { reasoningContent: thinkingContent, reasoningSignature: thinkingSignature || undefined } : {}), ...(usage ? { usage } : {}) };
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
              // Start accumulating a new tool use
              currentToolId = typeof contentBlock.id === "string" ? contentBlock.id : `tool-call-${toolUses.length + 1}`;
              currentToolName = typeof contentBlock.name === "string" ? contentBlock.name : "";
              currentToolInputJson = "";
              lastToolInputEmitTime = Date.now();
              lastToolInputEmitLength = 0;
              onToolEvent?.({ type: "tool_started", id: currentToolId, name: currentToolName });
            } else if (contentBlock && contentBlock.type === "thinking") {
              // DeepSeek/Claude may include signature in content_block_start
              if (typeof contentBlock.signature === "string" && contentBlock.signature) {
                thinkingSignature = contentBlock.signature;
              }
            }
          } else if (parsed.type === "content_block_delta") {
            const delta = parsed.delta as Record<string, unknown> | undefined;
            if (delta && delta.type === "text_delta" && typeof delta.text === "string") {
              fullContent += delta.text;
              onStreamChunk(delta.text);
            } else if (delta && delta.type === "thinking_delta" && typeof delta.thinking === "string") {
              thinkingContent += delta.thinking;
            } else if (delta && delta.type === "signature_delta" && typeof delta.signature === "string") {
              thinkingSignature += delta.signature;
            } else if (delta && delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
              // Accumulate tool input JSON
              currentToolInputJson += delta.partial_json;
              // Throttled emission of tool input chunks
              if (onToolEvent) {
                const now = Date.now();
                const charsSinceLastEmit = currentToolInputJson.length - lastToolInputEmitLength;
                if (now - lastToolInputEmitTime >= 200 || charsSinceLastEmit >= 100) {
                  onToolEvent({ type: "tool_input_chunk", id: currentToolId, partialInput: currentToolInputJson });
                  lastToolInputEmitTime = now;
                  lastToolInputEmitLength = currentToolInputJson.length;
                }
              }
            }
          } else if (parsed.type === "content_block_stop") {
            // If we were accumulating a tool use, finalize it
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
    return { success: true, type: "tool_use", toolUses, ...(thinkingContent ? { reasoningContent: thinkingContent, reasoningSignature: thinkingSignature || undefined } : {}), ...(usage ? { usage } : {}) };
  }
  return { success: true, type: "message", content: fullContent, ...(thinkingContent ? { reasoningContent: thinkingContent, reasoningSignature: thinkingSignature || undefined } : {}), ...(usage ? { usage } : {}) };
}

async function readAnthropicError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as Record<string, unknown>;
    if (payload.error && typeof payload.error === "object") {
      const err = payload.error as Record<string, unknown>;
      if (typeof err.message === "string") return err.message;
    }
  } catch { /* ignore */ }
  return `Anthropic API request failed with HTTP ${response.status}`;
}

// ─── AnthropicAdapter ────────────────────────────────────────────────────────

/**
 * Anthropic Messages 协议适配器。
 * 支持 /v1/messages 端点的流式和非流式请求，
 * 以及 /v1/models 端点的模型列表获取。
 */
export class AnthropicAdapter implements RuntimeAdapter {
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
        // Try Anthropic headers (x-api-key)
        const response = await fetch(url, {
          method: "GET",
          headers: buildAnthropicHeaders(ref.apiKey!),
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
        // Try next URL
        continue;
      }
    }

    // All URLs failed
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
          headers: buildAnthropicHeaders(input.apiKey!),
          body: JSON.stringify({
            model: input.modelId,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        });

        if (!response.ok) {
          const errorText = await readAnthropicError(response);
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
    if (!input.apiKey?.trim()) {
      return failure("auth-missing", `API key missing for provider ${input.providerId}`);
    }
    if (!input.baseUrl?.trim()) {
      return failure("config-missing", `Base URL missing for provider ${input.providerId}`);
    }

    const useStreaming = Boolean(input.onStreamChunk);
    const urls = resolveMessagesUrls(input.baseUrl!);
    const ctx: ModelTransformContext = { modelId: input.modelId, providerId: input.providerId, baseUrl: input.baseUrl };
    const effectiveModelId = resolveModelId(ctx);

    const body: Record<string, unknown> = {
      model: effectiveModelId,
      messages: toAnthropicMessages(input.messages, ctx),
      max_tokens: 8192,
      ...(useStreaming ? { stream: true } : {}),
      ...(input.tools?.length ? { tools: toAnthropicTools(input.tools, ctx) } : {}),
    };

    // Debug: log reasoning presence in messages sent to API
    const anthropicMsgs = body.messages as Array<Record<string, unknown>>;
    const thinkingCount = anthropicMsgs.filter(m => Array.isArray(m.content) && (m.content as Array<Record<string, unknown>>).some(b => b.type === "thinking")).length;
    if (thinkingCount > 0) {
      console.log(`[anthropic.generate] ${anthropicMsgs.length} messages, ${thinkingCount} with thinking blocks`);
    }

    // Extract system message — use content block format with cache_control for prompt caching
    const systemMessage = input.messages.find((m) => m.role === "system");
    if (systemMessage && "content" in systemMessage && systemMessage.content.trim()) {
      body.system = [
        { type: "text", text: systemMessage.content, cache_control: { type: "ephemeral" } },
      ];
    }

    let lastError = "Anthropic messages request failed";

    for (const [index, url] of urls.entries()) {
      const canRetry = index < urls.length - 1;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: buildAnthropicHeaders(input.apiKey!),
          body: JSON.stringify(body),
          ...(input.signal ? { signal: input.signal } : {}),
        });

        if (!response.ok) {
          const errorText = await readAnthropicError(response);
          if (canRetry && (response.status === 404 || response.status === 405)) {
            lastError = errorText;
            continue;
          }
          const code: RuntimeAdapterFailureCode = response.status >= 500 ? "upstream-error" : "upstream-error";
          return failure(code, errorText);
        }

        if (useStreaming && response.body) {
          return await consumeAnthropicStream(response.body, input.onStreamChunk!, input.signal, input.onToolEvent);
        }

        const payload = await response.json() as Record<string, unknown>;
        return parseAnthropicResponse(payload, input.tools);
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
}
