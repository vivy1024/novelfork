/**
 * Model-specific parameter transforms.
 *
 * Applied before sending requests to handle provider-specific quirks:
 * - DeepSeek: tool name encoding, model aliases, reasoner param stripping
 * - GLM: thinking simplification, cache_control stripping
 * - Kimi: tool normalization
 * - MiniMax: tool normalization
 * - Qwen: tool normalization
 *
 * Architecture: these transforms are applied by the protocol adapters
 * (CompletionsAdapter, AnthropicAdapter) based on provider/model detection.
 */

// ─── DeepSeek ────────────────────────────────────────────────────────────────

const DEEPSEEK_MODEL_ALIASES: Record<string, string> = {
  "deepseek-r1": "deepseek-v4-flash",
  "deepseek-v3": "deepseek-v4-flash",
  "deepseek-v3.2": "deepseek-v4-flash",
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-flash",
};

/**
 * Encode a tool name for DeepSeek API compatibility.
 * DeepSeek restricts function names to [a-zA-Z0-9_-]{1,64}.
 * Replaces illegal characters with __hex__ sequences.
 */
export function encodeDeepSeekToolName(name: string): string {
  const encoded = name.replace(/[^a-zA-Z0-9_-]/g, (ch) => `__${ch.charCodeAt(0).toString(16)}__`);
  return encoded.slice(0, 64);
}

/**
 * Decode a tool name encoded by encodeDeepSeekToolName.
 */
export function decodeDeepSeekToolName(encoded: string): string {
  return encoded.replace(/__([0-9a-f]+)__/g, (_, hex) => String.fromCharCode(parseInt(hex as string, 16)));
}

/**
 * Check if a tool name needs encoding for DeepSeek.
 */
export function needsDeepSeekToolNameEncoding(name: string): boolean {
  return /[^a-zA-Z0-9_-]/.test(name);
}

/**
 * Normalize a DeepSeek model name through the alias table.
 */
export function normalizeDeepSeekModel(model: string): string {
  return DEEPSEEK_MODEL_ALIASES[model.toLowerCase()] ?? model;
}

/**
 * Check if a model is a DeepSeek reasoner model (ignores temperature/top_p).
 */
export function isDeepSeekReasonerModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("reasoner") || m === "deepseek-v4-pro";
}

// ─── Provider Detection ──────────────────────────────────────────────────────

export type ModelProviderHint = "deepseek" | "glm" | "kimi" | "minimax" | "qwen" | "mimo" | "generic";

/**
 * Detect the model provider from model name, provider ID, or base URL.
 */
export function detectModelProvider(modelId: string, providerId?: string, baseUrl?: string): ModelProviderHint {
  const m = modelId.toLowerCase();
  const pid = providerId?.toLowerCase() ?? "";
  const url = baseUrl?.toLowerCase() ?? "";

  if (m.startsWith("deepseek-") || pid.includes("deepseek") || url.includes("deepseek.com")) return "deepseek";
  if (m.startsWith("glm-") || m.startsWith("chatglm") || pid.includes("glm") || pid.includes("zhipu") || url.includes("bigmodel.cn") || url.includes("zhipuai")) return "glm";
  if (m.startsWith("moonshot") || m.startsWith("kimi") || pid.includes("kimi") || pid.includes("moonshot") || url.includes("moonshot") || url.includes("kimi")) return "kimi";
  if (m.startsWith("abab") || m.startsWith("minimax") || pid.includes("minimax") || url.includes("minimax")) return "minimax";
  if (m.startsWith("qwen") || pid.includes("qwen") || pid.includes("dashscope") || url.includes("dashscope") || url.includes("aliyun")) return "qwen";
  if (m.startsWith("mimo") || pid.includes("xiaomi") || pid.includes("mimo") || url.includes("xiaomimimo")) return "mimo";

  return "generic";
}

// ─── Transform Application ───────────────────────────────────────────────────

export interface ModelTransformContext {
  modelId: string;
  providerId?: string;
  baseUrl?: string;
}

/**
 * Apply model-specific transforms to the model ID (alias resolution).
 */
export function resolveModelId(ctx: ModelTransformContext): string {
  const provider = detectModelProvider(ctx.modelId, ctx.providerId, ctx.baseUrl);
  if (provider === "deepseek") return normalizeDeepSeekModel(ctx.modelId);
  return ctx.modelId;
}

/**
 * Check if temperature/top_p should be stripped for this model.
 */
export function shouldStripSamplingParams(ctx: ModelTransformContext): boolean {
  const provider = detectModelProvider(ctx.modelId, ctx.providerId, ctx.baseUrl);
  if (provider === "deepseek") return isDeepSeekReasonerModel(ctx.modelId);
  return false;
}

// ─── GLM (智谱) ──────────────────────────────────────────────────────────────

/**
 * GLM-specific transforms for Anthropic-compatible endpoint.
 * - Simplify thinking to { type: "enabled" } (no budget_tokens)
 * - Strip cache_control (not supported)
 * - Strip unsupported content block types (image, document)
 */
