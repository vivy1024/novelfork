/**
 * AI 提供商管理服务
 * 统一管理多个 AI 提供商目录与运行时配置
 */

import {
  buildManagedProviders,
  buildModelPool,
  normalizeModelForSettings,
  normalizeProviderForSettings,
  type ManagedProvider,
  type Model,
  type ModelPoolEntry,
} from "../../shared/provider-catalog.js";
import type { ProviderRuntimeStatus } from "./ai-gate.js";

export type AIProvider = ManagedProvider;
export type AIModel = Model;
export type { ModelPoolEntry, ProviderConfig } from "../../shared/provider-catalog.js";
export type { ProviderRuntimeStatus } from "./ai-gate.js";

export class ProviderManager {
  private providers: Map<string, AIProvider> = new Map();
  private models: Map<string, AIModel> = new Map();
  private lastConnectionErrors: Map<string, string> = new Map();

  private registerProvider(provider: AIProvider): void {
    const normalized = normalizeProviderForSettings(provider);
    this.providers.set(normalized.id, normalized);
    this.syncProviderModels(normalized.id);
  }

  private syncProviderModels(providerId: string): void {
    for (const key of Array.from(this.models.keys())) {
      if (key.startsWith(`${providerId}:`)) {
        this.models.delete(key);
      }
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      return;
    }

    for (const model of provider.models) {
      this.models.set(`${provider.id}:${model.id}`, normalizeModelForSettings(model));
    }
  }

  /**
   * 初始化默认提供商
   */
  initialize(): void {
    this.providers.clear();
    this.models.clear();
    this.lastConnectionErrors.clear();

    for (const provider of buildManagedProviders()) {
      this.registerProvider(provider);
    }
  }

