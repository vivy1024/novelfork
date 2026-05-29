import type { ProviderRuntimeStatus, RuntimeModelPoolEntry } from "../../shared/provider-catalog.js";
import type { ProviderRuntimeStore, RuntimePlatformId, RuntimeProviderRecord } from "./provider-runtime-store.js";

export type { RuntimeModelPoolEntry } from "../../shared/provider-catalog.js";

const PLATFORM_PROVIDER_IDS = new Set<RuntimePlatformId>(["codex", "kiro", "cline"]);

function isPlatformProvider(provider: RuntimeProviderRecord): provider is RuntimeProviderRecord & { id: RuntimePlatformId } {
  return PLATFORM_PROVIDER_IDS.has(provider.id as RuntimePlatformId);
}

function hasApiCredentials(provider: RuntimeProviderRecord): boolean {
  return !provider.apiKeyRequired || Boolean(provider.config.apiKey?.trim());
}

export async function buildRuntimeProviderStatus(store: ProviderRuntimeStore, userDefaultModel?: string): Promise<ProviderRuntimeStatus> {
  const modelPool = await buildRuntimeModelPool(store);
  const providers = await store.listProviders();
  const providerNameMap = new Map(providers.map((p) => [p.id, p.name || p.id]));

  // 优先使用用户配置的默认模型
  if (userDefaultModel) {
    const parts = userDefaultModel.split(":");
    const providerId = parts[0] ?? "";
    const modelId = parts.slice(1).join(":") || userDefaultModel;
    // 验证该模型在池中可用
    const found = modelPool.find((m) => m.modelId === userDefaultModel || (m.providerId === providerId && m.modelId === userDefaultModel));
    if (found || modelPool.length > 0) {
      const resolvedProviderId = providerId || modelPool[0]?.providerId || "";
      return {
        hasUsableModel: modelPool.length > 0,
        defaultProvider: providerNameMap.get(resolvedProviderId) ?? resolvedProviderId,
        defaultModel: modelId,
      };
    }
  }

  const firstModel = modelPool[0];

  if (!firstModel) {
    return { hasUsableModel: false };
  }

  return {
    hasUsableModel: true,
    defaultProvider: providerNameMap.get(firstModel.providerId) ?? firstModel.providerId,
    defaultModel: firstModel.modelId.slice(`${firstModel.providerId}:`.length),
  };
}

export async function buildRuntimeModelPool(store: ProviderRuntimeStore): Promise<RuntimeModelPoolEntry[]> {
  const [providers, accounts] = await Promise.all([
    store.listProviders(),
    store.listPlatformAccounts(),
  ]);
  const activePlatforms = new Set(
    accounts
      .filter((account) => account.status === "active" && account.current !== false)
      .map((account) => account.platformId),
  );

  return providers.flatMap((provider) => {
    if (!provider.enabled) {
      return [];
    }

    if (isPlatformProvider(provider) && !activePlatforms.has(provider.id)) {
      return [];
    }

    const providerUsable = isPlatformProvider(provider) || hasApiCredentials(provider);
    if (!providerUsable) {
      return [];
    }

    return provider.models
      .filter((model) => model.enabled !== false)
      .map((model) => ({
        modelId: `${provider.id}:${model.id}`,
        modelName: model.name,
        providerId: provider.id,
        providerName: provider.name,
        enabled: true,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        source: model.source,
        lastTestStatus: model.lastTestStatus,
        protocol: provider.protocol,
        capabilities: {
          functionCalling: model.supportsFunctionCalling !== false,
          vision: model.supportsVision === true,
          streaming: model.supportsStreaming !== false,
        },
      }));
  });
}
