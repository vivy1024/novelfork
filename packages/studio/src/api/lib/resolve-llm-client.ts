/**
 * Resolve LLM client from active provider configuration.
 * Shared utility to avoid duplicating provider resolution logic across tool handlers.
 */

import type { LLMClient } from "@vivy1024/novelfork-core";

export interface ResolvedLLMClient {
  readonly client: LLMClient;
  readonly model: string;
  readonly providerId: string;
}

export interface ResolveLLMClientError {
  readonly ok: false;
  readonly error: "llm-config-missing";
  readonly summary: string;
}

export type ResolveLLMClientResult = { ok: true } & ResolvedLLMClient | ResolveLLMClientError;

export async function resolveLLMClientFromSession(sessionConfig?: { providerId?: string; modelId?: string }): Promise<ResolveLLMClientResult> {
  const { ProviderRuntimeStore } = await import("./provider-runtime-store.js");
  const { createLLMClient } = await import("@vivy1024/novelfork-core");

  const providerStore = new ProviderRuntimeStore();
  const providers = await providerStore.listProviders();
  const sessionProvider = sessionConfig?.providerId
    ? await providerStore.getProvider(sessionConfig.providerId)
    : undefined;
  const activeProvider = sessionProvider?.config?.apiKey
    ? sessionProvider
    : providers.find((p) => p.enabled !== false && p.config?.apiKey);

  if (!activeProvider) {
    return { ok: false, error: "llm-config-missing", summary: "模型配置未完成，请先到管理中心配置 API Key。" };
  }

  const activeModel = activeProvider.models.find((model) => model.id === sessionConfig?.modelId && model.enabled !== false)
    ?? activeProvider.models.find((model) => model.enabled !== false)
    ?? activeProvider.models[0];

  const llmConfig = {
    provider: (activeProvider.protocol === "anthropic" ? "anthropic" : "openai") as "openai" | "anthropic",
    baseUrl: activeProvider.config?.endpoint || activeProvider.baseUrl || "https://api.openai.com/v1",
    apiKey: activeProvider.config?.apiKey ?? "",
    model: activeModel?.id ?? sessionConfig?.modelId ?? "gpt-4",
    temperature: 0.7,
    maxTokens: activeModel?.maxOutputTokens ?? 8192,
    thinkingBudget: 0,
    apiFormat: "chat" as const,
    stream: true,
  };

  const client = createLLMClient(llmConfig);
  return { ok: true, client, model: llmConfig.model, providerId: activeProvider.id };
}