  /**
   * 获取所有提供商
   */
  listProviders(): AIProvider[] {
    return Array.from(this.providers.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取单个提供商
   */
  getProvider(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * 更新提供商配置
   */
  updateProvider(id: string, updates: Partial<AIProvider>): AIProvider | null {
    const provider = this.providers.get(id);
    if (!provider) {
      return null;
    }

    const { id: _ignoredId, config, models, ...restUpdates } = updates;
    const updated: AIProvider = normalizeProviderForSettings({
      ...provider,
      ...restUpdates,
      config: {
        ...provider.config,
        ...config,
      },
      models: models ? models.map((model) => normalizeModelForSettings(model)) : provider.models.map((model) => normalizeModelForSettings(model)),
    });

    this.providers.set(id, updated);
    this.syncProviderModels(id);
    return updated;
  }

  /**
   * 启用/禁用提供商
   */
  toggleProvider(id: string, enabled: boolean): boolean {
    const provider = this.providers.get(id);
    if (!provider) {
      return false;
    }

    this.providers.set(id, {
      ...provider,
      enabled,
    });
    return true;
  }

  /**
   * 重新排序提供商
   */
  reorderProviders(orderedIds: string[]): boolean {
    for (const id of orderedIds) {
      if (!this.providers.has(id)) {
        return false;
      }
    }

    orderedIds.forEach((id, index) => {
      const provider = this.providers.get(id);
      if (provider) {
        this.providers.set(id, {
          ...provider,
          priority: index + 1,
        });
      }
    });

    return true;
  }

  /**
   * 获取模型池（所有可用模型）
   */
  getModelPool(): ModelPoolEntry[] {
    return buildModelPool(this.listProviders());
  }

  getRuntimeStatus(): ProviderRuntimeStatus {
    const providers = this.listProviders();
    const usableProvider = providers.find((provider) => this.isProviderUsable(provider));
    const usableModel = usableProvider?.models.find((model) => model.enabled !== false);

    if (usableProvider && usableModel) {
      return {
        hasUsableModel: true,
        defaultProvider: usableProvider.id,
        defaultModel: usableModel.id,
      };
    }

    const errorProvider = providers.find((provider) => this.lastConnectionErrors.has(provider.id));
    return {
      hasUsableModel: false,
      ...(errorProvider ? { lastConnectionError: this.lastConnectionErrors.get(errorProvider.id) } : {}),
    };
  }

  private isProviderUsable(provider: AIProvider): boolean {
    if (!provider.enabled || !provider.models.some((model) => model.enabled !== false) || this.lastConnectionErrors.has(provider.id)) {
      return false;
    }

    if (provider.apiKeyRequired) {
      return Boolean(provider.config.apiKey?.trim());
    }

    if (provider.type === "custom") {
      return Boolean(provider.config.endpoint?.trim());
    }

    return true;
  }

  private recordConnectionFailure(id: string, error: string): { success: false; error: string } {
    this.lastConnectionErrors.set(id, error);
    return { success: false, error };
  }

  /**
   * 测试提供商连通性
   */
  async testProviderConnection(id: string): Promise<{ success: boolean; error?: string; latency?: number }> {
    const provider = this.providers.get(id);
    if (!provider) {
      return this.recordConnectionFailure(id, "Provider not found");
    }

    const startTime = Date.now();

    try {
      switch (provider.type) {
        case "anthropic":
        case "openai":
        case "deepseek":
          if (!provider.config.apiKey) {
            return this.recordConnectionFailure(id, "API key not configured");
          }
          break;

        case "custom":
          if (!provider.config.endpoint) {
            return this.recordConnectionFailure(id, "Endpoint not configured");
          }
          break;

        default:
          return this.recordConnectionFailure(id, "Unsupported provider type");
      }

      const latency = Date.now() - startTime;
      this.lastConnectionErrors.delete(id);
      return { success: true, latency };
    } catch (error) {
      return this.recordConnectionFailure(id, error instanceof Error ? error.message : String(error));
    }
  }

  refreshProviderModels(id: string, models?: Model[], refreshedAt = new Date().toISOString()): AIProvider | null {
    const provider = this.providers.get(id);
    if (!provider) {
      return null;
    }

    const sourceModels = models ?? provider.models;
    const updated: AIProvider = normalizeProviderForSettings({
      ...provider,
      models: sourceModels.map((model) => normalizeModelForSettings(model, refreshedAt)),
    });

    this.providers.set(id, updated);
    this.syncProviderModels(id);
    return updated;
  }

  updateModel(providerId: string, modelId: string, updates: Partial<Model>): AIModel | null {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return null;
    }

    let updatedModel: AIModel | null = null;
    const updatedModels = provider.models.map((model) => {
      if (model.id !== modelId) return model;
      updatedModel = normalizeModelForSettings({ ...model, ...updates });
      return updatedModel;
    });

    if (!updatedModel) {
      return null;
    }

    const updatedProvider: AIProvider = normalizeProviderForSettings({
      ...provider,
      models: updatedModels,
    });
    this.providers.set(providerId, updatedProvider);
    this.syncProviderModels(providerId);
    return updatedModel;
  }

  async testModelConnection(providerId: string, modelId: string): Promise<{ success: boolean; error?: string; latency?: number; model?: AIModel }> {
    const provider = this.providers.get(providerId);
    const model = provider?.models.find((candidate) => candidate.id === modelId);
    if (!provider || !model) {
      return { success: false, error: "Model not found" };
    }

    const result = await this.testProviderConnection(providerId);
    const updatedModel = this.updateModel(providerId, modelId, result.success
      ? {
          lastTestStatus: "success",
          lastTestLatency: result.latency ?? 0,
          lastTestError: undefined,
        }
      : {
          lastTestStatus: "error",
          lastTestError: result.error ?? "Unknown error",
        });

    return {
      ...result,
      ...(updatedModel ? { model: updatedModel } : {}),
    };
  }

  /**
   * 添加自定义提供商
   */
  addProvider(provider: Omit<AIProvider, "priority">): AIProvider {
    const maxPriority = Math.max(...Array.from(this.providers.values()).map((p) => p.priority), 0);
    const newProvider: AIProvider = normalizeProviderForSettings({
      ...provider,
      config: { ...provider.config },
      models: provider.models.map((model) => normalizeModelForSettings(model)),
      priority: maxPriority + 1,
    });

    this.registerProvider(newProvider);
    return newProvider;
  }

  /**
   * 删除提供商
   */
  removeProvider(id: string): boolean {
    const provider = this.providers.get(id);
    if (!provider) {
      return false;
    }

    for (const model of provider.models) {
      this.models.delete(`${id}:${model.id}`);
    }

    this.providers.delete(id);
    return true;
  }

  /**
   * 获取模型信息
   */
  getModel(modelId: string): AIModel | undefined {
    return this.models.get(modelId);
  }

  /**
   * 解析模型 ID（provider:model 格式）
   */
  parseModelId(modelId: string): { providerId: string; modelName: string } | null {
    const parts = modelId.split(":");
    if (parts.length !== 2) {
      return null;
    }
    return { providerId: parts[0], modelName: parts[1] };
  }
}

// 全局提供商管理器实例
export const providerManager = new ProviderManager();

// 初始化默认提供商
providerManager.initialize();
