/**
 * 多供应商模型定义
 */

export interface Model {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPrice?: number; // 每百万 token 价格
  outputPrice?: number;
  supportsFunctionCalling?: boolean;
  supportsVision?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  apiKeyRequired: boolean;
  baseUrl?: string;
  models: Model[];
}

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
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
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputPrice: 0.8,
        outputPrice: 4,
        supportsFunctionCalling: true,
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
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
      },
      {
        id: "gpt-4",
        name: "GPT-4",
        contextWindow: 8192,
        maxOutputTokens: 4096,
        inputPrice: 30,
        outputPrice: 60,
        supportsFunctionCalling: true,
      },
      {
        id: "gpt-3.5-turbo",
        name: "GPT-3.5 Turbo",
        contextWindow: 16385,
        maxOutputTokens: 4096,
        inputPrice: 0.5,
        outputPrice: 1.5,
        supportsFunctionCalling: true,
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
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
      },
      {
        id: "deepseek-coder",
        name: "DeepSeek Coder",
        contextWindow: 16384,
        maxOutputTokens: 4096,
        inputPrice: 0.14,
        outputPrice: 0.28,
      },
    ],
  },
  {
    id: "custom",
    name: "自定义",
    apiKeyRequired: false,
    models: [],
  },
];

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function getModel(providerId: string, modelId: string): Model | undefined {
  const provider = getProvider(providerId);
  return provider?.models.find((m) => m.id === modelId);
}
