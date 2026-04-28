import { useEffect, useMemo, useState } from "react";

import { fetchJson } from "@/hooks/use-api";
import type {
  ManagedProvider,
  Model,
  ProviderCompatibility,
  ProviderType,
} from "@/shared/provider-catalog";
import { ApiProviderDetail } from "./providers/ApiProviderDetail";
import { ApiProvidersSection, type ProviderFormState } from "./providers/ApiProvidersSection";
import { PlatformIntegrationDetail } from "./providers/PlatformIntegrationDetail";
import { PlatformIntegrationsSection } from "./providers/PlatformIntegrationsSection";
import type {
  PlatformAccount,
  PlatformId,
  PlatformIntegrationCatalogItem,
  PlatformJsonImportPayload,
} from "./provider-types";

export interface ProviderSettingsClient {
  listPlatformIntegrations: () => Promise<{ integrations: PlatformIntegrationCatalogItem[] }>;
  listPlatformAccounts: (platformId: PlatformId) => Promise<{ accounts: PlatformAccount[] }>;
  importPlatformAccountJson: (platformId: PlatformId, payload: PlatformJsonImportPayload) => Promise<{ account: PlatformAccount }>;
  listProviders: () => Promise<{ providers: ManagedProvider[] }>;
  createProvider: (provider: Omit<ManagedProvider, "priority">) => Promise<{ provider: ManagedProvider }>;
  updateProvider: (providerId: string, updates: Partial<ManagedProvider>) => Promise<{ provider: ManagedProvider }>;
  refreshModels: (providerId: string) => Promise<{ provider: ManagedProvider; models?: Model[] }>;
  testModel: (providerId: string, modelId: string) => Promise<{ success: boolean; latency?: number; error?: string; model?: Model }>;
  updateModel: (providerId: string, modelId: string, updates: Partial<Model>) => Promise<{ model: Model }>;
}

