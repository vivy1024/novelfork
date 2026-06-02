/**
 * AnthropicAdapter — Anthropic Messages 协议适配器。
 *
 * 从 AnthropicCompatibleAdapter 中提取的 /messages 逻辑，
 * 供 anthropic-compatible 和 claude-code 复用。
 */

import { readFileSync } from "node:fs";
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
import { detectModelProvider, encodeDeepSeekToolName, decodeDeepSeekToolName, needsDeepSeekToolNameEncoding, resolveModelId, applyProviderBodyTransforms, stripCacheControlFromBody, type ModelTransformContext } from "./model-transforms.js";
import { resolveMessagesUrls, resolveModelsUrls, trimTrailingSlash } from "./url-resolver.js";

// ─── Exported Helpers (for ClaudeCodeAdapter reuse) ──────────────────────────

/**
 * Sanitize Anthropic message array: ensure every assistant message with tool_use
 * has ALL matching tool_results in the immediately following user message.
 * DeepSeek requires tool_results to be in a single user message right after the assistant.
 */
function sanitizeToolUseResults(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  // First pass: merge consecutive user messages that contain tool_results into one
  // This handles the case where parallel tool executions produce separate user messages
  const merged: Array<Record<string, unknown>> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // Check if this is a user message with tool_results that should be merged with the previous
    if (msg.role === "user" && Array.isArray(msg.content)
      && (msg.content as Array<Record<string, unknown>>).every(b => b.type === "tool_result")
      && merged.length > 0) {
      const prev = merged[merged.length - 1];
      // Merge into previous user message if it also has tool_results
      if (prev.role === "user" && Array.isArray(prev.content)
        && (prev.content as Array<Record<string, unknown>>).some(b => b.type === "tool_result")) {
        merged[merged.length - 1] = {
          ...prev,
          content: [...(prev.content as Array<Record<string, unknown>>), ...(msg.content as Array<Record<string, unknown>>)],
        };
        continue;
      }
    }
    merged.push(msg);
  }

  // Second pass: find orphaned tool_use IDs and inject synthetic tool_results
  const allToolUseIds = new Set<string>();
  const allToolResultIds = new Set<string>();
  const toolUseToIdx = new Map<string, number>();

  for (let i = 0; i < merged.length; i++) {
    const msg = merged[i];
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (block.type === "tool_use" && typeof block.id === "string") {
        allToolUseIds.add(block.id);
        toolUseToIdx.set(block.id, i);
      }
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        allToolResultIds.add(block.tool_use_id);
      }
    }
  }

  const orphanedIds = [...allToolUseIds].filter(id => !allToolResultIds.has(id));
  if (orphanedIds.length === 0) return merged;

  // Group orphans by assistant message index
  const orphansByIdx = new Map<number, string[]>();
  for (const id of orphanedIds) {
    const idx = toolUseToIdx.get(id)!;
    if (!orphansByIdx.has(idx)) orphansByIdx.set(idx, []);
    orphansByIdx.get(idx)!.push(id);
  }

  // Insert synthetic tool_results
  const result: Array<Record<string, unknown>> = [];
  for (let i = 0; i < merged.length; i++) {
    result.push(merged[i]);
    const orphans = orphansByIdx.get(i);
    if (orphans && orphans.length > 0) {
      const nextMsg = merged[i + 1];
      if (nextMsg && nextMsg.role === "user" && Array.isArray(nextMsg.content)) {
        // Inject into next user message
        merged[i + 1] = {
          ...nextMsg,
          content: [
            ...(nextMsg.content as Array<Record<string, unknown>>),
            ...orphans.map(id => ({ type: "tool_result", tool_use_id: id, content: "[工具执行被中断]" })),
          ],
        };
      } else {
        // Insert new user message
        result.push({
          role: "user",
          content: orphans.map(id => ({ type: "tool_result", tool_use_id: id, content: "[工具执行被中断]" })),
        });
      }
    }
  }
  return result;
}

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
  const isDeepSeek = ctx ? detectModelProvider(ctx.modelId, ctx.providerId, ctx.baseUrl) === "deepseek" : false;
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
        // DeepSeek doesn't support signature field in thinking blocks
        if (isDeepSeek) {
          content.push({ type: "thinking", thinking: message.reasoning_content });
        } else {
          content.push({ type: "thinking", thinking: message.reasoning_content, signature: message.reasoning_signature ?? "" });
        }
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
      const thinkingBlock: Record<string, unknown> = isDeepSeek
        ? { type: "thinking", thinking: message.reasoning_content }
        : { type: "thinking", thinking: message.reasoning_content, signature: message.reasoning_signature ?? "" };
      const content: Array<Record<string, unknown>> = [
        thinkingBlock,
        ...(message.content.trim() ? [{ type: "text", text: message.content }] : []),
      ];
      result.push({ role: "assistant", content });
      continue;
    }

    // User message with image attachments — use content blocks
    if (message.role === "user" && message.attachments?.length) {
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (message.content.trim()) {
        contentBlocks.push({ type: "text", text: message.content });
      }
      for (const att of message.attachments) {
        try {
          const fileData = readFileSync(att.filePath);
          contentBlocks.push({
            type: "image",
            source: { type: "base64", media_type: att.mimeType, data: fileData.toString("base64") },
          });
        } catch { /* skip unreadable images */ }
      }
      if (contentBlocks.length > 0) {
        result.push({ role: "user", content: contentBlocks });
      }
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  return sanitizeToolUseResults(result);
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

/**
 * Parse XML-formatted tool calls from raw text output.
 * Supports three formats:
 * 1. <tool_use id="..." name="ToolName"> {json} </tool_use>
 * 2. <invoke name="ToolName"> <parameter name="key">value</parameter> </invoke>
 * 3. <invoke name="ToolName"> <parameter name="key">value</parameter> ... </invoke>
 */
function parseXmlToolCalls(text: string): RuntimeToolUse[] | null {
  const results: RuntimeToolUse[] = [];

  // Format 1: <tool_use id="..." name="..."> {json} </tool_use>
  const toolUseRegex = /<tool_use\s+id="([^"]*)"\s+name="([^"]*)">([\s\S]*?)<\/tool_use>/g;
  let match: RegExpExecArray | null;
  while ((match = toolUseRegex.exec(text)) !== null) {
    const [, id, name, body] = match;
    try {
      const input = JSON.parse(body.trim()) as Record<string, unknown>;
      results.push({ id: id || `xml-tool-${results.length + 1}`, name, input });
    } catch {
      // Try to salvage — body might not be valid JSON
    }
  }

  if (results.length > 0) return results;

  // Format 2 & 3: <invoke name="..."> <parameter name="key">value</parameter> </invoke>
  const invokeRegex = /<invoke\s+name="([^"]*)">([\s\S]*?)<\/invoke>/g;
  while ((match = invokeRegex.exec(text)) !== null) {
    const [, name, body] = match;
    const input: Record<string, unknown> = {};

    // Try parsing as JSON first (some models put raw JSON inside invoke)
    const trimmedBody = body.trim();
    if (trimmedBody.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmedBody) as Record<string, unknown>;
        results.push({ id: `xml-tool-${results.length + 1}`, name, input: parsed });
        continue;
      } catch { /* fall through to parameter parsing */ }
    }

    // Parse <parameter name="key">value</parameter> blocks
    const paramRegex = /<parameter\s+name="([^"]*)">([\s\S]*?)<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      const [, paramName, paramValue] = paramMatch;
      // Try to parse value as JSON, otherwise keep as string
      try {
        input[paramName] = JSON.parse(paramValue.trim());
      } catch {
        input[paramName] = paramValue.trim();
      }
    }

    if (Object.keys(input).length > 0) {
      results.push({ id: `xml-tool-${results.length + 1}`, name, input });
    }
  }

  return results.length > 0 ? results : null;
}

