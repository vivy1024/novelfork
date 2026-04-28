import type { RuntimeModelInput } from "../provider-runtime-store.js";

export type RuntimeAdapterId = "openai-compatible" | "anthropic-compatible" | "codex-platform" | "kiro-platform";
export type RuntimeAdapterFailureCode = "unsupported" | "auth-missing" | "config-missing" | "upstream-error" | "network-error";

export interface RuntimeProviderRef {
  readonly providerId: string;
  readonly providerName: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
}

export interface RuntimeChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface TestModelInput extends RuntimeProviderRef {
  readonly modelId: string;
}

export interface GenerateInput extends RuntimeProviderRef {
  readonly modelId: string;
  readonly messages: readonly RuntimeChatMessage[];
}

export type RuntimeAdapterFailure = {
  readonly success: false;
  readonly code: RuntimeAdapterFailureCode;
  readonly error: string;
  readonly capability?: string;
};

export type ListModelsResult = { readonly success: true; readonly models: RuntimeModelInput[] } | RuntimeAdapterFailure;
export type TestModelResult = { readonly success: true; readonly latency: number } | RuntimeAdapterFailure;
export type GenerateResult = { readonly success: true; readonly content: string } | RuntimeAdapterFailure;

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

function openAiUrl(ref: RuntimeProviderRef, path: string): string {
  return `${trimTrailingSlash(ref.baseUrl ?? "")}${path}`;
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
  async listModels(ref: RuntimeProviderRef): Promise<ListModelsResult> {
    const configFailure = requireOpenAiConfig(ref);
    if (configFailure) return configFailure;

    try {
      const response = await fetch(openAiUrl(ref, "/models"), {
        method: "GET",
        headers: openAiHeaders(ref.apiKey!),
      });
      const payload = await parseJsonResponse(response);
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
    } catch (error) {
      return failure("network-error", error instanceof Error ? error.message : String(error));
    }
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

    const result = await this.sendChatCompletion(input, input.messages);
    if (!result.success) {
      return result;
    }
    return { success: true, content: result.content };
  }

  private async sendChatCompletion(
    input: TestModelInput | GenerateInput,
    messages: readonly RuntimeChatMessage[],
    maxTokens?: number,
  ): Promise<GenerateResult> {
    try {
      const body = {
        model: input.modelId,
        messages,
        stream: false,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      };
      const response = await fetch(openAiUrl(input, "/chat/completions"), {
        method: "POST",
        headers: openAiHeaders(input.apiKey!),
        body: JSON.stringify(body),
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        return failure("upstream-error", readOpenAiError(payload, `Chat completion failed with HTTP ${response.status}`));
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
      return { success: true, content };
    } catch (error) {
      return failure("network-error", error instanceof Error ? error.message : String(error));
    }
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
