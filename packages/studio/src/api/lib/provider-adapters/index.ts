import type { RuntimeModelInput } from "../provider-runtime-store.js";
import { detectModelProvider, encodeDeepSeekToolName, decodeDeepSeekToolName, needsDeepSeekToolNameEncoding, resolveModelId, shouldStripSamplingParams, applyProviderBodyTransforms, type ModelTransformContext } from "./model-transforms.js";

export type RuntimeAdapterId = "openai-compatible" | "anthropic-compatible" | "codex-platform" | "kiro-platform";
export type RuntimeAdapterFailureCode = "unsupported" | "auth-missing" | "config-missing" | "upstream-error" | "network-error";

// ─── Proxy-aware fetch ───────────────────────────────────────────────────────
// Bun 原生支持 fetch({ proxy: "http://..." })，无需额外依赖。
// 通过 setProviderProxy 设置全局代理 URL 或按 providerId 的代理映射。

let _globalProxyUrl: string | undefined;
let _perProviderProxy: Record<string, string> = {};

/**
 * 设置全局 AI 代理 URL（对所有 provider 生效，除非该 provider 有独立代理配置）。
 */
export function setGlobalProxyUrl(url: string | undefined): void {
  _globalProxyUrl = url?.trim() || undefined;
}

/**
 * 设置按 providerId 的代理映射。
 */
export function setPerProviderProxy(mapping: Record<string, string>): void {
  _perProviderProxy = { ...mapping };
}

/**
 * 获取指定 provider 应使用的代理 URL。
 * 优先级：per-provider > global > undefined
 */
function resolveProxyUrl(providerId?: string): string | undefined {
  if (providerId && _perProviderProxy[providerId]) {
    return _perProviderProxy[providerId];
  }
  return _globalProxyUrl;
}

/**
 * 代理感知的 fetch 封装。当有代理配置时，注入 Bun 的 proxy 选项。
 */
function proxyFetch(url: string | URL | Request, init?: RequestInit, providerId?: string): Promise<Response> {
  const proxy = resolveProxyUrl(providerId);
  if (proxy) {
    return fetch(url, { ...init, proxy } as any);
  }
  return fetch(url, init);
}
// ─────────────────────────────────────────────────────────────────────────────

export interface RuntimeProviderRef {
  readonly providerId: string;
  readonly providerName: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiMode?: string;
}

export type RuntimeChatMessage =
  | { readonly role: "system" | "user" | "assistant"; readonly content: string; readonly toolCalls?: readonly RuntimeToolUse[]; readonly reasoning_content?: string; readonly reasoning_signature?: string; readonly attachments?: Array<{ type: "image"; mimeType: string; filePath: string; fileName?: string }> }
  | { readonly role: "tool"; readonly toolCallId: string; readonly name?: string; readonly content: string };

export interface TestModelInput extends RuntimeProviderRef {
  readonly modelId: string;
}

export interface RuntimeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface RuntimeToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export type RuntimeToolStreamEvent =
  | { type: "tool_started"; id: string; name: string }
  | { type: "tool_input_chunk"; id: string; partialInput: string };

export interface GenerateInput extends RuntimeProviderRef {
  readonly modelId: string;
  readonly messages: readonly RuntimeChatMessage[];
  readonly tools?: readonly RuntimeToolDefinition[];
  readonly onStreamChunk?: (chunk: string) => void;
  readonly onToolEvent?: (event: RuntimeToolStreamEvent) => void;
  readonly signal?: AbortSignal;
  /** Reasoning effort level (low/medium/high) — passed to models that support it */
  readonly reasoningEffort?: string;
  /** Service tier (e.g. "default", "priority" for fast mode) */
  readonly serviceTier?: string;
}

export type RuntimeAdapterFailure = {
  readonly success: false;
  readonly code: RuntimeAdapterFailureCode;
  readonly error: string;
  readonly capability?: string;
};

export type ListModelsResult = { readonly success: true; readonly models: RuntimeModelInput[] } | RuntimeAdapterFailure;
export type TestModelResult = { readonly success: true; readonly latency: number } | RuntimeAdapterFailure;
export interface GenerateUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

export type GenerateResult =
  | { readonly success: true; readonly type: "message"; readonly content: string; readonly reasoningContent?: string; readonly reasoningSignature?: string; readonly usage?: GenerateUsage }
  | { readonly success: true; readonly type: "tool_use"; readonly toolUses: readonly RuntimeToolUse[]; readonly reasoningContent?: string; readonly reasoningSignature?: string; readonly usage?: GenerateUsage }
  | RuntimeAdapterFailure;

export interface RuntimeAdapter {
  listModels(ref: RuntimeProviderRef): Promise<ListModelsResult>;
  testModel(input: TestModelInput): Promise<TestModelResult>;
  generate(input: GenerateInput): Promise<GenerateResult>;
}

