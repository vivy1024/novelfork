import type { RuntimeModelInput } from "../provider-runtime-store.js";

export type RuntimeAdapterId = "openai-compatible" | "anthropic-compatible" | "codex-platform" | "kiro-platform";
export type RuntimeAdapterFailureCode = "unsupported" | "auth-missing" | "config-missing" | "upstream-error" | "network-error";

export interface RuntimeProviderRef {
  readonly providerId: string;
  readonly providerName: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiMode?: string;
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
    supportsFunctionCalling: true,
    supportsStreaming: true,
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

    // 根据 apiMode 选择测试端点
    if (input.apiMode === "responses") {
      const result = await requestOpenAiJson(input, "/responses", {
        method: "POST",
        headers: { ...openAiHeaders(input.apiKey!), "Content-Type": "application/json" },
        body: JSON.stringify({ model: input.modelId, input: "ping", max_output_tokens: 1 }),
      });
      if (!result.success) return result;
      if (!result.response.ok) {
        return failure("upstream-error", readOpenAiError(result.payload, `Test failed: HTTP ${result.response.status}`));
      }
      return { success: true, latency: Date.now() - startedAt };
    }

    // 默认 completions 模式
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

class AnthropicCompatibleAdapter implements RuntimeAdapter {
  private readonly ANTHROPIC_VERSION = "2023-06-01";

  async listModels(ref: RuntimeProviderRef): Promise<ListModelsResult> {
    if (!ref.apiKey?.trim()) {
      return failure("auth-missing", `API key missing for provider ${ref.providerId}`);
    }
    if (!ref.baseUrl?.trim()) {
      return failure("config-missing", `Base URL missing for provider ${ref.providerId}`);
    }

    // 尝试调用 Anthropic /v1/models API 获取模型列表
    const url = `${trimTrailingSlash(ref.baseUrl!)}/v1/models`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.buildHeaders(ref.apiKey!),
      });

      if (response.ok) {
        const payload = await response.json() as { data?: Array<{ id: string; display_name?: string; created_at?: string }> };
        if (Array.isArray(payload.data) && payload.data.length > 0) {
          return {
            success: true,
            models: payload.data.map((m) => ({
              id: m.id,
              name: m.display_name ?? m.id,
              contextWindow: 200000,
              maxOutputTokens: 16384,
              enabled: true,
              source: "detected" as const,
              lastTestStatus: "untested" as const,
            })),
          };
        }
      }

