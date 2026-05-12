import { useEffect, useMemo, useState } from "react";

import { fetchJson } from "@/hooks/use-api";
import { Input } from "@/components/ui/input";
import type {
  ManagedProvider,
  Model,
  ProviderCompatibility,
  ProviderProtocol,
  ProviderType,
} from "@/shared/provider-catalog";
import { inferProtocol } from "@/shared/provider-catalog";
import { ApiProviderDetail } from "./providers/ApiProviderDetail";
import { ApiProvidersSection, type ApiProviderStatusSummary, type ProviderFormState } from "./providers/ApiProvidersSection";
import { deriveProviderFixtureFacts } from "./SettingsTruthModel";

interface ProviderRuntimeSummary {
  readonly providerCount: number;
  readonly enabledProviderCount: number;
  readonly physicalModelCount: number;
  readonly availableModelCount?: number;
  readonly totalCatalogModelCount?: number;
  readonly callableModelCount?: number;
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
  readonly providerCount: number;
  readonly enabledProviderCount: number;
  readonly modelCount: number;
}

export interface ProviderSettingsClient {
  getProviderSummary?: () => Promise<{ summary: ProviderRuntimeSummary }>;
  listGroupedModels?: () => Promise<{ groups: GroupedModelInventory[] }>;
  listProviders: () => Promise<{ providers: ManagedProvider[] }>;
  createProvider: (provider: Omit<ManagedProvider, "priority">) => Promise<{ provider: ManagedProvider }>;
  updateProvider: (providerId: string, updates: Partial<ManagedProvider>) => Promise<{ provider: ManagedProvider }>;
  deleteProvider: (providerId: string) => Promise<{ success: boolean }>;
  refreshModels: (providerId: string) => Promise<{ provider: ManagedProvider; models?: Model[] }>;
  testModel: (providerId: string, modelId: string) => Promise<{ success: boolean; latency?: number; error?: string; model?: Model }>;
  updateModel: (providerId: string, modelId: string, updates: Partial<Model>) => Promise<{ model: Model }>;
}

const defaultClient: ProviderSettingsClient = {
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
  deleteProvider: (providerId) => fetchJson<{ success: boolean }>(`/providers/${providerId}`, { method: "DELETE" }),
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
  apiMode: "responses",
  compatibility: "openai-compatible",
  protocol: "completions",
};

function providerTypeFromCompatibility(compatibility: ProviderCompatibility): ProviderType {
  return compatibility === "anthropic-compatible" ? "anthropic" : "custom";
}

