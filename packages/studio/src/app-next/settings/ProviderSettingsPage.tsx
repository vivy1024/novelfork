import { useEffect, useMemo, useState } from "react";

import { fetchJson } from "@/hooks/use-api";
import { EmptyState } from "../components/feedback";
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

interface PlatformCredential {
  id: string;
  name: string;
  accountId?: string;
  status: "active" | "disabled" | "expired" | "error";
  priority: number;
  successCount: number;
  failureCount: number;
  quota?: { hourlyPercentage?: number; weeklyPercentage?: number };
  lastUsedAt?: string;
}

interface PlatformIntegration {
  id: string;
  name: string;
  platform: "codex" | "kiro" | "cline";
  enabled: boolean;
  credentials: PlatformCredential[];
  modelCount: number;
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

const PLATFORM_INTEGRATIONS: PlatformIntegration[] = [
  { id: "codex-platform", name: "Codex", platform: "codex", enabled: true, modelCount: 4, credentials: [] },
  { id: "kiro-platform", name: "Kiro", platform: "kiro", enabled: false, modelCount: 0, credentials: [] },
  { id: "cline-platform", name: "Cline", platform: "cline", enabled: false, modelCount: 0, credentials: [] },
];

const API_MODE_LABELS: Record<ProviderApiMode, string> = {
  completions: "Completions",
  responses: "Responses",
  codex: "Codex",
};

const PLATFORM_STATUS_LABELS: Record<PlatformCredential["status"], string> = {
  active: "正常",
  disabled: "停用",
  expired: "已过期",
  error: "异常",
};

const PLATFORM_STATUS_CLASS_NAMES: Record<PlatformCredential["status"], string> = {
  active: "bg-emerald-500/10 text-emerald-600",
  disabled: "bg-muted text-muted-foreground",
  expired: "bg-amber-500/10 text-amber-600",
  error: "bg-destructive/10 text-destructive",
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

function maskApiKey(apiKey?: string): string {
  const trimmed = apiKey?.trim();
  if (!trimmed) return "未配置";
  if (trimmed.length <= 8) return "已配置";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function formatDateTime(value?: string): string {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatQuota(quota?: PlatformCredential["quota"]): string {
  if (quota?.hourlyPercentage === undefined && quota?.weeklyPercentage === undefined) return "--";
  const parts: string[] = [];
  if (quota.hourlyPercentage !== undefined) parts.push(`小时 ${quota.hourlyPercentage}%`);
  if (quota.weeklyPercentage !== undefined) parts.push(`周 ${quota.weeklyPercentage}%`);
  return parts.join(" · ");
}

export function ProviderSettingsPage({ client = defaultClient }: ProviderSettingsPageProps) {
  const [providers, setProviders] = useState<ManagedProvider[]>([]);
  const [platformIntegrations, setPlatformIntegrations] = useState<PlatformIntegration[]>(PLATFORM_INTEGRATIONS);
  const [selectedPlatformId, setSelectedPlatformId] = useState<string | null>(null);
  const [selectedApiProviderId, setSelectedApiProviderId] = useState<string | null>(null);
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
    setProviders((current) => current.map((p) => p.id === providerId ? { ...p, enabled } : p));
    try {
      await fetchJson(`/providers/${providerId}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    } catch {}
  };

  const togglePlatform = (integrationId: string, enabled: boolean) => {
    setPlatformIntegrations((current) => current.map((integration) => integration.id === integrationId ? { ...integration, enabled } : integration));
  };

  if (loading) {
    return <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">正在加载 AI 供应商…</div>;
  }

  if (selectedPlatform) {
    return (
      <PlatformDetailView
        integration={selectedPlatform}
        onBack={() => setSelectedPlatformId(null)}
      />
    );
  }

  if (selectedApiProvider) {
    return (
      <ApiProviderDetailView
        provider={selectedApiProvider}
        busy={busy}
        feedback={feedback}
        error={error}
        accountId={accountId}
        setAccountId={setAccountId}
        useResponsesWebSocket={useResponsesWebSocket}
        setUseResponsesWebSocket={setUseResponsesWebSocket}
        thinkingStrength={thinkingStrength}
        setThinkingStrength={setThinkingStrength}
        contextDrafts={contextDrafts}
        setContextDrafts={setContextDrafts}
        onBack={() => setSelectedApiProviderId(null)}
        onRefreshModels={refreshModels}
        onTestModel={testModel}
        onUpdateModel={updateModel}
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
        <div className={error ? "rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm" : "rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"}>
          {error ?? feedback}
        </div>
      )}

      <PlatformCardGroup
        integrations={platformIntegrations}
        onSelect={setSelectedPlatformId}
        onToggle={togglePlatform}
      />

      <ApiProviderSection
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

function PlatformCardGroup({
  integrations,
  onSelect,
  onToggle,
}: {
  readonly integrations: readonly PlatformIntegration[];
  readonly onSelect: (integrationId: string) => void;
  readonly onToggle: (integrationId: string, enabled: boolean) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">平台集成</h3>
        <p className="text-xs text-muted-foreground">Codex、Kiro、Cline 等平台账号统一在这里管理，不展示接口地址或密钥字段。</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {integrations.map((integration) => (
          <PlatformCard
            key={integration.id}
            integration={integration}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}

function PlatformCard({
  integration,
  onSelect,
  onToggle,
}: {
  readonly integration: PlatformIntegration;
  readonly onSelect: (integrationId: string) => void;
  readonly onToggle: (integrationId: string, enabled: boolean) => void;
}) {
  return (
    <div
      aria-label={`查看 ${integration.name} 平台集成详情`}
      className="cursor-pointer rounded-lg border border-border p-3 transition hover:border-primary/40 hover:shadow-sm"
      onClick={() => onSelect(integration.id)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(integration.id); }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium leading-tight">{integration.name}</div>
          <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
            平台
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={integration.enabled}
          aria-label={integration.enabled ? `禁用 ${integration.name} 平台集成` : `启用 ${integration.name} 平台集成`}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${integration.enabled ? "bg-primary" : "bg-muted"}`}
          onClick={(event) => { event.stopPropagation(); onToggle(integration.id, !integration.enabled); }}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${integration.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="rounded-md bg-muted/50 px-2 py-1.5">
          <div className="font-medium text-foreground">{integration.credentials.length}</div>
          <div>凭据数</div>
        </div>
        <div className="rounded-md bg-muted/50 px-2 py-1.5">
          <div className="font-medium text-foreground">{integration.modelCount}</div>
          <div>模型数</div>
        </div>
      </div>
    </div>
  );
}

function ApiProviderSection({
  providers,
  showAddForm,
  form,
  busy,
  setForm,
  onToggleAddForm,
  onSaveProvider,
  onSelectProvider,
  onToggleProvider,
}: {
  readonly providers: readonly ManagedProvider[];
  readonly showAddForm: boolean;
  readonly form: ProviderFormState;
  readonly busy: string | null;
  readonly setForm: (form: ProviderFormState) => void;
  readonly onToggleAddForm: () => void;
  readonly onSaveProvider: () => void;
  readonly onSelectProvider: (providerId: string) => void;
  readonly onToggleProvider: (providerId: string, enabled: boolean) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">API key 接入</h3>
          <p className="text-xs text-muted-foreground">使用 provider-manager 管理的 Base URL、API Key、兼容格式和模型配置。</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
          onClick={onToggleAddForm}
        >
          + 添加供应商
        </button>
      </div>

      {showAddForm && (
        <AddProviderForm form={form} setForm={setForm} onSave={onSaveProvider} busy={busy === "create-provider"} />
      )}

      {providers.length === 0 ? (
        <EmptyState title="暂无 API key 供应商" description="点击“添加供应商”接入 OpenAI compatible 或 Anthropic compatible API。" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <ApiProviderCard
              key={provider.id}
              provider={provider}
              onSelect={onSelectProvider}
              onToggle={onToggleProvider}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ApiProviderCard({
  provider,
  onSelect,
  onToggle,
}: {
  readonly provider: ManagedProvider;
  readonly onSelect: (providerId: string) => void;
  readonly onToggle: (providerId: string, enabled: boolean) => void;
}) {
  const enabledModels = provider.models.filter((model) => model.enabled !== false);
  const previewModels = enabledModels.slice(0, 3);
  const moreCount = enabledModels.length - previewModels.length;

  return (
    <div
      aria-label={`查看 ${provider.name} API key 接入详情`}
      className="cursor-pointer rounded-lg border border-border p-3 transition hover:border-primary/40 hover:shadow-sm"
      onClick={() => onSelect(provider.id)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(provider.id); }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium leading-tight">{provider.name}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {provider.apiMode && (
              <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {provider.apiMode}
              </span>
            )}
            {provider.compatibility && (
              <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {provider.compatibility.replace("-compatible", "")}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={provider.enabled}
          aria-label={provider.enabled ? `禁用 ${provider.name} API key 接入` : `启用 ${provider.name} API key 接入`}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${provider.enabled ? "bg-primary" : "bg-muted"}`}
          onClick={(event) => { event.stopPropagation(); onToggle(provider.id, !provider.enabled); }}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${provider.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>

      {previewModels.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {previewModels.map((model) => (
            <span key={model.id} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{model.name}</span>
          ))}
          {moreCount > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{moreCount} 更多模型</span>}
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">暂无模型，进入详情后刷新。</div>
      )}
      <div className="mt-2 text-xs text-muted-foreground">{provider.models.length} 个模型</div>
    </div>
  );
}

function PlatformDetailView({
  integration,
  onBack,
}: {
  readonly integration: PlatformIntegration;
  readonly onBack: () => void;
}) {
  const credentials = integration.credentials;

  return (
    <section aria-label={`${integration.name} 平台集成详情`} className="space-y-4">
      <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={onBack}>
        ← 返回供应商列表
      </button>
      <div>
        <h2 className="text-lg font-semibold">{integration.name}</h2>
        <p className="text-sm text-muted-foreground">平台账号集成 · {credentials.length} 个账号</p>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="text-base font-semibold">全局设置</h3>
        <label className="block text-sm">
          全局代理 URL
          <input
            disabled
            placeholder="系统代理（自动检测）"
            className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground disabled:opacity-80"
          />
        </label>
        {integration.platform === "codex" && (
          <label className="block text-sm">
            默认推理强度
            <select disabled className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground disabled:opacity-80">
              <option>自动</option>
            </select>
          </label>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">凭据管理</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-60">浏览器添加</button>
            <button type="button" disabled className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-60">设备码添加</button>
            <button type="button" disabled className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-60">JSON 导入</button>
          </div>
        </div>

        {credentials.length === 0 ? (
          <EmptyState title="暂无平台账号" description="后端平台账号系统尚未接入，导入入口暂不可用。" />
        ) : (
          <PlatformCredentialTable credentials={credentials} />
        )}
      </div>
    </section>
  );
}

function PlatformCredentialTable({ credentials }: { readonly credentials: readonly PlatformCredential[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">名称</th>
            <th className="px-3 py-2 text-left font-medium">账号 ID</th>
            <th className="px-3 py-2 text-left font-medium">优先级</th>
            <th className="px-3 py-2 text-left font-medium">状态</th>
            <th className="px-3 py-2 text-left font-medium">成功/失败</th>
            <th className="px-3 py-2 text-left font-medium">配额</th>
            <th className="px-3 py-2 text-left font-medium">最后使用</th>
            <th className="px-3 py-2 text-left font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {credentials.map((credential) => (
            <tr key={credential.id}>
              <td className="px-3 py-2 font-medium">{credential.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{credential.accountId ?? "--"}</td>
              <td className="px-3 py-2 text-muted-foreground">{credential.priority}</td>
              <td className="px-3 py-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${PLATFORM_STATUS_CLASS_NAMES[credential.status]}`}>{PLATFORM_STATUS_LABELS[credential.status]}</span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{credential.successCount}/{credential.failureCount}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatQuota(credential.quota)}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(credential.lastUsedAt)}</td>
              <td className="px-3 py-2">
                <button type="button" disabled className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground disabled:opacity-60">管理</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApiProviderDetailView({
  provider,
  busy,
  feedback,
  error,
  accountId,
  setAccountId,
  useResponsesWebSocket,
  setUseResponsesWebSocket,
  thinkingStrength,
  setThinkingStrength,
  contextDrafts,
  setContextDrafts,
  onBack,
  onRefreshModels,
  onTestModel,
  onUpdateModel,
}: {
  readonly provider: ManagedProvider;
  readonly busy: string | null;
  readonly feedback: string | null;
  readonly error: string | null;
  readonly accountId: string;
  readonly setAccountId: (value: string) => void;
  readonly useResponsesWebSocket: boolean;
  readonly setUseResponsesWebSocket: (value: boolean) => void;
  readonly thinkingStrength: ProviderThinkingStrength;
  readonly setThinkingStrength: (value: ProviderThinkingStrength) => void;
  readonly contextDrafts: Record<string, string>;
  readonly setContextDrafts: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  readonly onBack: () => void;
  readonly onRefreshModels: (providerId: string) => Promise<void>;
  readonly onTestModel: (providerId: string, modelId: string) => Promise<void>;
  readonly onUpdateModel: (providerId: string, model: Model, updates: Partial<Model>) => Promise<void>;
}) {
  const hasAdvancedFields =
    provider.compatibility === "openai-compatible" ||
    provider.apiMode === "responses" ||
    provider.apiMode === "codex";

  return (
    <section aria-label={`${provider.name} API key 接入详情`} className="space-y-4">
      <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={onBack}>
        ← 返回供应商列表
      </button>

      <div>
        <h2 className="text-lg font-semibold">{provider.name}</h2>
        <p className="text-sm text-muted-foreground">API key 接入 · {provider.models.length} 个模型</p>
      </div>

      {(feedback || error) && (
        <div className={error ? "rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm" : "rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"}>
          {error ?? feedback}
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="text-base font-semibold">API 接入信息</h3>
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Base URL</dt>
            <dd className="mt-1 break-all rounded-md bg-muted/50 px-2 py-1.5">{provider.baseUrl ?? provider.config.endpoint ?? "默认网关"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">API Key</dt>
            <dd className="mt-1 break-all rounded-md bg-muted/50 px-2 py-1.5">{provider.apiKeyRequired ? maskApiKey(provider.config.apiKey) : "不需要"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">compatibility</dt>
            <dd className="mt-1 rounded-md bg-muted/50 px-2 py-1.5">{provider.compatibility ?? "未设置"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">apiMode</dt>
            <dd className="mt-1 rounded-md bg-muted/50 px-2 py-1.5">{provider.apiMode ?? "未设置"}</dd>
          </div>
        </dl>
      </section>

      <div>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          type="button"
          disabled={busy === `refresh:${provider.id}`}
          onClick={() => void onRefreshModels(provider.id)}
        >
          刷新模型
        </button>
      </div>

      <ModelList
        provider={provider}
        busy={busy}
        contextDrafts={contextDrafts}
        setContextDrafts={setContextDrafts}
        onTestModel={onTestModel}
        onUpdateModel={onUpdateModel}
      />

      {hasAdvancedFields && (
        <section className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">高级字段</h3>
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
      <h3 className="text-base font-semibold">添加 API key 供应商</h3>
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
  busy,
  contextDrafts,
  setContextDrafts,
  onTestModel,
  onUpdateModel,
}: {
  readonly provider: ManagedProvider;
  readonly busy: string | null;
  readonly contextDrafts: Record<string, string>;
  readonly setContextDrafts: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  readonly onTestModel: (providerId: string, modelId: string) => Promise<void>;
  readonly onUpdateModel: (providerId: string, model: Model, updates: Partial<Model>) => Promise<void>;
}) {
  if (!provider.models.length) {
    return <EmptyState title="暂无模型" description={'点击"刷新模型"获取模型列表。'} />;
  }

  return (
    <section className="space-y-1">
      <h3 className="text-base font-semibold">模型列表</h3>
      <div className="divide-y divide-border rounded-lg border border-border">
        {provider.models.map((model) => {
          const key = `${provider.id}:${model.id}`;
          const isBusy = busy === `test:${provider.id}:${model.id}` || busy === `model:${provider.id}:${model.id}`;
          return (
            <div key={model.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{model.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{model.lastTestStatus ?? "untested"}{model.lastTestLatency ? ` · ${model.lastTestLatency}ms` : ""}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  上下文:
                  <input
                    className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
                    value={contextDrafts[key] ?? String(model.contextWindow)}
                    onChange={(event) => setContextDrafts((current) => ({ ...current, [key]: event.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => void onUpdateModel(provider.id, model, { contextWindow: Number(contextDrafts[key] ?? model.contextWindow) })}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => void onTestModel(provider.id, model.id)}
                >
                  测试
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => void onUpdateModel(provider.id, model, { enabled: model.enabled === false })}
                >
                  {model.enabled === false ? "启用" : "禁用"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
