/**
 * AI 提供商管理服务
 * 统一管理多个 AI 提供商（Anthropic、OpenAI）
 */

export interface AIProvider {
  id: string;
  name: string;
  type: "anthropic" | "openai";
  enabled: boolean;
  priority: number; // 排序优先级，数字越小越优先
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

class ProviderManager {
  private providers: Map<string, AIProvider> = new Map();
  private models: Map<string, AIModel> = new Map();

  /**
   * 初始化默认提供商
   */
  initialize(): void {
    // 默认提供商配置
    const defaultProviders: AIProvider[] = [
      {
        id: "anthropic-official",
        name: "Anthropic Official",
        type: "anthropic",
        enabled: true,
        priority: 1,
        config: {},
        models: [
          {
            id: "claude-opus-4",
            name: "Claude Opus 4",
            providerId: "anthropic-official",
            contextWindow: 200000,
            maxOutputTokens: 16384,
            supportsFunctionCalling: true,
            supportsStreaming: true,
          },
          {
            id: "claude-sonnet-4",
            name: "Claude Sonnet 4",
            providerId: "anthropic-official",
            contextWindow: 200000,
            maxOutputTokens: 16384,
            supportsFunctionCalling: true,
            supportsStreaming: true,
          },
        ],
      },
      {
        id: "openai-official",
        name: "OpenAI Official",
        type: "openai",
        enabled: true,
        priority: 2,
        config: {},
        models: [
          {
            id: "gpt-4-turbo",
            name: "GPT-4 Turbo",
            providerId: "openai-official",
            contextWindow: 128000,
            maxOutputTokens: 4096,
            supportsFunctionCalling: true,
            supportsStreaming: true,
          },
          {
            id: "gpt-4o",
            name: "GPT-4o",
            providerId: "openai-official",
            contextWindow: 128000,
            maxOutputTokens: 16384,
            supportsFunctionCalling: true,
            supportsStreaming: true,
          },
        ],
      },
    ];

    for (const provider of defaultProviders) {
      this.providers.set(provider.id, provider);
      for (const model of provider.models) {
        this.models.set(`${provider.id}:${model.id}`, model);
      }
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

    const updated = { ...provider, ...updates };
    this.providers.set(id, updated);
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

    provider.enabled = enabled;
    return true;
  }

  /**
   * 重新排序提供商
   */
  reorderProviders(orderedIds: string[]): boolean {
    // 验证所有 ID 都存在
    for (const id of orderedIds) {
      if (!this.providers.has(id)) {
        return false;
      }
    }

    // 更新优先级
    orderedIds.forEach((id, index) => {
      const provider = this.providers.get(id);
      if (provider) {
        provider.priority = index + 1;
      }
    });

    return true;
  }

  /**
   * 获取模型池（所有可用模型）
   */
  getModelPool(): ModelPoolEntry[] {
    const pool: ModelPoolEntry[] = [];

    for (const provider of this.providers.values()) {
      for (const model of provider.models) {
        pool.push({
          modelId: `${provider.id}:${model.id}`,
          modelName: model.name,
          providerId: provider.id,
          providerName: provider.name,
          enabled: provider.enabled,
        });
      }
    }

    return pool.sort((a, b) => {
      const providerA = this.providers.get(a.providerId);
      const providerB = this.providers.get(b.providerId);
      return (providerA?.priority || 999) - (providerB?.priority || 999);
    });
  }

  /**
   * 测试提供商连通性
   */
  async testProviderConnection(id: string): Promise<{ success: boolean; error?: string; latency?: number }> {
    const provider = this.providers.get(id);
    if (!provider) {
      return { success: false, error: "Provider not found" };
    }

    const startTime = Date.now();

    try {
      // 根据提供商类型执行不同的测试
      switch (provider.type) {
        case "anthropic":
          // 测试 Anthropic API
          if (!provider.config.apiKey) {
            return { success: false, error: "API key not configured" };
          }
          // TODO: 实际调用 API 测试
          break;

        case "openai":
          // 测试 OpenAI API
          if (!provider.config.apiKey) {
            return { success: false, error: "API key not configured" };
          }
          // TODO: 实际调用 API 测试
          break;

        default:
          return { success: false, error: "Unsupported provider type" };
      }

      const latency = Date.now() - startTime;
      return { success: true, latency };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 添加自定义提供商
   */
  addProvider(provider: Omit<AIProvider, "priority">): AIProvider {
    const maxPriority = Math.max(...Array.from(this.providers.values()).map((p) => p.priority), 0);
    const newProvider: AIProvider = {
      ...provider,
      priority: maxPriority + 1,
    };

    this.providers.set(newProvider.id, newProvider);

    // 注册模型
    for (const model of newProvider.models) {
      this.models.set(`${newProvider.id}:${model.id}`, model);
    }

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

    // 删除关联的模型
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