function protocolToCompatibility(protocol: ProviderProtocol): ProviderCompatibility {
  return protocol === "anthropic" || protocol === "claude-code" ? "anthropic-compatible" : "openai-compatible";
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

function modelIsCallable(model: Model): boolean {
  return model.enabled !== false && model.lastTestStatus !== "error" && model.lastTestStatus !== "unsupported";
}

function providerHasApiKey(provider: ManagedProvider): boolean {
  return !provider.apiKeyRequired || Boolean(provider.config.apiKey || (provider.config as { apiKeyConfigured?: unknown }).apiKeyConfigured);
}

function providerStatus(provider: ManagedProvider): ApiProviderStatusSummary {
  const reasons: string[] = [];
  const enabledModels = provider.models.filter((model) => model.enabled !== false);
  const configured = Boolean(provider.baseUrl?.trim()) && providerHasApiKey(provider);
  const verified = enabledModels.some((model) => model.lastTestStatus === "success");
  const callableModelCount = provider.enabled && configured && verified ? enabledModels.filter(modelIsCallable).length : 0;

  if (!provider.enabled) reasons.push("已停用");
  if (!provider.baseUrl?.trim()) reasons.push("缺少 Base URL");
  if (!providerHasApiKey(provider)) reasons.push("缺少 API Key");
  if (enabledModels.length === 0) reasons.push("0 个模型");
  if (enabledModels.some((model) => model.lastTestStatus === "error")) reasons.push("测试失败");
  if (!verified) reasons.push("未验证");

  return {
    status: reasons.includes("测试失败") ? "error" : callableModelCount > 0 && verified ? "callable" : "degraded",
    catalogEnabled: true,
    configured,
    verified,
    reasons: callableModelCount > 0 && verified ? ["可调用"] : [...new Set(reasons)],
    callableModelCount,
  };
}

function providerMatchesQuery(provider: ManagedProvider, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    provider.id,
    provider.name,
    provider.prefix,
    provider.baseUrl,
    provider.compatibility,
    provider.apiMode,
    ...provider.models.flatMap((model) => [model.id, model.name]),
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(normalized);
}

function providerHasIssue(status: ApiProviderStatusSummary, isFixture: boolean): boolean {
  return isFixture || status.status !== "callable" || status.reasons.some((reason) => reason !== "可调用");
}

function RuntimeOverviewSection({ summary, fallback }: { readonly summary: ProviderRuntimeSummary | null; readonly fallback: LocalProviderSummary }) {
  const data = summary ?? {
    providerCount: fallback.providerCount,
    enabledProviderCount: fallback.enabledProviderCount,
    physicalModelCount: fallback.modelCount,
    availableModelCount: fallback.modelCount,
    totalCatalogModelCount: fallback.modelCount,
    callableModelCount: 0,
    issueCount: 0,
  };
  const availableModelCount = data.availableModelCount ?? data.physicalModelCount;
  const totalCatalogModelCount = data.totalCatalogModelCount ?? data.physicalModelCount;
  const callableModelCount = data.callableModelCount ?? 0;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">运行态总览</h3>
        <p className="text-xs text-muted-foreground">当前 AI 供应商和模型的运行状态。</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ControlCard label="供应商" value={`${data.enabledProviderCount}/${data.providerCount}`} detail={`已启用 ${data.enabledProviderCount} / 共 ${data.providerCount} 个`} />
        <ControlCard label="可调用模型" value={callableModelCount} detail={`可用 ${availableModelCount} / 共 ${totalCatalogModelCount} 个模型`} />
        <ControlCard label="物理模型" value={data.physicalModelCount} detail="运行时模型池中的物理模型数" />
        <ControlCard label="异常项" value={data.issueCount} detail="异常/降级供应商" />
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
            <div className="mt-2 space-y-2">
              {group.models.slice(0, 6).map((model) => {
                const capabilities = model.capabilities?.length ? model.capabilities : ["unknown"];
                return (
                  <div key={model.id} className="rounded bg-muted/40 px-2 py-1.5">
                    <div className="text-xs font-medium text-foreground">{model.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {capabilities.map((capability) => <span key={capability} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{capability}</span>)}
                    </div>
                  </div>
                );
              })}
              {group.models.length === 0 && <span className="text-xs text-muted-foreground">没有模型，请先刷新供应商模型列表。</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}



export function ProviderSettingsPage({ client = defaultClient }: ProviderSettingsPageProps) {
  const [providers, setProviders] = useState<ManagedProvider[]>([]);
  const [selectedApiProviderId, setSelectedApiProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormState>(INITIAL_FORM);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showProtocolModal, setShowProtocolModal] = useState(false);
  const [contextDrafts, setContextDrafts] = useState<Record<string, string>>({});
  const [providerRuntimeSummary, setProviderRuntimeSummary] = useState<ProviderRuntimeSummary | null>(null);
  const [groupedModels, setGroupedModels] = useState<GroupedModelInventory[]>([]);
  const [providerQuery, setProviderQuery] = useState("");
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [hideTestFixtures, setHideTestFixtures] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    async function load() {
      const [
        { providers: nextProviders },
        runtimeSummaryResult,
        groupedModelsResult,
      ] = await Promise.all([
        client.listProviders(),
        client.getProviderSummary?.().catch(() => null) ?? Promise.resolve(null),
        client.listGroupedModels?.().catch(() => null) ?? Promise.resolve(null),
      ]);

      if (!mounted) return;
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
      providerCount: providers.length,
      enabledProviderCount: providers.filter((provider) => provider.enabled).length,
      modelCount: providers.reduce((total, provider) => total + provider.models.filter((model) => model.enabled !== false).length, 0),
    };
  }, [providers]);

  const providerStatuses = useMemo(() => Object.fromEntries(providers.map((provider) => [provider.id, providerStatus(provider)])), [providers]);
  const fixtureFacts = useMemo(() => deriveProviderFixtureFacts({ cleanRoot: false, providers }), [providers]);
  const fixtureProviderIds = useMemo(() => new Set(fixtureFacts.map((fact) => fact.id.replace("provider-fixture.", ""))), [fixtureFacts]);
  const filteredProviders = useMemo(() => providers.filter((provider) => {
    const isFixture = fixtureProviderIds.has(provider.id);
    if (hideTestFixtures && isFixture) return false;
    if (!providerMatchesQuery(provider, providerQuery)) return false;
    if (showIssuesOnly && !providerHasIssue(providerStatuses[provider.id], isFixture)) return false;
    return true;
  }), [fixtureProviderIds, hideTestFixtures, providerQuery, providerStatuses, providers, showIssuesOnly]);

  const selectedApiProvider = providers.find((provider) => provider.id === selectedApiProviderId) ?? null;

  const saveProvider = async (selectedProtocol?: ProviderProtocol) => {
    const protocol = selectedProtocol ?? form.protocol;
    const compatibility = protocolToCompatibility(protocol);
    const id = `provider-${Date.now()}`;
    setBusy("create-provider");
    setError(null);
    try {
      const result = await client.createProvider({
        id,
        name: form.name.trim() || "新供应商",
        type: providerTypeFromCompatibility(compatibility),
        enabled: true,
        apiKeyRequired: true,
        baseUrl: "",
        prefix: form.prefix.trim() || id,
        protocol,
        compatibility,
        apiMode: protocol === "responses" ? "responses" : protocol === "codex" ? "codex" : "completions",
        config: { apiKey: "" },
        models: [],
      });
      setProviders((current) => applyProvider(current, result.provider));
      setSelectedApiProviderId(result.provider.id);
      setShowAddForm(false);
      setShowProtocolModal(false);
      setForm(INITIAL_FORM);
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

  if (loading) {
    return <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">正在加载 AI 供应商…</div>;
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
        onDelete={async (providerId) => {
          await client.deleteProvider(providerId);
          setSelectedApiProviderId(null);
          setProviders((current) => current.filter((p) => p.id !== providerId));
        }}
      />
    );
  }

  return (
    <section aria-label="AI 供应商设置" className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">AI 供应商</h2>
        <p className="text-sm text-muted-foreground">
          {summary.providerCount} 个供应商（{summary.enabledProviderCount} 已启用） · {summary.modelCount} 个模型
        </p>
      </div>

      {(feedback || error) && (
        <div className={error ? "rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" : "rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"}>
          {error ?? feedback}
        </div>
      )}

      <RuntimeOverviewSection summary={providerRuntimeSummary} fallback={summary} />

      <section className="space-y-3 rounded-lg border border-border bg-card p-3" aria-label="Provider 可读性过滤">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
          <label className="text-sm">
            搜索供应商或模型
            <Input
              aria-label="搜索供应商或模型"
              className="mt-1 w-full"
              value={providerQuery}
              onChange={(event) => setProviderQuery(event.currentTarget.value)}
              placeholder="按供应商、模型、prefix 或 endpoint 过滤"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showIssuesOnly} onChange={(event) => setShowIssuesOnly(event.currentTarget.checked)} />
            只看异常项
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hideTestFixtures} onChange={(event) => setHideTestFixtures(event.currentTarget.checked)} />
            隐藏测试夹具
          </label>
        </div>
        <p className="text-xs text-muted-foreground">当前显示 {filteredProviders.length} / {providers.length} 个供应商；异常过滤包含降级、错误、未验证、缺配置项。</p>
        {fixtureFacts.length > 0 ? <p className="text-xs text-muted-foreground">检测到 {fixtureFacts.length} 个测试夹具开发数据；正式发布验收请使用 clean root，或隐藏/清理这些 E2E Provider。</p> : null}
      </section>

      <ApiProvidersSection
        providers={filteredProviders}
        providerStatuses={providerStatuses}
        fixtureProviderIds={fixtureProviderIds}
        showAddForm={showAddForm}
        showProtocolModal={showProtocolModal}
        form={form}
        busy={busy}
        setForm={setForm}
        onToggleAddForm={() => setShowProtocolModal(true)}
        onOpenProtocolModal={() => setShowProtocolModal(true)}
        onCloseProtocolModal={() => setShowProtocolModal(false)}
        onSelectProtocol={(protocol) => {
          setShowProtocolModal(false);
          setForm({ ...INITIAL_FORM, protocol });
          setShowAddForm(true);
        }}
        onSaveProvider={() => void saveProvider()}
        onSelectProvider={setSelectedApiProviderId}
        onToggleProvider={toggleProvider}
        onDeleteProvider={async (providerId) => {
          await client.deleteProvider(providerId);
          setProviders((current) => current.filter((p) => p.id !== providerId));
        }}
      />
    </section>
  );
}