function failure(code: RuntimeAdapterFailureCode, error: string, capability?: string): RuntimeAdapterFailure {
  return {
    success: false,
    code,
    error,
    ...(capability ? { capability } : {}),
  };
}

function unsupported(capability: string): RuntimeAdapterFailure {
  return failure("unsupported", `Capability unsupported: ${capability}`, capability);
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function openAiUrls(ref: RuntimeProviderRef, path: string): string[] {
  const baseUrl = trimTrailingSlash(ref.baseUrl ?? "");
  const candidates = [`${baseUrl}${path}`];
  if (!/\/v1$/u.test(baseUrl)) {
    candidates.push(`${baseUrl}/v1${path}`);
  }
  return [...new Set(candidates)];
}

function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function requestOpenAiJson(ref: RuntimeProviderRef, path: string, init: RequestInit): Promise<
  | { readonly success: true; readonly response: Response; readonly payload: unknown }
  | RuntimeAdapterFailure
> {
  const urls = openAiUrls(ref, path);
  let lastError = "OpenAI-compatible request failed";

  for (const [index, url] of urls.entries()) {
    const canRetry = index < urls.length - 1;
    try {
      const response = await proxyFetch(url, init, ref.providerId);
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

function readOpenAiError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
  }
  return fallback;
}

function safeJsonParse(str: string): Record<string, unknown> {
  try { return JSON.parse(str) as Record<string, unknown>; }
  catch { return {}; }
}

function toProviderSafeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/gu, "_");
}

/** DeepSeek-aware tool name encoding — reversible via __hex__ sequences */
function encodeToolNameForProvider(name: string, ctx?: ModelTransformContext): string {
  if (ctx && detectModelProvider(ctx.modelId, ctx.providerId, ctx.baseUrl) === "deepseek") {
    return needsDeepSeekToolNameEncoding(name) ? encodeDeepSeekToolName(name) : name;
  }
  return toProviderSafeToolName(name);
}

/** DeepSeek-aware tool name decoding */
function decodeToolNameFromProvider(encoded: string, tools: readonly RuntimeToolDefinition[], ctx?: ModelTransformContext): string {
  if (ctx && detectModelProvider(ctx.modelId, ctx.providerId, ctx.baseUrl) === "deepseek") {
    const decoded = decodeDeepSeekToolName(encoded);
    return tools.find(t => t.name === decoded)?.name ?? decoded;
  }
  return tools.find((tool) => toProviderSafeToolName(tool.name) === encoded)?.name ?? encoded;
}

function toInternalToolName(name: string, tools: readonly RuntimeToolDefinition[]): string {
  // Try DeepSeek decode first, then fallback to standard lookup
  const decodedDs = decodeDeepSeekToolName(name);
  const found = tools.find(t => t.name === decodedDs || toProviderSafeToolName(t.name) === name);
  return found?.name ?? name;
}

function toOpenAiTools(tools: readonly RuntimeToolDefinition[], ctx?: ModelTransformContext): Array<Record<string, unknown>> {
  return tools.map((tool) => {
    const safeName = encodeToolNameForProvider(tool.name, ctx);
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

function toOpenAiMessages(messages: readonly RuntimeChatMessage[], ctx?: ModelTransformContext): Array<Record<string, unknown>> {
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
            name: encodeToolNameForProvider(toolCall.name, ctx),
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

function readOpenAiUsage(payload: unknown): GenerateUsage | undefined {
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

/** Finalize accumulated OpenAI streaming tool_calls into RuntimeToolUse[] */
function finalizeOpenAiStreamToolCalls(
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

function readOpenAiToolUses(payload: unknown, tools: readonly RuntimeToolDefinition[] = []): RuntimeToolUse[] {
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

function normalizeOpenAiModel(value: unknown): RuntimeModelInput | null {
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

// ─── Legacy adapter classes REMOVED ──────────────────────────────────────────
// OpenAiCompatibleAdapter, AnthropicCompatibleAdapter, CodexPlatformAdapter,
// UnsupportedAdapter, and ProviderAdapterRegistry have been removed.
// All routing now goes through registry.ts → protocol-based adapters:
//   completions.ts (CompletionsAdapter)
//   anthropic.ts (AnthropicAdapter)
//   codex.ts (CodexAdapter)
//   claude-code.ts (ClaudeCodeAdapter)
//   responses.ts (ResponsesAdapter)

// Backward-compat export for test files that still reference these
export type ProviderAdapterRegistry = { get(id: RuntimeAdapterId): RuntimeAdapter };
export function createProviderAdapterRegistry(): ProviderAdapterRegistry {
  // Import the real adapters from registry
  const { getAdapterForProtocol } = require("./registry.js");
  const protocolMap: Record<RuntimeAdapterId, string> = {
    "openai-compatible": "completions",
    "anthropic-compatible": "anthropic",
    "codex-platform": "codex",
    "kiro-platform": "completions",
  };
  return {
    get: (id: RuntimeAdapterId) => getAdapterForProtocol(protocolMap[id] ?? "completions"),
  };
}
