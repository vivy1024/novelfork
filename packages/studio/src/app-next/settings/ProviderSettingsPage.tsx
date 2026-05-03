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

interface ProviderRuntimeSummary {
  readonly providerCount: number;
  readonly enabledProviderCount: number;
  readonly physicalModelCount: number;
  readonly platformAccountCount?: number;
  readonly enabledPlatformAccountCount?: number;
  readonly issueCount: number;
}

interface GroupedModelInventory {
  readonly providerId: string;
  readonly providerName: string;
  readonly enabled: boolean;
  readonly health: string;
  readonly models: Array<Model & { readonly capabilities?: readonly string[] }>;
}

interface LocalProviderSummary {
  readonly platformCount: number;
  readonly enabledPlatformCount: number;
  readonly providerCount: number;
  readonly enabledProviderCount: number;
  readonly modelCount: number;
}

export interface ProviderSettingsClient {
  listPlatformIntegrations: () => Promise<{ integrations: PlatformIntegrationCatalogItem[] }>;
  listPlatformAccounts: (platformId: PlatformId) => Promise<{ accounts: PlatformAccount[] }>;
  importPlatformAccountJson: (platformId: PlatformId, payload: PlatformJsonImportPayload) => Promise<{ account: PlatformAccount }>;
  refreshPlatformAccountQuota: (platformId: PlatformId, accountId: string) => Promise<{ account: PlatformAccount }>;
  setCurrentPlatformAccount: (platformId: PlatformId, accountId: string) => Promise<{ account: PlatformAccount }>;
  updatePlatformAccountStatus: (platformId: PlatformId, accountId: string, status: PlatformAccount["status"]) => Promise<{ account: PlatformAccount }>;
  deletePlatformAccount: (platformId: PlatformId, accountId: string) => Promise<{ success: boolean }>;
  getProviderSummary?: () => Promise<{ summary: ProviderRuntimeSummary }>;
  listGroupedModels?: () => Promise<{ groups: GroupedModelInventory[] }>;
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
  refreshPlatformAccountQuota: (platformId, accountId) => fetchJson<{ account: PlatformAccount }>(`/platform-integrations/${platformId}/accounts/${accountId}/refresh-quota`, { method: "POST" }),
  setCurrentPlatformAccount: (platformId, accountId) => fetchJson<{ account: PlatformAccount }>(`/platform-integrations/${platformId}/accounts/${accountId}/set-current`, { method: "POST" }),
  updatePlatformAccountStatus: (platformId, accountId, status) => fetchJson<{ account: PlatformAccount }>(`/platform-integrations/${platformId}/accounts/${accountId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  }),
  deletePlatformAccount: (platformId, accountId) => fetchJson<{ success: boolean }>(`/platform-integrations/${platformId}/accounts/${accountId}`, { method: "DELETE" }),
  getProviderSummary: () => fetchJson<{ summary: ProviderRuntimeSummary }>("/providers/summary"),
  listGroupedModels: () => fetchJson<{ groups: GroupedModelInventory[] }>("/providers/models/grouped"),
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

function ControlCard({ label, value, detail }: { readonly label: string; readonly value: string | number; readonly detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

function RuntimeOverviewSection({ summary, fallback }: { readonly summary: ProviderRuntimeSummary | null; readonly fallback: LocalProviderSummary }) {
  const data = summary ?? {
    providerCount: fallback.providerCount,
    enabledProviderCount: fallback.enabledProviderCount,
    physicalModelCount: fallback.modelCount,
    platformAccountCount: fallback.platformCount,
    enabledPlatformAccountCount: fallback.enabledPlatformCount,
    issueCount: 0,
  };
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">运行态总览</h3>
        <p className="text-xs text-muted-foreground">按真实供应商、真实模型、平台账号和运行策略观察当前 Agent Runtime。</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ControlCard label="供应商" value={`${data.enabledProviderCount}/${data.providerCount}`} detail="已启用 / 总数" />
        <ControlCard label="物理模型" value={data.physicalModelCount} />
        <ControlCard label="异常项" value={data.issueCount} />
        <ControlCard label="平台账号" value={data.platformAccountCount ?? fallback.platformCount} detail={`${data.enabledPlatformAccountCount ?? fallback.enabledPlatformCount} 个平台可用`} />
      </div>
    </section>
  );
}

function ModelInventorySection({ groups }: { readonly groups: readonly GroupedModelInventory[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">模型库存</h3>
        <p className="text-xs text-muted-foreground">按真实供应商分组展示物理模型、健康状态和能力标签。</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.providerId} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">{group.providerName}</div>
              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{group.health}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {group.models.slice(0, 6).map((model) => <span key={model.id} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{model.name}</span>)}
              {group.models.length === 0 && <span className="text-xs text-muted-foreground">没有模型，请先刷新供应商模型列表。</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RuntimePolicySection() {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">运行策略</h3>
        <p className="text-xs text-muted-foreground">当前运行时使用真实模型显式选择、能力校验、权限模式和工具支持状态，不自动切换模型。</p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <ControlCard label="显式模型选择" value="已接入" detail="providerId + modelId" />
        <ControlCard label="能力校验" value="已接入" detail="tools / vision / streaming" />
        <ControlCard label="权限模式" value="已接入" detail="read / plan / edit / allow" />
        <ControlCard label="上下文窗口" value="已接入" detail="模型库存维护" />
      </div>
    </section>
  );
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
  const [providerRuntimeSummary, setProviderRuntimeSummary] = useState<ProviderRuntimeSummary | null>(null);
  const [groupedModels, setGroupedModels] = useState<GroupedModelInventory[]>([]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    async function load() {
      const [
        { integrations },
        { providers: nextProviders },
        runtimeSummaryResult,
        groupedModelsResult,
      ] = await Promise.all([
        client.listPlatformIntegrations(),
        client.listProviders(),
        client.getProviderSummary?.().catch(() => null) ?? Promise.resolve(null),
        client.listGroupedModels?.().catch(() => null) ?? Promise.resolve(null),
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
      setProviderRuntimeSummary(runtimeSummaryResult?.summary ?? null);
      setGroupedModels(groupedModelsResult?.groups ?? nextProviders.map((provider) => ({
        providerId: provider.id,
        providerName: provider.name,
        enabled: provider.enabled,
        health: provider.enabled ? "可用" : "已停用",
        models: provider.models,
      })));
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
        refreshAccountQuota={client.refreshPlatformAccountQuota}
        setCurrentAccount={client.setCurrentPlatformAccount}
        updateAccountStatus={client.updatePlatformAccountStatus}
        deleteAccount={client.deletePlatformAccount}
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

      <RuntimeOverviewSection summary={providerRuntimeSummary} fallback={summary} />

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

      <ModelInventorySection groups={groupedModels} />
      <RuntimePolicySection />
    </section>
  );
}
