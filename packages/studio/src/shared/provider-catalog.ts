export type ProviderType = "anthropic" | "openai" | "deepseek" | "custom";

export interface Model {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPrice?: number;
  outputPrice?: number;
  supportsFunctionCalling?: boolean;
  supportsVision?: boolean;
  supportsStreaming?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  apiKeyRequired: boolean;
  baseUrl?: string;
  models: Model[];
}

export interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  timeout?: number;
  retryAttempts?: number;
  customHeaders?: Record<string, string>;
}

export interface ManagedProvider extends Provider {
  enabled: boolean;
  priority: number;
  config: ProviderConfig;
}

export interface ModelPoolEntry {
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  enabled: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    apiKeyRequired: true,
    baseUrl: "https://api.anthropic.com",
    models: [
      {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        contextWindow: 200000,
        maxOutputTokens: 16384,
        inputPrice: 15,
        outputPrice: 75,
        supportsFunctionCalling: true,
        supportsVision: true,
        supportsStreaming: true,
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        contextWindow: 200000,
        maxOutputTokens: 16384,
        inputPrice: 3,
        outputPrice: 15,
        supportsFunctionCalling: true,
        supportsVision: true,
        supportsStreaming: true,
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputPrice: 0.8,
        outputPrice: 4,
        supportsFunctionCalling: true,
        supportsStreaming: true,
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    apiKeyRequired: true,
    baseUrl: "https://api.openai.com/v1",
    models: [
      {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputPrice: 10,
        outputPrice: 30,
        supportsFunctionCalling: true,
        supportsVision: true,
        supportsStreaming: true,
      },
      {
        id: "gpt-4",
        name: "GPT-4",
        contextWindow: 8192,
        maxOutputTokens: 4096,
        inputPrice: 30,
        outputPrice: 60,
        supportsFunctionCalling: true,
        supportsStreaming: true,
      },
      {
        id: "gpt-3.5-turbo",
        name: "GPT-3.5 Turbo",
        contextWindow: 16385,
        maxOutputTokens: 4096,
        inputPrice: 0.5,
        outputPrice: 1.5,
        supportsFunctionCalling: true,
        supportsStreaming: true,
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "deepseek",
    apiKeyRequired: true,
    baseUrl: "https://api.deepseek.com",
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        contextWindow: 32768,
        maxOutputTokens: 4096,
        inputPrice: 0.14,
        outputPrice: 0.28,
        supportsFunctionCalling: true,
        supportsStreaming: true,
      },
      {
        id: "deepseek-coder",
        name: "DeepSeek Coder",
        contextWindow: 16384,
        maxOutputTokens: 4096,
        inputPrice: 0.14,
        outputPrice: 0.28,
        supportsStreaming: true,
      },
    ],
  },
  {
    id: "custom",
    name: "自定义",
    type: "custom",
    apiKeyRequired: false,
    models: [],
  },
];

const providerMap = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  custom: "自定义",
};

export function getProvider(id: string): Provider | undefined {
  return providerMap.get(id);
}

export function getModel(providerId: string, modelId: string): Model | undefined {
  return getProvider(providerId)?.models.find((model) => model.id === modelId);
}

export function getDefaultProvider(): Provider {
  return PROVIDERS[0];
}

export function getDefaultModel(providerId = getDefaultProvider().id): Model | undefined {
  return getProvider(providerId)?.models[0];
}

export function getProviderTypeLabel(type: ProviderType): string {
  return PROVIDER_TYPE_LABELS[type] ?? type;
}

export function buildManagedProviders(): ManagedProvider[] {
  return PROVIDERS.map((provider, index) => ({
    ...provider,
    enabled: true,
    priority: index + 1,
    config: {},
    models: provider.models.map((model) => ({ ...model })),
  }));
}

export function buildModelPool(providers: ManagedProvider[]): ModelPoolEntry[] {
  return providers
    .flatMap((provider) =>
      provider.models.map((model) => ({
        modelId: `${provider.id}:${model.id}`,
        modelName: model.name,
        providerId: provider.id,
        providerName: provider.name,
        enabled: provider.enabled,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
      })),
    )
    .sort((a, b) => {
      const providerA = providers.find((provider) => provider.id === a.providerId);
      const providerB = providers.find((provider) => provider.id === b.providerId);
      return (providerA?.priority ?? 999) - (providerB?.priority ?? 999);
    });
}
