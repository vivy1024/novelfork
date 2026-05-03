import type { RuntimeModelInput } from "../provider-runtime-store.js";

export type RuntimeAdapterId = "openai-compatible" | "anthropic-compatible" | "codex-platform" | "kiro-platform";
export type RuntimeAdapterFailureCode = "unsupported" | "auth-missing" | "config-missing" | "upstream-error" | "network-error";

export interface RuntimeProviderRef {
  readonly providerId: string;
  readonly providerName: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
}

export type RuntimeChatMessage =
  | { readonly role: "system" | "user" | "assistant"; readonly content: string; readonly toolCalls?: readonly RuntimeToolUse[] }
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

export interface GenerateInput extends RuntimeProviderRef {
  readonly modelId: string;
  readonly messages: readonly RuntimeChatMessage[];
  readonly tools?: readonly RuntimeToolDefinition[];
  readonly onStreamChunk?: (chunk: string) => void;
  readonly signal?: AbortSignal;
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
  | { readonly success: true; readonly type: "message"; readonly content: string; readonly usage?: GenerateUsage }
  | { readonly success: true; readonly type: "tool_use"; readonly toolUses: readonly RuntimeToolUse[]; readonly usage?: GenerateUsage }
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

function toProviderSafeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/gu, "_");
}

function toInternalToolName(name: string, tools: readonly RuntimeToolDefinition[]): string {
  return tools.find((tool) => toProviderSafeToolName(tool.name) === name)?.name ?? name;
}

function toOpenAiTools(tools: readonly RuntimeToolDefinition[]): Array<Record<string, unknown>> {
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

function toOpenAiMessages(messages: readonly RuntimeChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
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
    }

    return { role: message.role, content: message.content };
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
  };
}

class OpenAiCompatibleAdapter implements RuntimeAdapter {
  // [proxy-injection] 代理注入 — 当 ProxySettings.providers[providerId] 非空时，
  // 通过 https-proxy-agent 或 undici ProxyAgent 将请求经代理发出。
  // 当前仅实现配置存储，实际注入需引入 proxy-agent 依赖后完成。
  async listModels(ref: RuntimeProviderRef): Promise<ListModelsResult> {
    const configFailure = requireOpenAiConfig(ref);
    if (configFailure) return configFailure;

    const result = await requestOpenAiJson(ref, "/models", {
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

    const hasTools = Boolean(input.tools?.length);
    const useStreaming = Boolean(input.onStreamChunk) && !hasTools;

    if (useStreaming) {
      return this.sendStreamingChatCompletion(input, input.messages, input.tools, input.onStreamChunk!, input.signal);
    }

    return this.sendChatCompletion(input, input.messages, undefined, input.tools, input.signal);
  }

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

    const urls = openAiUrls(input, "/chat/completions");
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

        return await this.consumeStream(response.body, onStreamChunk, signal);
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
  ): Promise<GenerateResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let usage: GenerateUsage | undefined;

    try {
      for (;;) {
        if (signal?.aborted) {
          reader.cancel().catch(() => {});
          return {
            success: true,
            type: "message",
            content: fullContent,
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
            const delta = choices[0] && typeof choices[0] === "object" && "delta" in choices[0]
              ? (choices[0] as { delta?: unknown }).delta
              : undefined;
            if (delta && typeof delta === "object" && "content" in delta) {
              const content = (delta as { content?: unknown }).content;
              if (typeof content === "string" && content.length > 0) {
                fullContent += content;
                onStreamChunk(content);
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

    return {
      success: true,
      type: "message",
      content: fullContent,
      ...(usage ? { usage } : {}),
    };
  }

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
    const result = await requestOpenAiJson(input, "/chat/completions", {
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
    return { success: true, type: "message", content, ...(usage ? { usage } : {}) };
  }
}

class UnsupportedAdapter implements RuntimeAdapter {
  constructor(private readonly adapterId: RuntimeAdapterId) {}

  async listModels(): Promise<ListModelsResult> {
    return unsupported(`${this.adapterId}.listModels`);
  }

  async testModel(): Promise<TestModelResult> {
    return unsupported(`${this.adapterId}.testModel`);
  }

  async generate(): Promise<GenerateResult> {
    return unsupported(`${this.adapterId}.generate`);
  }
}

export class ProviderAdapterRegistry {
  private readonly adapters: Map<RuntimeAdapterId, RuntimeAdapter>;

  constructor(adapters?: Partial<Record<RuntimeAdapterId, RuntimeAdapter>>) {
    this.adapters = new Map<RuntimeAdapterId, RuntimeAdapter>([
      ["openai-compatible", adapters?.["openai-compatible"] ?? new OpenAiCompatibleAdapter()],
      ["anthropic-compatible", adapters?.["anthropic-compatible"] ?? new UnsupportedAdapter("anthropic-compatible")],
      ["codex-platform", adapters?.["codex-platform"] ?? new UnsupportedAdapter("codex-platform")],
      ["kiro-platform", adapters?.["kiro-platform"] ?? new UnsupportedAdapter("kiro-platform")],
    ]);
  }

  get(adapterId: RuntimeAdapterId): RuntimeAdapter {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      throw new Error(`Unknown provider adapter: ${adapterId}`);
    }
    return adapter;
  }
}

export function createProviderAdapterRegistry(adapters?: Partial<Record<RuntimeAdapterId, RuntimeAdapter>>): ProviderAdapterRegistry {
  return new ProviderAdapterRegistry(adapters);
}
