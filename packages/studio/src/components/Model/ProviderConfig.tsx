import React, { useState, useEffect } from "react";
import { Trash2, Plus, Check, X } from "lucide-react";
import { PROVIDERS, Provider, getProvider } from "../../api/lib/providers";
import { openDB, IDBPDatabase } from "idb";

interface ProviderConfigProps {
  theme: "light" | "dark";
}

interface StoredProvider {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
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

async function loadAllProviders(): Promise<StoredProvider[]> {
  try {
    const db = await getDB();
    const keys = await db.getAllKeys(STORE_NAME);
    const providers: StoredProvider[] = [];

    for (const key of keys) {
      if (typeof key === "string" && key !== "selected") {
        const config = await db.get(STORE_NAME, key);
        const provider = getProvider(key);
        if (provider) {
          providers.push({
            id: key,
            name: provider.name,
            apiKey: config?.apiKey,
            baseUrl: config?.baseUrl,
            enabled: config?.enabled !== false,
          });
        }
      }
    }

    return providers;
  } catch {
    return [];
  }
}

async function saveProvider(provider: StoredProvider): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, provider, provider.id);
  } catch (e) {
    console.error("Failed to save provider:", e);
  }
}

async function deleteProvider(providerId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, providerId);
  } catch (e) {
    console.error("Failed to delete provider:", e);
  }
}

export const ProviderConfig = React.memo(function ProviderConfig({ theme }: ProviderConfigProps) {
  const [providers, setProviders] = useState<StoredProvider[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<StoredProvider>>({});

  useEffect(() => {
    loadAllProviders().then(setProviders);
  }, []);

  const handleAdd = (providerId: string) => {
    const provider = getProvider(providerId);
    if (!provider) return;

    const newProvider: StoredProvider = {
      id: providerId,
      name: provider.name,
      enabled: true,
    };

    setEditingId(providerId);
    setEditForm(newProvider);
  };

  const handleSave = async () => {
    if (!editingId || !editForm.id) return;

    const provider: StoredProvider = {
      id: editForm.id,
      name: editForm.name || "",
      apiKey: editForm.apiKey,
      baseUrl: editForm.baseUrl,
      enabled: editForm.enabled !== false,
    };

    await saveProvider(provider);

    setProviders((prev) => {
      const existing = prev.find((p) => p.id === provider.id);
      if (existing) {
        return prev.map((p) => (p.id === provider.id ? provider : p));
      }
      return [...prev, provider];
    });

    setEditingId(null);
    setEditForm({});
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleDelete = async (providerId: string) => {
    if (!confirm(`确定删除 ${providerId} 配置？`)) return;

    await deleteProvider(providerId);
    setProviders((prev) => prev.filter((p) => p.id !== providerId));
  };

  const handleToggle = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;

    const updated = { ...provider, enabled: !provider.enabled };
    await saveProvider(updated);
    setProviders((prev) => prev.map((p) => (p.id === providerId ? updated : p)));
  };

  const availableProviders = PROVIDERS.filter(
    (p) => p.id !== "custom" && !providers.some((sp) => sp.id === p.id)
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">供应商配置</h3>
        <p className="text-sm text-muted-foreground">
          管理 AI 供应商的 API Key 和端点配置
        </p>
      </div>

      {/* 已配置的供应商 */}
      <div className="space-y-3">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="p-4 rounded-lg border border-border bg-background/50"
          >
            {editingId === provider.id ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={editForm.apiKey || ""}
                    onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm rounded border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="输入 API Key..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Base URL（可选）
                  </label>
                  <input
                    type="text"
                    value={editForm.baseUrl || ""}
                    onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm rounded border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="自定义端点..."
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Check className="w-3 h-3" />
                    保存
                  </button>
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary"
                  >
                    <X className="w-3 h-3" />
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={() => handleToggle(provider.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                  </label>
                  <div>
                    <div className="text-sm font-medium text-foreground">{provider.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {provider.apiKey ? "已配置 API Key" : "未配置"}
                      {provider.baseUrl && " · 自定义端点"}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingId(provider.id);
                      setEditForm(provider);
                    }}
                    className="px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(provider.id)}
                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 添加新供应商 */}
      {availableProviders.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            添加供应商
          </label>
          <div className="flex gap-2">
            {availableProviders.map((provider) => (
              <button
                key={provider.id}
                onClick={() => handleAdd(provider.id)}
                className="flex items-center gap-1 px-3 py-2 text-sm rounded border border-border hover:bg-secondary"
              >
                <Plus className="w-4 h-4" />
                {provider.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {providers.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          暂无配置的供应商，点击上方按钮添加
        </div>
      )}
    </div>
  );
});