const defaultClient: ProviderSettingsClient = {
  listPlatformIntegrations: () => fetchJson<{ integrations: PlatformIntegrationCatalogItem[] }>("/platform-integrations"),
  listPlatformAccounts: (platformId) => fetchJson<{ accounts: PlatformAccount[] }>(`/platform-integrations/${platformId}/accounts`),
  importPlatformAccountJson: (platformId, payload) => fetchJson<{ account: PlatformAccount }>(`/platform-integrations/${platformId}/accounts/import-json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),
  listProviders: () => fetchJson<{ providers: ManagedProvider[] }>("/providers"),
  createProvider: (provider) => fetchJson<{ provider: ManagedProvider }>("/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(provider),
  }),
  updateProvider: (providerId, updates) => fetchJson<{ provider: ManagedProvider }>(`/providers/${providerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  }),
  refreshModels: (providerId) => fetchJson<{ provider: ManagedProvider; models?: Model[] }>(`/providers/${providerId}/models/refresh`, {
    method: "POST",
  }),
  testModel: (providerId, modelId) => fetchJson<{ success: boolean; latency?: number; error?: string; model?: Model }>(
    `/providers/${providerId}/models/${modelId}/test`,
    { method: "POST" },
  ),
  updateModel: (providerId, modelId, updates) => fetchJson<{ model: Model }>(`/providers/${providerId}/models/${modelId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  }),
};

interface ProviderSettingsPageProps {
  readonly client?: ProviderSettingsClient;
}

const INITIAL_FORM: ProviderFormState = {
  name: "",
  prefix: "",
  apiKey: "",
  baseUrl: "",
  apiMode: "completions",
  compatibility: "openai-compatible",
};

const EMPTY_ACCOUNT_COUNTS: Record<PlatformId, number> = {
  codex: 0,
  kiro: 0,
  cline: 0,
};

function providerTypeFromCompatibility(compatibility: ProviderCompatibility): ProviderType {
  return compatibility === "anthropic-compatible" ? "anthropic" : "custom";
}

function normalizeProviderId(prefix: string, name: string): string {
  const raw = (prefix || name || "custom-provider").trim().toLowerCase();
  return raw.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "custom-provider";
}

function applyProvider(providers: ManagedProvider[], provider: ManagedProvider): ManagedProvider[] {
  const exists = providers.some((candidate) => candidate.id === provider.id);
  return exists
    ? providers.map((candidate) => (candidate.id === provider.id ? provider : candidate))
    : [...providers, provider];
}

function applyModel(providers: ManagedProvider[], providerId: string, model: Model): ManagedProvider[] {
  return providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    return {
      ...provider,
      models: provider.models.map((candidate) => (candidate.id === model.id ? model : candidate)),
    };
  });
}

function buildContextDrafts(providers: readonly ManagedProvider[]): Record<string, string> {
  return Object.fromEntries(providers.flatMap((provider) => provider.models.map((model) => [`${provider.id}:${model.id}`, String(model.contextWindow)])));
}

export function ProviderSettingsPage({ client = defaultClient }: ProviderSettingsPageProps) {
  const [providers, setProviders] = useState<ManagedProvider[]>([]);
  const [platformIntegrations, setPlatformIntegrations] = useState<PlatformIntegrationCatalogItem[]>([]);
  const [platformAccountCounts, setPlatformAccountCounts] = useState<Record<PlatformId, number>>(EMPTY_ACCOUNT_COUNTS);
  const [selectedPlatformId, setSelectedPlatformId] = useState<PlatformId | null>(null);
  const [selectedApiProviderId, setSelectedApiProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormState>(INITIAL_FORM);
  const [showAddForm, setShowAddForm] = useState(false);
  const [contextDrafts, setContextDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    async function load() {
      const [{ integrations }, { providers: nextProviders }] = await Promise.all([
        client.listPlatformIntegrations(),
        client.listProviders(),
      ]);

      const accountResults = await Promise.all(integrations.map(async (integration) => {
        try {
          const result = await client.listPlatformAccounts(integration.id);
          return [integration.id, result.accounts.length] as const;
        } catch {
          return [integration.id, 0] as const;
        }
      }));

      if (!mounted) return;
      setPlatformIntegrations(integrations);
      setPlatformAccountCounts({ ...EMPTY_ACCOUNT_COUNTS, ...Object.fromEntries(accountResults) });
      setProviders(nextProviders);
      setContextDrafts(buildContextDrafts(nextProviders));
    }

    load()
      .catch((reason) => {
        if (!mounted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [client]);

  const summary = useMemo(() => {
    return {
      platformCount: platformIntegrations.length,
      enabledPlatformCount: platformIntegrations.filter((integration) => integration.enabled).length,
      providerCount: providers.length,
      enabledProviderCount: providers.filter((provider) => provider.enabled).length,
      modelCount: providers.reduce((total, provider) => total + provider.models.filter((model) => model.enabled !== false).length, 0),
    };
  }, [platformIntegrations, providers]);

  const selectedPlatform = platformIntegrations.find((integration) => integration.id === selectedPlatformId) ?? null;
  const selectedApiProvider = providers.find((provider) => provider.id === selectedApiProviderId) ?? null;

  const saveProvider = async () => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.apiKey.trim()) return;

    const id = normalizeProviderId(form.prefix, form.name);
    setBusy("create-provider");
    setError(null);
    try {
      const result = await client.createProvider({
        id,
        name: form.name.trim(),
        type: providerTypeFromCompatibility(form.compatibility),
        enabled: true,
        apiKeyRequired: true,
        baseUrl: form.baseUrl.trim(),
        prefix: form.prefix.trim() || id,
        compatibility: form.compatibility,
        apiMode: form.apiMode,
        config: { apiKey: form.apiKey.trim() },
        models: [],
      });
      setProviders((current) => applyProvider(current, result.provider));
      setSelectedApiProviderId(result.provider.id);
      setFeedback("供应商已保存，可继续刷新模型列表。");
      setForm(INITIAL_FORM);
      setShowAddForm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const updateProvider = async (providerId: string, updates: Partial<ManagedProvider>) => {
    setBusy(`provider:${providerId}`);
    setError(null);
    try {
      const result = await client.updateProvider(providerId, updates);
      setProviders((current) => applyProvider(current, result.provider));
      setFeedback("API 接入信息已更新。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const refreshModels = async (providerId: string) => {
    setBusy(`refresh:${providerId}`);
    setError(null);
    try {
      const result = await client.refreshModels(providerId);
      setProviders((current) => applyProvider(current, result.provider));
      setContextDrafts((current) => ({
        ...current,
        ...Object.fromEntries(result.provider.models.map((model) => [`${providerId}:${model.id}`, String(model.contextWindow)])),
      }));
      setFeedback(`已刷新模型列表：${result.provider.models.length} 个模型。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const testModel = async (providerId: string, modelId: string) => {
    setBusy(`test:${providerId}:${modelId}`);
    setError(null);
    try {
      const result = await client.testModel(providerId, modelId);
      if (result.model) {
        setProviders((current) => applyModel(current, providerId, result.model as Model));
      }
      setFeedback(result.success ? `模型测试成功，延迟 ${result.latency ?? "--"}ms。` : `模型测试失败：${result.error ?? "未知错误"}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const updateModel = async (providerId: string, model: Model, updates: Partial<Model>) => {
    setBusy(`model:${providerId}:${model.id}`);
    setError(null);
    try {
      const result = await client.updateModel(providerId, model.id, updates);
      setProviders((current) => applyModel(current, providerId, result.model));
      setFeedback("模型设置已更新。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const toggleProvider = async (providerId: string, enabled: boolean) => {
    setProviders((current) => current.map((provider) => provider.id === providerId ? { ...provider, enabled } : provider));
    try {
      await fetchJson(`/providers/${providerId}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    } catch {
      setProviders((current) => current.map((provider) => provider.id === providerId ? { ...provider, enabled: !enabled } : provider));
    }
  };

  const handlePlatformAccountImported = (platformId: PlatformId) => {
    setPlatformAccountCounts((current) => ({ ...current, [platformId]: (current[platformId] ?? 0) + 1 }));
  };

  if (loading) {
    return <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">正在加载 AI 供应商…</div>;
  }

  if (selectedPlatform) {
    return (
      <PlatformIntegrationDetail
        integration={selectedPlatform}
        onBack={() => setSelectedPlatformId(null)}
        listAccounts={client.listPlatformAccounts}
        importJsonAccount={client.importPlatformAccountJson}
        onAccountImported={handlePlatformAccountImported}
      />
    );
  }

  if (selectedApiProvider) {
    return (
      <ApiProviderDetail
        provider={selectedApiProvider}
        busy={busy}
        feedback={feedback}
        error={error}
        contextDrafts={contextDrafts}
        setContextDrafts={setContextDrafts}
        onBack={() => setSelectedApiProviderId(null)}
        onRefreshModels={refreshModels}
        onTestModel={testModel}
        onUpdateModel={updateModel}
        onUpdateProvider={updateProvider}
      />
    );
  }

  return (
    <section aria-label="AI 供应商设置" className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">AI 供应商</h2>
        <p className="text-sm text-muted-foreground">
          {summary.platformCount} 平台集成（{summary.enabledPlatformCount} 已启用） · {summary.providerCount} API key 供应商（{summary.enabledProviderCount} 已启用） · {summary.modelCount} 可用模型
        </p>
      </div>

      {(feedback || error) && (
        <div className={error ? "rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" : "rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"}>
          {error ?? feedback}
        </div>
      )}

      <PlatformIntegrationsSection
        integrations={platformIntegrations}
        accountCounts={platformAccountCounts}
        onSelect={setSelectedPlatformId}
      />

      <ApiProvidersSection
        providers={providers}
        showAddForm={showAddForm}
        form={form}
        busy={busy}
        setForm={setForm}
        onToggleAddForm={() => setShowAddForm((current) => !current)}
        onSaveProvider={() => void saveProvider()}
        onSelectProvider={setSelectedApiProviderId}
        onToggleProvider={toggleProvider}
      />
    </section>
  );
}
