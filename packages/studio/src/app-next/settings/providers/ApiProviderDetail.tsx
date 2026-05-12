import { useEffect, useState } from "react";
import { Play, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
  const [proxy, setProxy] = useState((provider as { proxy?: string }).proxy ?? "");
  const [compatibility, setCompatibility] = useState<ProviderCompatibility>(provider.compatibility ?? "openai-compatible");
  const [apiMode, setApiMode] = useState<ProviderApiMode>(provider.apiMode ?? "completions");

  useEffect(() => {
    setBaseUrl(provider.baseUrl ?? provider.config.endpoint ?? "");
    setApiKey("");
    setProxy((provider as { proxy?: string }).proxy ?? "");
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
      ...(proxy.trim() ? { proxy: proxy.trim() } : { proxy: undefined }),
      ...(trimmedApiKey ? { config: { apiKey: trimmedApiKey } } : {}),
    });
    setApiKey("");
  };

  const originalBaseUrl = provider.baseUrl ?? provider.config.endpoint ?? "";
  const originalProxy = (provider as { proxy?: string }).proxy ?? "";
  const originalCompatibility = provider.compatibility ?? "openai-compatible";
  const originalApiMode = provider.apiMode ?? "completions";
  const hasChanges = baseUrl !== originalBaseUrl || apiKey.trim() !== "" || proxy !== originalProxy || compatibility !== originalCompatibility || apiMode !== originalApiMode;

  const resetForm = () => {
    setBaseUrl(originalBaseUrl);
    setApiKey("");
    setProxy(originalProxy);
    setCompatibility(originalCompatibility);
    setApiMode(originalApiMode);
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
            <Input className="mt-1 w-full" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.deepseek.com/v1" />
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
            HTTPS 代理
            <Input className="mt-1 w-full" value={proxy} onChange={(event) => setProxy(event.target.value)} placeholder="http://127.0.0.1:7890 或 socks5://proxy:1080" />
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
            <span className="text-[10px] text-muted-foreground">
              {compatibility === "openai-compatible" ? "适用于 OpenAI、DeepSeek、OpenRouter、Sub2API 等 /v1/chat/completions 接口" : "适用于 Anthropic Claude 官方或兼容 /v1/messages 接口"}
            </span>
          </label>
          <label className="text-sm">
            API 模式
            <SimpleSelect
              className="mt-1"
              value={apiMode}
              onValueChange={(v) => setApiMode(v as ProviderApiMode)}
              options={API_MODES.map((value) => ({ value, label: providerApiModeLabel(value) }))}
            />
            <span className="text-[10px] text-muted-foreground">
              {apiMode === "completions" ? "标准 Chat Completions（/v1/chat/completions）" : apiMode === "responses" ? "OpenAI Responses API（/v1/responses，支持工具调用）" : "Codex 原生协议（WebSocket + 思考深度）"}
            </span>
          </label>
        </div>
        {hasChanges && (
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              disabled={busy === `provider:${provider.id}`}
              onClick={() => void saveConnectionInfo()}
            >
              保存变更
            </Button>
            <Button
              variant="ghost"
              disabled={busy === `provider:${provider.id}`}
              onClick={resetForm}
            >
              取消
            </Button>
          </div>
        )}
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

      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">模型列表</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{provider.models.filter(m => m.enabled !== false).length} 个模型可用</span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy === `refresh:${provider.id}`}
              onClick={() => void onRefreshModels(provider.id)}
            >
              {busy === `refresh:${provider.id}` ? "获取中…" : "获取模型列表"}
            </Button>
          </div>
        </div>
        {/* 批量操作 */}
        {provider.models.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                for (const model of provider.models) {
                  if (model.enabled !== false) void onUpdateModel(provider.id, model, { enabled: false });
                }
              }}
            >
              全部禁用
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                for (const model of provider.models) {
                  if (model.enabled === false) void onUpdateModel(provider.id, model, { enabled: true });
                }
              }}
            >
              全部启用
            </Button>
          </div>
        )}

        <ModelList
          provider={provider}
          busy={busy}
          contextDrafts={contextDrafts}
          setContextDrafts={setContextDrafts}
          onTestModel={onTestModel}
          onUpdateModel={onUpdateModel}
          onUpdateProvider={onUpdateProvider}
        />
      </section>
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
  onUpdateProvider,
}: {
  readonly provider: ApiProvider;
  readonly busy: string | null;
  readonly contextDrafts: Record<string, string>;
  readonly setContextDrafts: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  readonly onTestModel: (providerId: string, modelId: string) => Promise<void>;
  readonly onUpdateModel: (providerId: string, model: Model, updates: Partial<Model>) => Promise<void>;
  readonly onUpdateProvider: (providerId: string, updates: Partial<ManagedProvider>) => Promise<void>;
}) {
  const [customModelId, setCustomModelId] = useState("");
  const [customModelName, setCustomModelName] = useState("");
  const [testingModel, setTestingModel] = useState<Model | null>(null);
  const [testPrompt, setTestPrompt] = useState("Please introduce yourself in one sentence. / 请用一句话介绍你自己。");
  const [testResult, setTestResult] = useState<{ reply?: string; error?: string; latency?: number } | null>(null);
  const [testRunning, setTestRunning] = useState(false);

  const addCustomModel = () => {
    if (!customModelId.trim()) return;
    const newModel: Model = {
      id: customModelId.trim(),
      name: customModelName.trim() || customModelId.trim(),
      enabled: true,
      contextWindow: 128000,
      maxOutputTokens: 4096,
      lastTestStatus: "untested",
    };
    void onUpdateProvider(provider.id, {
      models: [...provider.models, newModel],
    });
    setCustomModelId("");
    setCustomModelName("");
  };

  const openTestDialog = (model: Model) => {
    setTestingModel(model);
    setTestResult(null);
    setTestRunning(false);
  };

  const runTest = async () => {
    if (!testingModel || testRunning) return;
    setTestRunning(true);
    setTestResult(null);
    const start = Date.now();
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(testingModel.id)}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: testPrompt }),
      });
      const data = await res.json();
      const latency = Date.now() - start;
      if (data.success || data.reply) {
        setTestResult({ reply: data.reply ?? data.message ?? "测试成功（无回复内容）", latency: data.latency ?? latency });
      } else {
        setTestResult({ error: data.error ?? "测试失败", latency });
      }
      // Also trigger the standard test to update model status
      void onTestModel(provider.id, testingModel.id);
    } catch (e) {
      setTestResult({ error: e instanceof Error ? e.message : "网络错误", latency: Date.now() - start });
    } finally {
      setTestRunning(false);
    }
  };

  if (!provider.models.length) {
    return (
      <div className="space-y-3">
        <EmptyState title="暂无模型" description={'点击"获取模型列表"从 API 拉取，或手动添加。'} />
        <CustomModelInput
          modelId={customModelId}
          modelName={customModelName}
          onModelIdChange={setCustomModelId}
          onModelNameChange={setCustomModelName}
          onAdd={addCustomModel}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border rounded-lg border border-border">
        {provider.models.map((model) => {
          const key = `${provider.id}:${model.id}`;
          const isBusy = busy === `test:${provider.id}:${model.id}` || busy === `model:${provider.id}:${model.id}`;
          const isEnabled = model.enabled !== false;
          const testStatus = model.lastTestStatus;
          const testColor = testStatus === "success" ? "text-green-500" : testStatus === "error" ? "text-red-500" : "text-muted-foreground";

          return (
            <div key={model.id} className="flex items-center gap-3 px-3 py-2.5">
              {/* 启用圆点 */}
              <button
                type="button"
                className={`size-3 shrink-0 rounded-full transition ${isEnabled ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
                title={isEnabled ? "已启用，点击禁用" : "已禁用，点击启用"}
                onClick={() => void onUpdateModel(provider.id, model, { enabled: !isEnabled })}
              />

              {/* 模型 ID + 名称 */}
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{model.name || model.id}</span>
                {model.name && model.name !== model.id && (
                  <span className="ml-2 text-xs text-muted-foreground">{model.id}</span>
                )}
                {testStatus && testStatus !== "untested" && (
                  <span className={`ml-2 text-xs ${testColor}`}>
                    {modelTestStatusLabel(testStatus)}{model.lastTestLatency ? ` ${model.lastTestLatency}ms` : ""}
                  </span>
                )}
              </div>

              {/* Context window */}
              <div className="flex items-center gap-1.5">
                <Input
                  className="w-32 text-right text-xs"
                  value={contextDrafts[key] ?? String(model.contextWindow)}
                  onChange={(event) => setContextDrafts((current) => ({ ...current, [key]: event.target.value }))}
                  onBlur={() => {
                    const val = Number(contextDrafts[key]);
                    if (val && val !== model.contextWindow) void onUpdateModel(provider.id, model, { contextWindow: val });
                  }}
                />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">tokens</span>
              </div>

              {/* 测试按钮 */}
              <button
                type="button"
                className={`rounded p-1.5 transition hover:bg-muted disabled:opacity-40 ${testColor}`}
                disabled={isBusy}
                title="测试模型"
                onClick={() => openTestDialog(model)}
              >
                <Play className="size-4" fill="currentColor" />
              </button>
            </div>
          );
        })}
      </div>

      {/* 自定义模型添加 */}
      <CustomModelInput
        modelId={customModelId}
        modelName={customModelName}
        onModelIdChange={setCustomModelId}
        onModelNameChange={setCustomModelName}
        onAdd={addCustomModel}
      />

      {/* 测试模型对话框 */}
      <Dialog open={testingModel !== null} onOpenChange={(open) => { if (!open) setTestingModel(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>测试模型</DialogTitle>
            <DialogDescription>
              模型：<code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{provider.id}:{testingModel?.id}</code>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">测试问题</label>
              <textarea
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
              />
            </div>
            <Button
              className="w-full"
              disabled={testRunning || !testPrompt.trim()}
              onClick={() => void runTest()}
            >
              {testRunning ? "测试中…" : "发送测试"}
            </Button>
            {testResult && (
              <div className={`rounded-lg border p-3 text-sm ${testResult.error ? "border-destructive/40 bg-destructive/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
                {testResult.latency != null && (
                  <p className="text-xs text-muted-foreground mb-1">延迟：{testResult.latency}ms</p>
                )}
                {testResult.error ? (
                  <p className="text-destructive">{testResult.error}</p>
                ) : (
                  <p className="whitespace-pre-wrap">{testResult.reply}</p>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomModelInput({
  modelId,
  modelName,
  onModelIdChange,
  onModelNameChange,
  onAdd,
}: {
  modelId: string;
  modelName: string;
  onModelIdChange: (v: string) => void;
  onModelNameChange: (v: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        className="flex-1 text-xs"
        value={modelId}
        onChange={(e) => onModelIdChange(e.target.value)}
        placeholder="模型 ID（如 deepseek-chat）"
        onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
      />
      <Input
        className="w-40 text-xs"
        value={modelName}
        onChange={(e) => onModelNameChange(e.target.value)}
        placeholder="显示名称（可选）"
        onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
      />
      <Button variant="outline" size="icon-sm" onClick={onAdd} disabled={!modelId.trim()} title="添加自定义模型">
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
