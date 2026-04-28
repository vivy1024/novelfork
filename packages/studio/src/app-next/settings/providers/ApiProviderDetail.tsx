import { useEffect, useState } from "react";

import { EmptyState } from "../../components/feedback";
import type { ManagedProvider, Model, ProviderApiMode, ProviderCompatibility, ProviderType } from "@/shared/provider-catalog";
import type { ApiProvider } from "../provider-types";

const API_MODE_LABELS: Record<ProviderApiMode, string> = {
  completions: "Completions",
  responses: "Responses",
  codex: "Codex",
};

function providerTypeFromCompatibility(compatibility: ProviderCompatibility): ProviderType {
  return compatibility === "anthropic-compatible" ? "anthropic" : "custom";
}

export function ApiProviderDetail({
  provider,
  busy,
  feedback,
  error,
  contextDrafts,
  setContextDrafts,
  onBack,
  onRefreshModels,
  onTestModel,
  onUpdateModel,
  onUpdateProvider,
}: {
  readonly provider: ApiProvider;
  readonly busy: string | null;
  readonly feedback: string | null;
  readonly error: string | null;
  readonly contextDrafts: Record<string, string>;
  readonly setContextDrafts: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  readonly onBack: () => void;
  readonly onRefreshModels: (providerId: string) => Promise<void>;
  readonly onTestModel: (providerId: string, modelId: string) => Promise<void>;
  readonly onUpdateModel: (providerId: string, model: Model, updates: Partial<Model>) => Promise<void>;
  readonly onUpdateProvider: (providerId: string, updates: Partial<ManagedProvider>) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? provider.config.endpoint ?? "");
  const [apiKey, setApiKey] = useState("");
  const [compatibility, setCompatibility] = useState<ProviderCompatibility>(provider.compatibility ?? "openai-compatible");
  const [apiMode, setApiMode] = useState<ProviderApiMode>(provider.apiMode ?? "completions");

  useEffect(() => {
    setBaseUrl(provider.baseUrl ?? provider.config.endpoint ?? "");
    setApiKey("");
    setCompatibility(provider.compatibility ?? "openai-compatible");
    setApiMode(provider.apiMode ?? "completions");
  }, [provider]);

  const saveConnectionInfo = async () => {
    const trimmedApiKey = apiKey.trim();
    await onUpdateProvider(provider.id, {
      baseUrl: baseUrl.trim() || undefined,
      compatibility,
      apiMode,
      type: providerTypeFromCompatibility(compatibility),
      config: trimmedApiKey ? { ...provider.config, apiKey: trimmedApiKey } : provider.config,
    });
    setApiKey("");
  };

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
        <div className={error ? "rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" : "rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"}>
          {error ?? feedback}
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="text-base font-semibold">API 接入信息</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Base URL
            <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label className="text-sm">
            API Key
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
              value={apiKey}
              placeholder={provider.config.apiKey ? "已配置，留空不变" : "请输入 API Key"}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label className="text-sm">
            兼容格式
            <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={compatibility} onChange={(event) => setCompatibility(event.target.value as ProviderCompatibility)}>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic-compatible">Anthropic-compatible</option>
            </select>
          </label>
          <label className="text-sm">
            API 模式
            <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={apiMode} onChange={(event) => setApiMode(event.target.value as ProviderApiMode)}>
              {Object.entries(API_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <button
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          type="button"
          disabled={busy === `provider:${provider.id}`}
          onClick={() => void saveConnectionInfo()}
        >
          保存接入信息
        </button>
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
  readonly provider: ApiProvider;
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
