/**
 * API 供应商管理标签页
 */

import { useState, useEffect } from "react";
import { Server, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";
import { fetchJson } from "../../hooks/use-api";

interface Provider {
  id: string;
  name: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
  models: string[];
  enabled: boolean;
  priority: number;
}

export function ProvidersTab() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      const data = await fetchJson<{ providers: Provider[] }>("/api/admin/providers");
      setProviders(data.providers);
    } catch (error) {
      console.error("Failed to load providers:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleProvider = async (id: string, enabled: boolean) => {
    try {
      await fetchJson(`/api/providers/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await loadProviders();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to toggle provider");
    }
  };

  const testConnection = async (id: string) => {
    try {
      const result = await fetchJson<{ success: boolean; latency?: number; error?: string }>(
        `/api/providers/${id}/test`,
        { method: "POST" }
      );
      if (result.success) {
        alert(`连接成功！延迟: ${result.latency}ms`);
      } else {
        alert(`连接失败: ${result.error}`);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to test connection");
    }
  };

  const maskApiKey = (key?: string) => {
    if (!key) return "未配置";
    if (key.length <= 8) return "***";
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-600 dark:text-gray-400">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">API 供应商列表</h2>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          共 {providers.length} 个供应商，{providers.filter((p) => p.enabled).length} 个已启用
        </div>
      </div>

      <div className="grid gap-4">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded">
                  <Server size={24} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{provider.name}</h3>
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                      {provider.type}
                    </span>
                    {provider.enabled ? (
                      <CheckCircle size={16} className="text-green-500" />
                    ) : (
                      <XCircle size={16} className="text-gray-400" />
                    )}
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">API Key:</span>
                      <span className="font-mono">
                        {showKeys[provider.id] ? provider.apiKey || "未配置" : maskApiKey(provider.apiKey)}
                      </span>
                      <button
                        onClick={() => setShowKeys({ ...showKeys, [provider.id]: !showKeys[provider.id] })}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      >
                        {showKeys[provider.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    {provider.baseUrl && (
                      <div>
                        <span className="font-medium">Base URL:</span> {provider.baseUrl}
                      </div>
                    )}
                    <div>
                      <span className="font-medium">模型:</span>{" "}
                      {provider.models.length > 0 ? provider.models.join(", ") : "无"}
                    </div>
                    <div>
                      <span className="font-medium">优先级:</span> {provider.priority}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => toggleProvider(provider.id, !provider.enabled)}
                  className={`px-4 py-2 rounded text-sm font-medium ${
                    provider.enabled
                      ? "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                      : "bg-green-500 text-white hover:bg-green-600"
                  }`}
                >
                  {provider.enabled ? "禁用" : "启用"}
                </button>
                <button
                  onClick={() => testConnection(provider.id)}
                  className="px-4 py-2 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600"
                >
                  测试连接
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {providers.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <Server size={48} className="mx-auto mb-4 opacity-50" />
          <p>暂无 API 供应商</p>
        </div>
      )}
    </div>
  );
}
