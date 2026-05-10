import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SimpleSelect } from "@/components/ui/simple-select";
import { EmptyState } from "../../components/feedback";
import { modelTestStatusLabel, providerApiModeLabel, providerCompatibilityLabel } from "../../lib/display-labels";
import type { ManagedProvider, Model, ProviderApiMode, ProviderCompatibility, ProviderThinkingStrength, ProviderType } from "@/shared/provider-catalog";
import type { ApiProvider } from "../provider-types";

const API_MODES: ProviderApiMode[] = ["completions", "responses", "codex"];
const THINKING_STRENGTHS: ProviderThinkingStrength[] = ["low", "medium", "high"];

function providerTypeFromCompatibility(compatibility: ProviderCompatibility): ProviderType {
  return compatibility === "anthropic-compatible" ? "anthropic" : "custom";
}

function hasConfiguredApiKey(provider: ApiProvider): boolean {
  return Boolean(provider.config.apiKey || (provider.config as { apiKeyConfigured?: unknown }).apiKeyConfigured);
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
  onDelete,
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
  readonly onDelete?: (providerId: string) => Promise<void>;
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
      ...(trimmedApiKey ? { config: { apiKey: trimmedApiKey } } : {}),
    });
    setApiKey("");
  };

  return (
    <section aria-label={`${provider.name} API key 接入详情`} className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="flex items-center gap-1" onClick={onBack}>
          ← 返回供应商列表
        </Button>
        {onDelete && (
          <Button variant="destructive" size="sm" onClick={() => { if (confirm(`确认删除供应商「${provider.name}」？此操作不可撤销。`)) void onDelete(provider.id); }}>
            删除供应商
          </Button>
        )}
      </div>

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
            名称
            <Input className="mt-1 w-full" defaultValue={provider.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== provider.name) void onUpdateProvider(provider.id, { name: v }); }} />
          </label>
          <label className="text-sm">
            Base URL
            <Input className="mt-1 w-full" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label className="text-sm">
            API Key
            <Input
              type="password"
              className="mt-1 w-full"
              value={apiKey}
              placeholder={hasConfiguredApiKey(provider) ? "已配置，留空不变" : "请输入 API Key"}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label className="text-sm">
            兼容格式
            <SimpleSelect
              className="mt-1"
              value={compatibility}
              onValueChange={(v) => setCompatibility(v as ProviderCompatibility)}
              options={[
                { value: "openai-compatible", label: providerCompatibilityLabel("openai-compatible") },
                { value: "anthropic-compatible", label: providerCompatibilityLabel("anthropic-compatible") },
              ]}
            />
          </label>
          <label className="text-sm">
            API 模式
            <SimpleSelect
              className="mt-1"
              value={apiMode}
              onValueChange={(v) => setApiMode(v as ProviderApiMode)}
              options={API_MODES.map((value) => ({ value, label: providerApiModeLabel(value) }))}
            />
          </label>
        </div>
        <Button
          variant="default"
          disabled={busy === `provider:${provider.id}`}
          onClick={() => void saveConnectionInfo()}
        >
          保存接入信息
        </Button>
      </section>

      {/* Codex 模式专属配置 */}
      {apiMode === "codex" && (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Codex 配置</h3>
          <p className="text-xs text-muted-foreground">从 Codex 反代出来的供应商支持思考强度、Fast Mode 和 WebSocket。</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Codex 推理强度
              <SimpleSelect
                className="mt-1"
                value={provider.thinkingStrength ?? "medium"}
                onValueChange={(v) => void onUpdateProvider(provider.id, { thinkingStrength: v as ProviderThinkingStrength })}
                options={THINKING_STRENGTHS.map((s) => ({ value: s, label: s === "low" ? "低" : s === "medium" ? "中" : "高" }))}
              />
            </label>
            <label className="text-sm">
              ChatGPT Account ID
              <Input
                className="mt-1 w-full"
                value={provider.accountId ?? ""}
                placeholder="可选，用于组织订阅"
                onChange={(e) => void onUpdateProvider(provider.id, { accountId: e.target.value || undefined })}
              />
            </label>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={provider.useResponsesWebSocket ?? false}
                onCheckedChange={(v) => void onUpdateProvider(provider.id, { useResponsesWebSocket: v })}
              />
              使用 Responses WebSocket
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground">WebSocket 为实验性功能，不可用时自动回退 HTTP。</p>
        </section>
      )}

      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy === `refresh:${provider.id}`}
          onClick={() => void onRefreshModels(provider.id)}
        >
          刷新模型
        </Button>
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
                <span className="ml-2 text-xs text-muted-foreground">{modelTestStatusLabel(model.lastTestStatus)}{model.lastTestLatency ? ` · ${model.lastTestLatency}ms` : ""}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  上下文:
                  <Input
                    className="w-20"
                    value={contextDrafts[key] ?? String(model.contextWindow)}
                    onChange={(event) => setContextDrafts((current) => ({ ...current, [key]: event.target.value }))}
                  />
                </label>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={isBusy}
                  onClick={() => void onUpdateModel(provider.id, model, { contextWindow: Number(contextDrafts[key] ?? model.contextWindow) })}
                >
                  保存
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={isBusy}
                  onClick={() => void onTestModel(provider.id, model.id)}
                >
                  测试
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={isBusy}
                  onClick={() => void onUpdateModel(provider.id, model, { enabled: model.enabled === false })}
                >
                  {model.enabled === false ? "启用" : "禁用"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
