export interface AIProvider {
  id: string;
  name: string;
  type: "anthropic" | "openai";
  enabled: boolean;
  priority: number;
  config: ProviderConfig;
  models: AIModel[];
}

export interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  timeout?: number;
  retryAttempts?: number;
  customHeaders?: Record<string, string>;
}

export interface AIModel {
  id: string;
  name: string;
  providerId: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
}

export interface ModelPoolEntry {
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  enabled: boolean;
}
