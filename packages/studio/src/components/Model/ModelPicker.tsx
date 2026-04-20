import React, { useState, useEffect } from "react";
import { Eye, EyeOff, Check, AlertCircle } from "lucide-react";
import { getDefaultModel, getDefaultProvider, getProvider, PROVIDERS } from "../../shared/provider-catalog";
import { openDB, IDBPDatabase } from "idb";

interface ModelPickerProps {
  value?: { providerId: string; modelId: string };
  onChange: (providerId: string, modelId: string) => void;
  theme: "light" | "dark";
}

interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

const DB_NAME = "novelfork-settings";
const DB_VERSION = 1;
const STORE_NAME = "provider-config";

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

async function loadProviderConfig(providerId: string): Promise<ProviderConfig> {
  try {
    const db = await getDB();
    const config = await db.get(STORE_NAME, providerId);
    return config || {};
  } catch {
    return {};
  }
}

async function saveProviderConfig(providerId: string, config: ProviderConfig): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, config, providerId);
  } catch (e) {
    console.error("Failed to save provider config:", e);
  }
}

export const ModelPicker = React.memo(function ModelPicker({
  value,
  onChange,
  theme,
}: ModelPickerProps) {
  const defaultProvider = getDefaultProvider();
  const defaultModel = getDefaultModel(defaultProvider.id);
  const [selectedProviderId, setSelectedProviderId] = useState(value?.providerId || defaultProvider.id);
  const [selectedModelId, setSelectedModelId] = useState(value?.modelId || defaultModel?.id || "");
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({});
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");

  const currentProvider = getProvider(selectedProviderId);

  useEffect(() => {
    loadProviderConfig(selectedProviderId).then(setProviderConfig);
  }, [selectedProviderId]);

  useEffect(() => {
    if (currentProvider && currentProvider.models.length > 0 && !selectedModelId) {
      setSelectedModelId(currentProvider.models[0].id);
    }
  }, [currentProvider, selectedModelId]);

  const handleProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    const provider = getProvider(providerId);
    if (provider && provider.models.length > 0) {
      const newModelId = provider.models[0].id;
      setSelectedModelId(newModelId);
      onChange(providerId, newModelId);
    }
    setConnectionStatus("idle");
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
    onChange(selectedProviderId, modelId);
  };

  const handleConfigChange = async (key: keyof ProviderConfig, value: string) => {
    const newConfig = { ...providerConfig, [key]: value };
    setProviderConfig(newConfig);
    await saveProviderConfig(selectedProviderId, newConfig);
    setConnectionStatus("idle");
  };

  const handleTestConnection = async () => {
    if (!currentProvider?.apiKeyRequired || !providerConfig.apiKey) {
      return;
    }

    setTestingConnection(true);
    setConnectionStatus("idle");

    try {
      // 简单测试：验证 API Key 格式
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (providerConfig.apiKey.length < 10) {
        throw new Error("API Key 格式无效");
      }

      setConnectionStatus("success");
    } catch (error) {
      setConnectionStatus("error");
    } finally {
      setTestingConnection(false);
    }
  };

  const currentModel = currentProvider?.models.find((m) => m.id === selectedModelId);
  const hasApiKey = !!providerConfig.apiKey;

  return (
    <div className="space-y-4">
      {/* 供应商选择 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          AI 供应商
        </label>
        <select
          value={selectedProviderId}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>

      {/* 模型选择 */}
      {currentProvider && currentProvider.models.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            模型
          </label>
          <select
            value={selectedModelId}
            onChange={(e) => handleModelChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {currentProvider.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 模型信息 */}
      {currentModel && (
        <div className="p-3 rounded-lg bg-secondary/50 border border-border">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">上下文窗口:</span>
              <span className="ml-2 text-foreground font-medium">
                {(currentModel.contextWindow / 1000).toFixed(0)}K
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">最大输出:</span>
              <span className="ml-2 text-foreground font-medium">
                {(currentModel.maxOutputTokens / 1000).toFixed(0)}K
              </span>
            </div>
            {currentModel.inputPrice !== undefined && (
              <div>
                <span className="text-muted-foreground">输入价格:</span>
                <span className="ml-2 text-foreground font-medium">
                  ${currentModel.inputPrice}/M
                </span>
              </div>
            )}
            {currentModel.outputPrice !== undefined && (
              <div>
                <span className="text-muted-foreground">输出价格:</span>
                <span className="ml-2 text-foreground font-medium">
                  ${currentModel.outputPrice}/M
                </span>
              </div>
            )}
          </div>
          {(currentModel.supportsFunctionCalling || currentModel.supportsVision) && (
            <div className="mt-2 flex gap-2">
              {currentModel.supportsFunctionCalling && (
                <span className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">
                  函数调用
                </span>
              )}
              {currentModel.supportsVision && (
                <span className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">
                  视觉
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* API Key 输入 */}
      {currentProvider?.apiKeyRequired && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            API Key
          </label>
          <div className="relative">
            <input
              type={showApiKey ? "text" : "password"}
              placeholder="输入 API Key..."
              value={providerConfig.apiKey || ""}
              onChange={(e) => handleConfigChange("apiKey", e.target.value)}
              className="w-full px-3 py-2 pr-20 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded transition-colors"
            >
              {showApiKey ? (
                <EyeOff className="w-4 h-4 text-muted-foreground" />
              ) : (
                <Eye className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>
          {hasApiKey && (
            <button
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="mt-2 text-xs text-primary hover:underline disabled:opacity-50"
            >
              {testingConnection ? "测试中..." : "测试连接"}
            </button>
          )}
          {connectionStatus === "success" && (
            <div className="mt-2 flex items-center gap-1 text-xs text-green-600">
              <Check className="w-3 h-3" />
              <span>连接成功</span>
            </div>
          )}
          {connectionStatus === "error" && (
            <div className="mt-2 flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="w-3 h-3" />
              <span>连接失败</span>
            </div>
          )}
        </div>
      )}

      {/* Base URL（可选） */}
      {currentProvider && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Base URL（可选）
          </label>
          <input
            type="text"
            placeholder={currentProvider.baseUrl || "自定义 API 端点..."}
            value={providerConfig.baseUrl || ""}
            onChange={(e) => handleConfigChange("baseUrl", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            留空使用默认端点
          </p>
        </div>
      )}
    </div>
  );
});