async function consumeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onStreamChunk: (chunk: string) => void,
  signal?: AbortSignal,
  onToolEvent?: (event: RuntimeToolStreamEvent) => void,
  tools?: readonly RuntimeToolDefinition[],
): Promise<GenerateResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let thinkingContent = "";
  let thinkingSignature = "";
  let usage: GenerateUsage | undefined;
  let stopReason: string | undefined;

  // Tool use accumulation
  const toolUses: RuntimeToolUse[] = [];
  let currentToolId = "";
  let currentToolName = "";
  // XML tool_use streaming suppression: once detected, stop pushing text to frontend
  let xmlStreamingSuppressed = false;
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
              // Suppress streaming if XML tool_use detected (model regression: outputs XML instead of structured tool_use)
              if (!xmlStreamingSuppressed) {
                if (/<(?:tool_use\s|invoke\s|antml:invoke\s)/.test(delta.text) || /<(?:tool_use\s|invoke\s|antml:invoke\s)/.test(fullContent.slice(-100))) {
                  xmlStreamingSuppressed = true;
                } else {
                  onStreamChunk(delta.text);
                }
              }
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
              toolUses.push({ id: currentToolId, name: tools ? toInternalToolName(currentToolName, tools) : currentToolName, input });
              currentToolId = "";
              currentToolName = "";
              currentToolInputJson = "";
            }
          } else if (parsed.type === "message_delta") {
            const delta = parsed.delta as Record<string, unknown> | undefined;
            if (delta && typeof delta.stop_reason === "string") {
              stopReason = delta.stop_reason;
            }
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

  // If no structured tool_use was found, check for XML tool calls in the text output
  if (toolUses.length === 0 && fullContent) {
    const hasXmlToolPattern = /<tool_use\s+id="[^"]*"\s+name="[^"]*">/.test(fullContent)
      || /<invoke\s+name="[^"]*">/.test(fullContent);

    if (hasXmlToolPattern) {
      console.log(`[anthropic.stream] Detected XML tool_use in text output (stop_reason=${stopReason ?? "unknown"}), attempting parse...`);
      const parsed = parseXmlToolCalls(fullContent);
      if (parsed && parsed.length > 0) {
        // Resolve internal names if tools are available
        const resolvedToolUses = tools
          ? parsed.map(tu => ({ ...tu, name: toInternalToolName(tu.name, tools) }))
          : parsed;
        console.log(`[anthropic.stream] Successfully parsed ${resolvedToolUses.length} XML tool call(s): ${resolvedToolUses.map(t => t.name).join(", ")}`);
        return { success: true, type: "tool_use", toolUses: resolvedToolUses, ...(thinkingContent ? { reasoningContent: thinkingContent, reasoningSignature: thinkingSignature || undefined } : {}), ...(usage ? { usage } : {}) };
      }
      // Parse failed — return failure to trigger retry
      console.warn(`[anthropic.stream] XML tool_use detected but parse failed, returning failure for retry`);
      return failure("upstream-error", "Model output XML tool_use but parsing failed — likely truncated due to max_tokens");
    }

    // Warn if stopped due to max_tokens without any tool calls
    if (stopReason === "max_tokens") {
      console.warn(`[anthropic.stream] Response truncated (stop_reason=max_tokens) with no structured tool_use. Content length: ${fullContent.length}`);
    }
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
      max_tokens: 16384,
      ...(useStreaming ? { stream: true } : {}),
      ...(input.tools?.length ? { tools: toAnthropicTools(input.tools, ctx) } : {}),
    };

    // Debug: log reasoning presence in messages sent to API
    const anthropicMsgs = body.messages as Array<Record<string, unknown>>;
    const thinkingCount = anthropicMsgs.filter(m => Array.isArray(m.content) && (m.content as Array<Record<string, unknown>>).some(b => b.type === "thinking")).length;
    const toolUseCount = anthropicMsgs.filter(m => Array.isArray(m.content) && (m.content as Array<Record<string, unknown>>).some(b => b.type === "tool_use")).length;
    const inputWithReasoning = input.messages.filter(m => m.role === "assistant" && (m as { reasoning_content?: string }).reasoning_content).length;
    console.log(`[anthropic.generate] ${anthropicMsgs.length} msgs, thinking=${thinkingCount}, tool_use=${toolUseCount}, inputReasoning=${inputWithReasoning}/${input.messages.length}`);

    // Extract system message — use content block format with cache_control for prompt caching
    const systemMessage = input.messages.find((m) => m.role === "system");
    if (systemMessage && "content" in systemMessage && systemMessage.content.trim()) {
      body.system = [
        { type: "text", text: systemMessage.content, cache_control: { type: "ephemeral" } },
      ];
    }

    // DeepSeek/Claude thinking support: if messages contain thinking blocks or model supports thinking,
    // we must include the thinking parameter in the request body. Without it, the API rejects
    // requests that contain thinking blocks in the message history (e.g. during tool-use continuation).
    const providerHint = detectModelProvider(input.modelId, input.providerId, input.baseUrl);
    const hasThinkingInHistory = thinkingCount > 0;

    if (providerHint === "deepseek") {
      // DeepSeek requires that EVERY assistant message with tool_use must have a thinking block
      // when thinking mode is enabled. Since we can't guarantee this (e.g. after context compaction
      // or failed turns), we explicitly disable thinking mode to avoid 400 errors.
      body.thinking = { type: "disabled" };
      // DeepSeek doesn't support cache_control
      stripCacheControlFromBody(body);
      // Strip any thinking blocks from messages since thinking is disabled
      let msgs = body.messages as Array<Record<string, unknown>>;
      msgs = msgs.map(msg => {
        if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;
        const filtered = (msg.content as Array<Record<string, unknown>>).filter(b => b.type !== "thinking");
        if (filtered.length === 0) return null;
        return { ...msg, content: filtered };
      }).filter(Boolean) as Array<Record<string, unknown>>;

      // Re-sanitize after stripping: ensure every assistant with tool_use has matching tool_results
      body.messages = sanitizeToolUseResults(msgs);
      // Debug: log final message structure for DeepSeek
      const finalMsgs = body.messages as Array<Record<string, unknown>>;
      for (let i = 0; i < finalMsgs.length; i++) {
        const m = finalMsgs[i];
        if (m.role === "assistant" && Array.isArray(m.content)) {
          const blocks = (m.content as Array<Record<string, unknown>>);
          const tuIds = blocks.filter(b => b.type === "tool_use").map(b => (b as {id?:string}).id ?? "?");
          console.log(`[deepseek.sanitize] msg[${i}] assistant tool_use_ids=[${tuIds.join(",")}]`);
        } else if (m.role === "user" && Array.isArray(m.content)) {
          const blocks = (m.content as Array<Record<string, unknown>>);
          const trIds = blocks.filter(b => b.type === "tool_result").map(b => (b as {tool_use_id?:string}).tool_use_id ?? "?");
          if (trIds.length > 0) console.log(`[deepseek.sanitize] msg[${i}] user tool_result_ids=[${trIds.join(",")}]`);
        }
      }
    } else if (hasThinkingInHistory) {
      // Claude: enable thinking and keep blocks as-is
      body.thinking = { type: "enabled", budget_tokens: 4096 };
    }

    // Debug: log the thinking blocks being sent back to API
    if (thinkingCount > 0) {
      for (const msg of anthropicMsgs) {
        if (!Array.isArray(msg.content)) continue;
        for (const block of (msg.content as Array<Record<string, unknown>>)) {
          if (block.type === "thinking") {
            console.log(`[anthropic.generate] thinking block: thinking=${typeof block.thinking === "string" ? (block.thinking as string).length + " chars" : "MISSING"}, signature=${typeof block.signature === "string" ? (block.signature as string).length + " chars" : "MISSING"}`);
          }
        }
      }
    }

    // Apply provider-specific body transforms (GLM, Kimi, etc.)
    const transformedBody = applyProviderBodyTransforms(body, ctx);
    // Copy transforms back (applyProviderBodyTransforms returns a new object for some providers)
    if (transformedBody !== body) {
      Object.keys(body).forEach(k => delete body[k]);
      Object.assign(body, transformedBody);
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
          console.log(`[anthropic.generate] API error ${response.status}: ${errorText}, providerHint=${providerHint}, hasThinking=${hasThinkingInHistory}, bodyHasThinking=${!!body.thinking}`);
          if (canRetry && (response.status === 404 || response.status === 405)) {
            lastError = errorText;
            continue;
          }
          const code: RuntimeAdapterFailureCode = response.status >= 500 ? "upstream-error" : "upstream-error";
          return failure(code, errorText);
        }

        if (useStreaming && response.body) {
          return await consumeAnthropicStream(response.body, input.onStreamChunk!, input.signal, input.onToolEvent, input.tools);
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