export function applyGLMTransforms(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  // GLM supports thinking but not budget_tokens
  if (out.thinking && typeof out.thinking === "object") {
    const t = out.thinking as Record<string, unknown>;
    if (t.type === "enabled" || t.type === "adaptive") {
      out.thinking = { type: "enabled" };
    }
  }
  // Strip cache_control from system and messages
  stripCacheControlFromBody(out);
  return out;
}

// ─── Kimi (月之暗面) ─────────────────────────────────────────────────────────

/**
 * Kimi-specific transforms.
 * - Supports OpenAI Chat Completions format
 * - 128k context window
 * - No special transforms needed beyond standard OpenAI compat
 */
export function applyKimiTransforms(body: Record<string, unknown>): Record<string, unknown> {
  // Kimi is fully OpenAI-compatible, no special transforms needed
  return body;
}

// ─── MiniMax ─────────────────────────────────────────────────────────────────

/**
 * MiniMax-specific transforms.
 * - Uses OpenAI Chat Completions format
 * - May need role_meta for character-based conversations (not applicable for tool use)
 * - Strip unsupported parameters
 */
export function applyMiniMaxTransforms(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  // MiniMax doesn't support reasoning_effort
  delete out.reasoning_effort;
  // MiniMax doesn't support stream_options
  delete out.stream_options;
  return out;
}

// ─── Qwen (通义千问) ─────────────────────────────────────────────────────────

/**
 * Qwen-specific transforms for DashScope/OpenAI-compatible endpoint.
 * - Supports standard OpenAI format via compatible endpoint
 * - Strip reasoning_effort (not supported)
 * - Qwen3 supports thinking via enable_thinking parameter
 */
export function applyQwenTransforms(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  // Qwen doesn't support reasoning_effort in OpenAI format
  delete out.reasoning_effort;
  // Qwen3 thinking mode: if model supports it, enable via extra_body
  const model = typeof out.model === "string" ? out.model.toLowerCase() : "";
  if (model.includes("qwen3") || model.includes("qwq")) {
    // Qwen3 uses enable_thinking parameter
    out.extra_body = { ...(out.extra_body as Record<string, unknown> ?? {}), enable_thinking: true };
  }
  return out;
}

// ─── MiMo (小米) ─────────────────────────────────────────────────────────────

/**
 * MiMo-specific transforms.
 * - Uses OpenAI Chat Completions format
 * - tool_call_id format requirements (handled elsewhere)
 * - No reasoning_effort support
 */
export function applyMiMoTransforms(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  // MiMo doesn't support reasoning_effort
  delete out.reasoning_effort;
  // MiMo doesn't support stream_options
  delete out.stream_options;
  return out;
}

// ─── Body Transform Application ──────────────────────────────────────────────

/**
 * Apply provider-specific body transforms before sending the request.
 * Called by adapters after constructing the base body.
 */
export function applyProviderBodyTransforms(body: Record<string, unknown>, ctx: ModelTransformContext): Record<string, unknown> {
  const provider = detectModelProvider(ctx.modelId, ctx.providerId, ctx.baseUrl);
  switch (provider) {
    case "glm": return applyGLMTransforms(body);
    case "kimi": return applyKimiTransforms(body);
    case "minimax": return applyMiniMaxTransforms(body);
    case "qwen": return applyQwenTransforms(body);
    case "mimo": return applyMiMoTransforms(body);
    default: return body;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripCacheControlFromBody(body: Record<string, unknown>): void {
  if (Array.isArray(body.system)) {
    body.system = (body.system as Array<Record<string, unknown>>).map(block => {
      if (block.cache_control) {
        const { cache_control, ...rest } = block;
        return rest;
      }
      return block;
    });
  }
  if (Array.isArray(body.messages)) {
    body.messages = (body.messages as Array<Record<string, unknown>>).map(msg => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: (msg.content as Array<Record<string, unknown>>).map(block => {
          if (block.cache_control) {
            const { cache_control, ...rest } = block;
            return rest;
          }
          return block;
        }),
      };
    });
  }
}

/**
 * Reorder thinking blocks before text blocks in response content (Anthropic format).
 * DeepSeek may return thinking after text; Claude always returns thinking first.
 * Returns null if no reordering needed.
 */
export function reorderThinkingBlocks(content: Array<Record<string, unknown>>): Array<Record<string, unknown>> | null {
  if (!content || content.length < 2) return null;
  const thinking: Array<Record<string, unknown>> = [];
  const other: Array<Record<string, unknown>> = [];
  for (const block of content) {
    if (block.type === "thinking") thinking.push(block);
    else other.push(block);
  }
  if (thinking.length === 0) return null;
  // Check if already in correct order (all thinking before all other)
  const firstThinkingIdx = content.findIndex(b => b.type === "thinking");
  if (!content.some((b, i) => b.type !== "thinking" && i < firstThinkingIdx)) return null;
  return [...thinking, ...other];
}