      // Anthropic 格式失败，尝试 OpenAI 格式（Bearer token）
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
              contextWindow: 200000,
              maxOutputTokens: 16384,
              enabled: true,
              source: "detected" as const,
              lastTestStatus: "untested" as const,
            })),
          };
        }
      }

      // 两种格式都失败，透传错误
      const errorText = response.ok ? "模型列表为空" : await response.text().catch(() => `HTTP ${response.status}`);
      return failure("upstream-error", `获取模型列表失败：${errorText}`);
    } catch (error) {
      return failure("network-error", error instanceof Error ? error.message : String(error));
    }
  }

  async testModel(input: TestModelInput): Promise<TestModelResult> {
    if (!input.apiKey?.trim()) {
      return failure("auth-missing", `API key missing for provider ${input.providerId}`);
    }
    if (!input.baseUrl?.trim()) {
      return failure("config-missing", `Base URL missing for provider ${input.providerId}`);
    }

    const startedAt = Date.now();
    const url = `${trimTrailingSlash(input.baseUrl!)}/v1/messages`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(input.apiKey!),
        body: JSON.stringify({
          model: input.modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      });

      if (!response.ok) {
        const errorText = await this.readAnthropicError(response);
        return failure("upstream-error", errorText);
      }

      return { success: true, latency: Date.now() - startedAt };
    } catch (error) {
      return failure("network-error", error instanceof Error ? error.message : String(error));
    }
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    if (!input.apiKey?.trim()) {
      return failure("auth-missing", `API key missing for provider ${input.providerId}`);
    }
    if (!input.baseUrl?.trim()) {
      return failure("config-missing", `Base URL missing for provider ${input.providerId}`);
    }

    const useStreaming = Boolean(input.onStreamChunk) && !input.tools?.length;
    const url = `${trimTrailingSlash(input.baseUrl!)}/v1/messages`;

    const body: Record<string, unknown> = {
      model: input.modelId,
      messages: this.toAnthropicMessages(input.messages),
      max_tokens: 8192,
      ...(useStreaming ? { stream: true } : {}),
      ...(input.tools?.length ? { tools: this.toAnthropicTools(input.tools) } : {}),
    };

    // Extract system message
    const systemMessage = input.messages.find((m) => m.role === "system");
    if (systemMessage && "content" in systemMessage && systemMessage.content.trim()) {
      body.system = systemMessage.content;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(input.apiKey!),
        body: JSON.stringify(body),
        ...(input.signal ? { signal: input.signal } : {}),
      });

      if (!response.ok) {
        const errorText = await this.readAnthropicError(response);
        const code: RuntimeAdapterFailureCode = response.status >= 500 ? "upstream-error" : "upstream-error";
        return failure(code, errorText);
      }

      if (useStreaming && response.body) {
        return await this.consumeAnthropicStream(response.body, input.onStreamChunk!, input.signal);
      }

      const payload = await response.json() as Record<string, unknown>;
      return this.parseAnthropicResponse(payload, input.tools);
    } catch (error) {
      if (input.signal?.aborted) {
        return failure("network-error", "Request aborted");
      }
      return failure("network-error", error instanceof Error ? error.message : String(error));
    }
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    return {
      "x-api-key": apiKey,
      "anthropic-version": this.ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    };
  }

  private toAnthropicMessages(messages: readonly RuntimeChatMessage[]): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

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
        if (message.content.trim()) {
          content.push({ type: "text", text: message.content });
        }
        for (const toolCall of message.toolCalls) {
          content.push({
            type: "tool_use",
            id: toolCall.id,
            name: toProviderSafeToolName(toolCall.name),
            input: toolCall.input,
          });
        }
        result.push({ role: "assistant", content });
        continue;
      }

      result.push({ role: message.role, content: message.content });
    }

    return result;
  }

  private toAnthropicTools(tools: readonly RuntimeToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      name: toProviderSafeToolName(tool.name),
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  private parseAnthropicResponse(payload: Record<string, unknown>, tools?: readonly RuntimeToolDefinition[]): GenerateResult {
    const usage = this.readAnthropicUsage(payload);
    const content = Array.isArray(payload.content) ? payload.content as Array<Record<string, unknown>> : [];

    const toolUses: RuntimeToolUse[] = [];
    let textContent = "";

    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        textContent += block.text;
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
      return { success: true, type: "tool_use", toolUses, ...(usage ? { usage } : {}) };
    }

    return { success: true, type: "message", content: textContent, ...(usage ? { usage } : {}) };
  }

  private readAnthropicUsage(payload: Record<string, unknown>): GenerateUsage | undefined {
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

  private async consumeAnthropicStream(
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
          return { success: true, type: "message", content: fullContent, ...(usage ? { usage } : {}) };
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

            if (parsed.type === "content_block_delta") {
              const delta = parsed.delta as Record<string, unknown> | undefined;
              if (delta && delta.type === "text_delta" && typeof delta.text === "string") {
                fullContent += delta.text;
                onStreamChunk(delta.text);
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

    return { success: true, type: "message", content: fullContent, ...(usage ? { usage } : {}) };
  }

  private async readAnthropicError(response: Response): Promise<string> {
    try {
      const payload = await response.json() as Record<string, unknown>;
      if (payload.error && typeof payload.error === "object") {
        const err = payload.error as Record<string, unknown>;
        if (typeof err.message === "string") return err.message;
      }
    } catch { /* ignore */ }
    return `Anthropic API request failed with HTTP ${response.status}`;
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

/**
 * CodexPlatformAdapter — Codex API 适配器
 *
 * Codex API 兼容 OpenAI chat/completions 格式，额外支持：
 * - reasoning_effort 参数（low/medium/high）
 * - 模型列表从平台账号配置中读取（非 /models 端点）
 */
class CodexPlatformAdapter implements RuntimeAdapter {
  async listModels(ref: RuntimeProviderRef): Promise<ListModelsResult> {
    const configFailure = requireOpenAiConfig(ref);
    if (configFailure) return configFailure;

    // Codex 平台模型列表通过 /models 端点获取（与 OpenAI 兼容）
    const result = await requestOpenAiJson(ref, "/models", {
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
    const configFailure = requireOpenAiConfig(input);
    if (configFailure) return configFailure;

    const startedAt = Date.now();
    const body = {
      model: input.modelId,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    };
    const result = await requestOpenAiJson(input, "/chat/completions", {
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
    const configFailure = requireOpenAiConfig(input);
    if (configFailure) return configFailure;

    const hasTools = Boolean(input.tools?.length);
    const useStreaming = Boolean(input.onStreamChunk) && !hasTools;

    const body: Record<string, unknown> = {
      model: input.modelId,
      messages: toOpenAiMessages(input.messages),
      stream: useStreaming,
      ...(useStreaming ? { stream_options: { include_usage: true } } : {}),
      ...(hasTools ? { tools: toOpenAiTools(input.tools!), tool_choice: "auto" } : {}),
    };

    const urls = openAiUrls(input, "/chat/completions");
    let lastError = "Codex platform request failed";

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
          let errorMessage = `Codex completion failed with HTTP ${response.status}`;
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

        if (useStreaming && response.body) {
          return await this.consumeStream(response.body, input.onStreamChunk!, input.signal);
        }

        const payload = await parseJsonResponse(response);
        const toolUses = readOpenAiToolUses(payload, input.tools);
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
          return { success: true, type: "message", content: fullContent, ...(usage ? { usage } : {}) };
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
          } catch { /* skip malformed SSE */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { success: true, type: "message", content: fullContent, ...(usage ? { usage } : {}) };
  }
}

export class ProviderAdapterRegistry {
  private readonly adapters: Map<RuntimeAdapterId, RuntimeAdapter>;

  constructor(adapters?: Partial<Record<RuntimeAdapterId, RuntimeAdapter>>) {
    this.adapters = new Map<RuntimeAdapterId, RuntimeAdapter>([
      ["openai-compatible", adapters?.["openai-compatible"] ?? new OpenAiCompatibleAdapter()],
      ["anthropic-compatible", adapters?.["anthropic-compatible"] ?? new AnthropicCompatibleAdapter()],
      ["codex-platform", adapters?.["codex-platform"] ?? new CodexPlatformAdapter()],
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
