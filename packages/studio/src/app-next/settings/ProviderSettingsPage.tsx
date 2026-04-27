import { useEffect, useMemo, useState } from "react";

import { fetchJson } from "@/hooks/use-api";
import { EmptyState, InlineError } from "../components/feedback";
import type {
  ManagedProvider,
  Model,
  ProviderApiMode,
  ProviderCompatibility,
  ProviderThinkingStrength,
  ProviderType,
} from "@/shared/provider-catalog";

export interface ProviderSettingsClient {
  listProviders: () => Promise<{ providers: ManagedProvider[] }>;
  createProvider: (provider: Omit<ManagedProvider, "priority">) => Promise<{ provider: ManagedProvider }>;
  refreshModels: (providerId: string) => Promise<{ provider: ManagedProvider; models?: Model[] }>;
  testModel: (providerId: string, modelId: string) => Promise<{ success: boolean; latency?: number; error?: string; model?: Model }>;
  updateModel: (providerId: string, modelId: string, updates: Partial<Model>) => Promise<{ model: Model }>;
}

const defaultClient: ProviderSettingsClient = {
  listProviders: () => fetchJson<{ providers: ManagedProvider[] }>("/providers"),
  createProvider: (provider) => fetchJson<{ provider: ManagedProvider }>("/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(provider),
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

interface ProviderFormState {
  readonly name: string;
  readonly prefix: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly apiMode: ProviderApiMode;
  readonly compatibility: ProviderCompatibility;
}

const INITIAL_FORM: ProviderFormState = {
  name: "",
  prefix: "",
  apiKey: "",
  baseUrl: "",
  apiMode: "completions",
  compatibility: "openai-compatible",
};

const API_MODE_LABELS: Record<ProviderApiMode, string> = {
  completions: "Completions",
  responses: "Responses",
  codex: "Codex",
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

export function ProviderSettingsPage({ client = defaultClient }: ProviderSettingsPageProps) {
  const [providers, setProviders] = useState<ManagedProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormState>(INITIAL_FORM);
  const [showAddForm, setShowAddForm] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [useResponsesWebSocket, setUseResponsesWebSocket] = useState(false);
  const [thinkingStrength, setThinkingStrength] = useState<ProviderThinkingStrength>("medium");
  const [contextDrafts, setContextDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    client.listProviders()
      .then(({ providers: nextProviders }) => {
        if (!mounted) return;
        setProviders(nextProviders);
        setSelectedProviderId((current) => current ?? nextProviders[0]?.id ?? null);
        setContextDrafts(Object.fromEntries(nextProviders.flatMap((provider) => provider.models.map((model) => [`${provider.id}:${model.id}`, String(model.contextWindow)]))));
      })
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
      enabledCount: providers.filter((provider) => provider.enabled).length,
      modelCount: providers.reduce((total, provider) => total + provider.models.filter((model) => model.enabled !== false).length, 0),
    };
  }, [providers]);

  const platformProviders = providers.filter((provider) => provider.type !== "custom");
  const apiKeyProviders = providers.filter((provider) => provider.type === "custom" || provider.apiKeyRequired);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];

  const saveProvider = async () => {
    const id = normalizeProviderId(form.prefix, form.name);
    setBusy("create-provider");
    setError(null);
    try {
      const result = await client.createProvider({
        id,
        name: form.name.trim() || id,
        type: providerTypeFromCompatibility(form.compatibility),
        enabled: true,
        apiKeyRequired: true,
        baseUrl: form.baseUrl.trim() || undefined,
        prefix: form.prefix.trim() || id,
        compatibility: form.compatibility,
        apiMode: form.apiMode,
        accountId: accountId.trim() || undefined,
        useResponsesWebSocket,
        thinkingStrength: form.apiMode === "codex" ? thinkingStrength : undefined,
        config: { apiKey: form.apiKey },
        models: [],
      });
      setProviders((current) => applyProvider(current, result.provider));
      setSelectedProviderId(result.provider.id);
      setFeedback("供应商已保存，可继续刷新模型列表。");
      setForm(INITIAL_FORM);
      setShowAddForm(false);
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
      setSelectedProviderId(result.provider.id);
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
    setProviders((current) => current.map((p) => p.id === providerId ? { ...p, enabled } : p));
    try {
      await fetchJson(`/providers/${providerId}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    } catch {}
  };

  if (loading) {
    return <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">正在加载 AI 供应商…</div>;
  }

  return (
    <section aria-label="AI 供应商设置" className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI 供应商</h2>
          <p className="text-sm text-muted-foreground">{summary.providerCount} 供应商 · {summary.enabledCount} 已启用 · {summary.modelCount} 可用模型</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          + 添加供应商
        </button>
      </div>

      {(feedback || error) && (
        <div className={error ? "rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm" : "rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"}>
          {error ?? feedback}
        </div>
      )}

      {showAddForm && (
        <AddProviderForm form={form} setForm={setForm} onSave={() => void saveProvider()} busy={busy === "create-provider"} />
      )}

      <div className="space-y-3">
        <ProviderGroup
          title="平台集成"
          providers={platformProviders}
          selectedProviderId={selectedProvider?.id}
          onSelect={(id) => setSelectedProviderId((prev) => prev === id ? null : id)}
          onToggle={toggleProvider}
          busy={busy}
          accountId={accountId}
          setAccountId={setAccountId}
          useResponsesWebSocket={useResponsesWebSocket}
          setUseResponsesWebSocket={setUseResponsesWebSocket}
          thinkingStrength={thinkingStrength}
          setThinkingStrength={setThinkingStrength}
          onRefreshModels={refreshModels}
          contextDrafts={contextDrafts}
          setContextDrafts={setContextDrafts}
          onTestModel={testModel}
          onUpdateModel={updateModel}
        />
        <ProviderGroup
          title="API key 接入"
          providers={apiKeyProviders}
          selectedProviderId={selectedProvider?.id}
          onSelect={(id) => setSelectedProviderId((prev) => prev === id ? null : id)}
          onToggle={toggleProvider}
          busy={busy}
          accountId={accountId}
          setAccountId={setAccountId}
          useResponsesWebSocket={useResponsesWebSocket}
          setUseResponsesWebSocket={setUseResponsesWebSocket}
          thinkingStrength={thinkingStrength}
          setThinkingStrength={setThinkingStrength}
          onRefreshModels={refreshModels}
          contextDrafts={contextDrafts}
          setContextDrafts={setContextDrafts}
          onTestModel={testModel}
          onUpdateModel={updateModel}
        />
      </div>
    </section>
  );
}

function ProviderGroup({
  title,
  providers,
  selectedProviderId,
  onSelect,
  onToggle,
  busy,
  accountId,
  setAccountId,
  useResponsesWebSocket,
  setUseResponsesWebSocket,
  thinkingStrength,
  setThinkingStrength,
  onRefreshModels,
  contextDrafts,
  setContextDrafts,
  onTestModel,
  onUpdateModel,
}: {
  readonly title: string;
  readonly providers: readonly ManagedProvider[];
  readonly selectedProviderId?: string;
  readonly onSelect: (providerId: string) => void;
  readonly onToggle: (providerId: string, enabled: boolean) => void;
  readonly busy: string | null;
  readonly accountId: string;
  readonly setAccountId: (value: string) => void;
  readonly useResponsesWebSocket: boolean;
  readonly setUseResponsesWebSocket: (value: boolean) => void;
  readonly thinkingStrength: ProviderThinkingStrength;
  readonly setThinkingStrength: (value: ProviderThinkingStrength) => void;
  readonly onRefreshModels: (providerId: string) => Promise<void>;
  readonly contextDrafts: Record<string, string>;
  readonly setContextDrafts: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  readonly onTestModel: (providerId: string, modelId: string) => Promise<void>;
  readonly onUpdateModel: (providerId: string, model: Model, updates: Partial<Model>) => Promise<void>;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-muted-foreground">{title}</h4>
      {providers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">暂无供应商</div>
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => {
            const isSelected = selectedProviderId === provider.id;
            const enabledModels = provider.models.filter((m) => m.enabled !== false);
            const previewModels = enabledModels.slice(0, 3);
            const moreCount = enabledModels.length - previewModels.length;
            return (
              <div key={`${title}:${provider.id}`}>
                <div
                  className={`rounded-lg border p-3 text-left transition ${isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" className="min-w-0 text-left" onClick={() => onSelect(provider.id)}>
                      <div className="font-medium leading-tight">{provider.name}</div>
                      <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {provider.apiMode ?? provider.compatibility?.replace("-compatible", "") ?? "API"}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={provider.enabled}
                      aria-label={provider.enabled ? "禁用供应商" : "启用供应商"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${provider.enabled ? "bg-primary" : "bg-muted"}`}
                      onClick={(e) => { e.stopPropagation(); onToggle(provider.id, !provider.enabled); }}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${provider.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                  {previewModels.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {previewModels.map((m) => (
                        <span key={m.id} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{m.name}</span>
                      ))}
                      {moreCount > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{moreCount} 更多模型</span>}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground">{provider.models.length} 个模型</div>
                </div>
                {isSelected && (
                  <div className="mt-1 space-y-3 rounded-lg border border-primary/30 bg-muted/10 p-3">
                    <div className="rounded-lg border border-border bg-background p-2 text-sm">
                      <div className="font-medium">{provider.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{provider.compatibility} · {provider.apiMode}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">Base URL：{provider.baseUrl ?? provider.config.endpoint ?? "默认网关"}</div>
                    </div>
                    <section className="space-y-2">
                      <h4 className="text-sm font-medium">高级字段</h4>
                      {provider.compatibility === "openai-compatible" && (
                        <label className="block text-sm">
                          ChatGPT 账户 ID
                          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" value={accountId} onChange={(event) => setAccountId(event.target.value)} />
                        </label>
                      )}
                      {provider.apiMode === "responses" && (
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={useResponsesWebSocket} onChange={(event) => setUseResponsesWebSocket(event.target.checked)} />
                          Responses WebSocket
                        </label>
                      )}
                      {provider.apiMode === "codex" && (
                        <label className="block text-sm">
                          Codex 思考强度
                          <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" value={thinkingStrength} onChange={(event) => setThinkingStrength(event.target.value as ProviderThinkingStrength)}>
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </label>
                      )}
                    </section>
                    <button
                      className="w-full rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
                      type="button"
                      disabled={busy === `refresh:${provider.id}`}
                      onClick={() => void onRefreshModels(provider.id)}
                    >
                      刷新模型
                    </button>
                    <ModelList
                      provider={provider}
                      contextDrafts={contextDrafts}
                      setContextDrafts={setContextDrafts}
                      onTestModel={onTestModel}
                      onUpdateModel={onUpdateModel}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AddProviderForm({
  form,
  setForm,
  onSave,
  busy,
}: {
  readonly form: ProviderFormState;
  readonly setForm: (form: ProviderFormState) => void;
  readonly onSave: () => void;
  readonly busy: boolean;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4">
      <h3 className="text-base font-semibold">添加供应商</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          供应商名称
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label className="text-sm">
          供应商前缀
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value })} />
        </label>
        <label className="text-sm">
          API Key
          <input type="password" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
        </label>
        <label className="text-sm">
          Base URL
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
        </label>
        <label className="text-sm">
          API 模式
          <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.apiMode} onChange={(event) => setForm({ ...form, apiMode: event.target.value as ProviderApiMode })}>
            {Object.entries(API_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          兼容格式
          <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.compatibility} onChange={(event) => setForm({ ...form, compatibility: event.target.value as ProviderCompatibility })}>
            <option value="openai-compatible">OpenAI compatible</option>
            <option value="anthropic-compatible">Anthropic compatible</option>
          </select>
        </label>
      </div>
      <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60" type="button" disabled={busy} onClick={() => { if (!form.name.trim()) return; onSave(); }}>
        保存供应商
      </button>
    </section>
  );
}

function ModelList({
  provider,
  contextDrafts,
  setContextDrafts,
  onTestModel,
  onUpdateModel,
}: {
  readonly provider: ManagedProvider;
  readonly contextDrafts: Record<string, string>;
  readonly setContextDrafts: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  readonly onTestModel: (providerId: string, modelId: string) => Promise<void>;
  readonly onUpdateModel: (providerId: string, model: Model, updates: Partial<Model>) => Promise<void>;
}) {
  if (!provider.models.length) {
    return <EmptyState title="暂无模型" description={'点击"刷新模型"获取模型列表。'} />;
  }

  return (
    <div className="space-y-3">
      {provider.models.map((model) => {
        const key = `${provider.id}:${model.id}`;
        return (
          <div key={model.id} className="space-y-2 rounded-xl border border-border bg-background p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{model.name}</div>
                <div className="text-xs text-muted-foreground">{model.lastTestStatus ?? "untested"}{model.lastTestLatency ? ` · ${model.lastTestLatency}ms` : ""}</div>
              </div>
              <button type="button" className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => void onTestModel(provider.id, model.id)}>
                测试模型 {model.name}
              </button>
            </div>
            <label className="block text-xs">
              {model.name} 上下文长度
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1"
                value={contextDrafts[key] ?? String(model.contextWindow)}
                onChange={(event) => setContextDrafts((current) => ({ ...current, [key]: event.target.value }))}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => void onUpdateModel(provider.id, model, { contextWindow: Number(contextDrafts[key] ?? model.contextWindow) })}>
                保存 {model.name} 上下文长度
              </button>
              <button type="button" className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => void onUpdateModel(provider.id, model, { enabled: model.enabled === false })}>
                {model.enabled === false ? "启用" : "禁用"} {model.name}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
