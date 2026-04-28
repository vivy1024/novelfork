import type { ProviderRuntimeStatus } from "./ai-gate.js";
import type { ProviderRuntimeStore, RuntimeModelSource, RuntimeModelTestStatus, RuntimePlatformId, RuntimeProviderRecord } from "./provider-runtime-store.js";

export interface RuntimeModelPoolEntry {
  readonly modelId: string;
  readonly modelName: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly enabled: boolean;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly source: RuntimeModelSource;
  readonly lastTestStatus: RuntimeModelTestStatus;
  readonly capabilities: {
    readonly functionCalling: boolean;
    readonly vision: boolean;
    readonly streaming: boolean;
  };
}

const PLATFORM_PROVIDER_IDS = new Set<RuntimePlatformId>(["codex", "kiro", "cline"]);

function isPlatformProvider(provider: RuntimeProviderRecord): provider is RuntimeProviderRecord & { id: RuntimePlatformId } {
  return PLATFORM_PROVIDER_IDS.has(provider.id as RuntimePlatformId);
}

function hasApiCredentials(provider: RuntimeProviderRecord): boolean {
  return !provider.apiKeyRequired || Boolean(provider.config.apiKey?.trim());
}

export async function buildRuntimeProviderStatus(store: ProviderRuntimeStore): Promise<ProviderRuntimeStatus> {
  const modelPool = await buildRuntimeModelPool(store);
  const firstModel = modelPool[0];

  if (!firstModel) {
    return { hasUsableModel: false };
  }

  return {
    hasUsableModel: true,
    defaultProvider: firstModel.providerId,
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
        capabilities: {
          functionCalling: model.supportsFunctionCalling === true,
          vision: model.supportsVision === true,
          streaming: model.supportsStreaming === true,
        },
      }));
  });
}
