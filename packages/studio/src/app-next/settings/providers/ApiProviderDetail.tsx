import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ModelTestDialog } from "./ModelTestDialog";
import type { RuntimeCustomModelSettings } from "../../runtime-admin";
import {
  isMaskedSecret,
  normalizeProviderProxy,
  providerApiTypeLabel,
  providerArrayLabel,
  providerSecrets,
  toRuntimeModelValue,
  type RuntimeAgentModelState,
  type RuntimeCustomApiProtocol,
  type RuntimeEditableProvider,
  type RuntimeModelOption,
  type RuntimeProviderArrayKey,
} from "../runtime-settings-utils";

interface ApiProviderDetailProps {
  readonly arrayKey: RuntimeProviderArrayKey;
  readonly provider: RuntimeEditableProvider;
  readonly modelOptions: readonly RuntimeModelOption[];
  readonly agentModels: RuntimeAgentModelState;
  readonly draftMode?: boolean;
  readonly busy?: boolean;
  readonly refreshing?: boolean;
  readonly error?: string | null;
  readonly onBack: () => void;
  readonly onSave: (provider: RuntimeEditableProvider) => Promise<void>;
  readonly onDelete?: (providerId: string) => Promise<void>;
  readonly onRefreshModels: () => Promise<void>;
  readonly onUpdateAgentModels: (state: RuntimeAgentModelState) => Promise<void>;
  readonly onTestModel: (model: string, prompt: string) => Promise<string>;
}

const CUSTOM_PROTOCOL_OPTIONS: Array<{ value: RuntimeCustomApiProtocol; label: string }> = [
  { value: "anthropic-official", label: "Anthropic 官方" },
  { value: "anthropic-compatible", label: "Anthropic 兼容" },
  { value: "responses-compatible", label: "Responses 兼容" },
  { value: "completions-compatible", label: "Chat Completions 兼容" },
  { value: "gemini-compatible", label: "Gemini 兼容" },
  { value: "codex-native", label: "Codex Native" },
];

const PROVIDER_REASONING_OPTIONS = [
  { value: "", label: "继承 Agent 默认" },
  { value: "none", label: "关闭思考" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "max", label: "最高" },
] as const;

const PROXY_MODE_OPTIONS = [
  { value: "default", label: "继承统一代理" },
  { value: "system", label: "跟随系统环境变量" },
  { value: "direct", label: "直接连接" },
  { value: "custom", label: "自定义代理" },
] as const;

const USER_AGENT_OPTIONS = [
  { value: "narrafork", label: "默认客户端" },
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex CLI" },
  { value: "custom", label: "自定义 User-Agent" },
] as const;

function headersText(headers: Readonly<Record<string, string>> | undefined): string {
  return Object.keys(headers ?? {}).length > 0 ? JSON.stringify(headers, null, 2) : "";
}

function parseHeaders(value: string): Readonly<Record<string, string>> {
  if (!value.trim()) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("额外请求头必须是 JSON 对象。");
  }
  const entries = Object.entries(parsed);
  if (entries.some(([, headerValue]) => typeof headerValue !== "string")) {
    throw new Error("额外请求头的所有值都必须是字符串。");
  }
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

export function ApiProviderDetail({
  arrayKey,
  provider,
  modelOptions,
  agentModels,
  draftMode = false,
  busy = false,
  refreshing = false,
  error,
  onBack,
  onSave,
  onDelete,
  onRefreshModels,
  onUpdateAgentModels,
  onTestModel,
}: ApiProviderDetailProps) {
  const [draft, setDraft] = useState<RuntimeEditableProvider>(provider);
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [headersInput, setHeadersInput] = useState(headersText(provider.extraHeaders));
  const [headersError, setHeadersError] = useState<string | null>(null);
  const [testPrompt, setTestPrompt] = useState("请用一句话确认连接正常。");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testDialogModel, setTestDialogModel] = useState<string | null>(null);
  const [customModelId, setCustomModelId] = useState("");
  const [customModelLabel, setCustomModelLabel] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(provider);
    setSecretInputs({});
    setHeadersInput(headersText(provider.extraHeaders));
    setHeadersError(null);
    setTestResult(null);
    setTestError(null);
    setModelError(null);
  }, [arrayKey, provider]);

  const defaultModelValue = useMemo(
    () => toRuntimeModelValue(draft.prefix, draft.defaultModel),
    [draft.defaultModel, draft.prefix],
  );
  const secrets = providerSecrets(arrayKey, provider);
  const customModels = useMemo(
    () => new Map(agentModels.customModels.map((model) => [model.value, model])),
    [agentModels.customModels],
  );

  function updateDraft(updates: Partial<RuntimeEditableProvider>) {
    setDraft((current) => ({ ...current, ...updates }));
  }

  async function handleSave(): Promise<boolean> {
    setHeadersError(null);
    let extraHeaders: Readonly<Record<string, string>>;
    try {
      extraHeaders = parseHeaders(headersInput);
    } catch (reason) {
      setHeadersError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
    const next: Record<string, unknown> = { ...draft, extraHeaders };
    for (const secret of secrets) {
      const replacement = secretInputs[secret.key]?.trim();
      next[secret.key] = replacement || secret.value;
    }
    try {
      await onSave(next as unknown as RuntimeEditableProvider);
      return true;
    } catch {
      // The parent owns the Runtime error alert.
      return false;
    }
  }

  async function handleRefreshModels() {
    if (draftMode) return;
    const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(provider)
      || headersInput !== headersText(provider.extraHeaders)
      || Object.values(secretInputs).some((value) => value.trim());
    if (hasUnsavedChanges && !(await handleSave())) return;
    await onRefreshModels();
  }

  async function handleDelete() {
    if (!onDelete) return;
    try {
      await onDelete(draft.id);
    } catch {
      // The parent owns the Runtime error alert.
    }
  }

  async function handleTest(model: string) {
    if (!model || !testPrompt.trim()) return;
    setTestingModel(model);
    setTestResult(null);
    setTestError(null);
    try {
      const text = await onTestModel(model, testPrompt.trim());
      setTestResult(`${model}：${text || "模型已响应，但未返回文本。"}`);
    } catch (reason) {
      setTestError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTestingModel(null);
    }
  }

  async function patchAgentModels(next: RuntimeAgentModelState) {
    setModelError(null);
    try {
      await onUpdateAgentModels(next);
    } catch (reason) {
      setModelError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function addCustomModel() {
    const inputId = customModelId.trim();
    const bareId = inputId.startsWith(`${draft.prefix}:`)
      ? inputId.slice(draft.prefix.length + 1)
      : inputId;
    if (!bareId) return;
    const value = toRuntimeModelValue(draft.prefix, bareId);
    if (modelOptions.some((model) => model.value === value)) {
      setModelError(`${value} 已存在于当前库存。`);
      return;
    }
    const nextModel: RuntimeCustomModelSettings = {
      value,
      label: customModelLabel.trim() || bareId,
      provider: draft.prefix,
    };
    await patchAgentModels({
      ...agentModels,
      customModels: [...agentModels.customModels, nextModel],
    });
    setCustomModelId("");
    setCustomModelLabel("");
  }

  const proxyMode = draft.proxy?.mode ?? "default";
  const isCodex = draft.protocol === "codex-native";
  const isGemini = draft.protocol === "gemini-compatible";

  return (
    <section aria-label={`${draft.name} 供应商详情`} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" />
            返回供应商列表
          </Button>
          <h2 className="mt-2 text-lg font-semibold text-foreground">
            {draftMode ? `新建${providerArrayLabel(arrayKey)}` : draft.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            这里只编辑供应商连接配置；模型库存会在连接详情中管理。
          </p>
        </div>
        {!draftMode && onDelete ? (
          <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
            <Trash2 data-icon="inline-start" />
            删除供应商
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert>
          <AlertTitle>供应商操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            标准 API 接入
            <Badge variant="outline">{providerApiTypeLabel(arrayKey, draft)}</Badge>
          </CardTitle>
          <CardDescription>
            已配置的密钥不会显示原值；留空会保留现有密钥。
          </CardDescription>
        </CardHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <CardContent>
            <FieldGroup className="sm:grid sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="provider-name">名称</FieldLabel>
              <Input
                id="provider-name"
                aria-label="名称"
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.currentTarget.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-prefix">模型前缀</FieldLabel>
              <Input
                id="provider-prefix"
                aria-label="模型前缀"
                value={draft.prefix}
                onChange={(event) => updateDraft({ prefix: event.currentTarget.value.replace(/:/g, "") })}
                placeholder="my-provider"
              />
              <FieldDescription>生成 provider:model 标识，必须与其他标准 API 供应商不同。</FieldDescription>
            </Field>

            <Field>
              <FieldLabel>API 类型 / 协议</FieldLabel>
              <SimpleSelect
                aria-label="API 类型 / 协议"
                value={draft.protocol}
                onValueChange={(value) => updateDraft({
                  protocol: value as RuntimeCustomApiProtocol,
                  ...(value === "gemini-compatible" && !draft.geminiTransport
                    ? { geminiTransport: "generate-content" as const }
                    : {}),
                })}
                options={CUSTOM_PROTOCOL_OPTIONS}
              />
            </Field>
            {isGemini ? (
              <Field>
                <FieldLabel>Gemini 请求协议</FieldLabel>
                <SimpleSelect
                  aria-label="Gemini 请求协议"
                  value={draft.geminiTransport ?? "generate-content"}
                  onValueChange={(value) => updateDraft({
                    geminiTransport: value as "generate-content" | "interactions",
                  })}
                  options={[
                    { value: "generate-content", label: "Generate Content（v1beta）" },
                    { value: "interactions", label: "Interactions（预览协议）" },
                  ]}
                />
                <FieldDescription>选择上游 Gemini 服务实际支持的请求协议。</FieldDescription>
              </Field>
            ) : null}
            <Field orientation="horizontal" className="rounded-lg border p-3">
              <FieldContent>
                <FieldTitle>启用供应商</FieldTitle>
                <FieldDescription>关闭后保留配置，但不参与模型选择。</FieldDescription>
              </FieldContent>
              <Switch
                aria-label="启用供应商"
                checked={!draft.disabled}
                onCheckedChange={(enabled) => updateDraft({ disabled: !enabled })}
              />
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="provider-base-url">Base URL</FieldLabel>
              <Input
                id="provider-base-url"
                aria-label="Base URL"
                value={draft.baseUrl}
                onChange={(event) => updateDraft({ baseUrl: event.currentTarget.value })}
                placeholder={isGemini
                  ? "https://generativelanguage.googleapis.com/v1beta"
                  : "https://api.example.com/v1"
                }
              />
            </Field>

            {secrets.map((secret) => (
              <Field key={secret.key} className="sm:col-span-2">
                <FieldLabel htmlFor={`provider-secret-${secret.key}`}>{secret.label}</FieldLabel>
                <Input
                  id={`provider-secret-${secret.key}`}
                  aria-label={secret.label}
                  type="password"
                  autoComplete="off"
                  value={secretInputs[secret.key] ?? ""}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setSecretInputs((current) => ({
                      ...current,
                      [secret.key]: value,
                    }));
                  }}
                  placeholder={secret.value ? "已配置，留空保持不变" : `请输入${secret.label}`}
                />
                <FieldDescription>
                  {secret.value
                    ? isMaskedSecret(secret.value)
                      ? `已配置密钥：${secret.value}`
                      : "已配置密钥；为安全起见不显示原值。"
                    : "当前未配置。"}
                </FieldDescription>
              </Field>
            ))}

            <Field>
              <FieldLabel htmlFor="provider-default-model">默认模型</FieldLabel>
              <Input
                id="provider-default-model"
                aria-label="默认模型"
                value={draft.defaultModel}
                onChange={(event) => updateDraft({ defaultModel: event.currentTarget.value })}
                placeholder="model-id"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-context-window">供应商默认上下文窗口</FieldLabel>
              <Input
                id="provider-context-window"
                aria-label="供应商默认上下文窗口"
                type="number"
                min={1}
                value={draft.defaultContextWindow ?? ""}
                onChange={(event) => updateDraft({
                  defaultContextWindow: event.currentTarget.value
                    ? Math.max(1, Number(event.currentTarget.value))
                    : undefined,
                })}
                placeholder="可选"
              />
            </Field>

            <FieldSeparator className="sm:col-span-2">网络与推理</FieldSeparator>

            <Field>
              <FieldLabel>代理策略</FieldLabel>
              <SimpleSelect
                aria-label="供应商代理策略"
                value={proxyMode}
                onValueChange={(mode) => updateDraft({
                  proxy: normalizeProviderProxy(
                    mode as "default" | "system" | "direct" | "custom",
                    draft.proxy?.url,
                  ),
                })}
                options={[...PROXY_MODE_OPTIONS]}
              />
            </Field>
            <Field>
              <FieldLabel>供应商默认推理强度</FieldLabel>
              <SimpleSelect
                aria-label="供应商默认推理强度"
                value={draft.defaultReasoningEffort ?? ""}
                onValueChange={(value) => updateDraft({
                  defaultReasoningEffort: value
                    ? value as NonNullable<RuntimeEditableProvider["defaultReasoningEffort"]>
                    : null,
                })}
                options={[...PROVIDER_REASONING_OPTIONS]}
              />
            </Field>

            {proxyMode === "custom" ? (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="provider-proxy-url">代理 URL</FieldLabel>
                <Input
                  id="provider-proxy-url"
                  aria-label="供应商代理 URL"
                  value={draft.proxy?.url ?? ""}
                  onChange={(event) => updateDraft({
                    proxy: normalizeProviderProxy("custom", event.currentTarget.value),
                  })}
                  placeholder="http://127.0.0.1:7890"
                />
              </Field>
            ) : null}

            <Field orientation="horizontal" className="rounded-lg border p-3 sm:col-span-2">
              <FieldContent>
                <FieldTitle>验证 TLS 证书</FieldTitle>
                <FieldDescription>关闭后允许 MITM 代理或自签名证书；仅在你信任目标网络时使用。</FieldDescription>
              </FieldContent>
              <Switch
                aria-label="验证 TLS 证书"
                checked={draft.tlsRejectUnauthorized !== false}
                onCheckedChange={(checked) => updateDraft({ tlsRejectUnauthorized: checked })}
              />
            </Field>

            <FieldSeparator className="sm:col-span-2">客户端指纹与请求头</FieldSeparator>

            <Field>
              <FieldLabel>User-Agent 指纹</FieldLabel>
              <SimpleSelect
                aria-label="User-Agent 指纹"
                value={draft.userAgentMode ?? "narrafork"}
                onValueChange={(value) => updateDraft({
                  userAgentMode: value as NonNullable<RuntimeEditableProvider["userAgentMode"]>,
                })}
                options={[...USER_AGENT_OPTIONS]}
              />
            </Field>
            <Field orientation="horizontal" className="rounded-lg border p-3">
              <FieldContent>
                <FieldTitle>模拟 Codex 稳定请求头</FieldTitle>
                <FieldDescription>发送 originator、installation/session/thread 等 Codex CLI 风格指纹。</FieldDescription>
              </FieldContent>
              <Switch
                aria-label="模拟 Codex 稳定请求头"
                checked={draft.emulateCodexHeaders === true}
                onCheckedChange={(checked) => updateDraft({ emulateCodexHeaders: checked })}
              />
            </Field>

            {draft.userAgentMode === "custom" ? (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="provider-custom-user-agent">自定义 User-Agent</FieldLabel>
                <Input
                  id="provider-custom-user-agent"
                  aria-label="自定义 User-Agent"
                  value={draft.customUserAgent ?? ""}
                  onChange={(event) => updateDraft({ customUserAgent: event.currentTarget.value })}
                />
              </Field>
            ) : null}

            <Field className="sm:col-span-2" data-invalid={Boolean(headersError)}>
              <FieldLabel htmlFor="provider-extra-headers">额外请求头 JSON</FieldLabel>
              <Textarea
                id="provider-extra-headers"
                aria-label="额外请求头 JSON"
                aria-invalid={Boolean(headersError)}
                value={headersInput}
                onChange={(event) => {
                  setHeadersInput(event.currentTarget.value);
                  setHeadersError(null);
                }}
                placeholder={'{\n  "X-Provider-Header": "value"\n}'}
              />
              <FieldDescription>只接受字符串键值对，保存后会随连接配置一并使用。</FieldDescription>
              <FieldError>{headersError}</FieldError>
            </Field>

            {isCodex ? (
              <>
                <FieldSeparator className="sm:col-span-2">Codex Native</FieldSeparator>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="provider-codex-account-id">ChatGPT Account ID</FieldLabel>
                  <Input
                    id="provider-codex-account-id"
                    aria-label="ChatGPT Account ID"
                    value={draft.codexAccountId ?? ""}
                    onChange={(event) => updateDraft({ codexAccountId: event.currentTarget.value })}
                    placeholder="可选"
                  />
                </Field>
                <ProviderSwitch
                  label="使用 Responses WebSocket"
                  description="连接不可用时自动回退到 HTTP。"
                  checked={draft.codexWebSocket === true}
                  onCheckedChange={(checked) => updateDraft({ codexWebSocket: checked })}
                />
                <ProviderSwitch
                  label="允许 Codex Web Search"
                  description="允许把原生 web_search 工具发送给模型。"
                  checked={draft.codexWebSearch !== false}
                  onCheckedChange={(checked) => updateDraft({ codexWebSearch: checked })}
                />
                <ProviderSwitch
                  label="允许 Codex Image Generation"
                  description="允许把原生 image_generation 工具发送给模型。"
                  checked={draft.codexImageGeneration !== false}
                  onCheckedChange={(checked) => updateDraft({ codexImageGeneration: checked })}
                />
              </>
            ) : null}
          </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              type="submit"
              disabled={busy || !draft.name.trim() || !draft.prefix.trim()}
            >
              <Save data-icon="inline-start" />
              {busy ? "保存中…" : draftMode ? "创建供应商" : "保存变更"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>模型库存</CardTitle>
          <CardDescription>
            展示当前连接的全部模型；隐藏、上下文窗口和自定义模型设置会保存到本地配置。
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRefreshModels()}
              disabled={draftMode || refreshing || busy || !provider.apiKey}
            >
              <RefreshCw data-icon="inline-start" />
              {refreshing ? "刷新中…" : "刷新模型库存"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="provider-test-prompt">模型测试提示词</FieldLabel>
            <Input
              id="provider-test-prompt"
              aria-label="供应商测试提示词"
              value={testPrompt}
              onChange={(event) => setTestPrompt(event.currentTarget.value)}
            />
          </Field>

          {testResult ? (
            <Alert>
              <AlertTitle>模型响应</AlertTitle>
              <AlertDescription>{testResult}</AlertDescription>
            </Alert>
          ) : null}
          {testError ? (
            <Alert>
              <AlertTitle>模型测试失败</AlertTitle>
              <AlertDescription>{testError}</AlertDescription>
            </Alert>
          ) : null}
          {modelError ? (
            <Alert>
              <AlertTitle>模型设置更新失败</AlertTitle>
              <AlertDescription>{modelError}</AlertDescription>
            </Alert>
          ) : null}

          {modelOptions.length === 0 ? (
            <Alert>
              <AlertTitle>{draftMode ? "先创建供应商" : "当前供应商没有缓存模型"}</AlertTitle>
              <AlertDescription>
                {draftMode
                  ? "先保存供应商，才能刷新库存、测试连接或添加自定义模型。"
                  : "可刷新真实模型库存，或在下方添加自定义模型。"}
              </AlertDescription>
            </Alert>
          ) : (
            <>
            <div className="flex items-center justify-end gap-2 pb-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => {
                  const allHidden = modelOptions.every((m) => m.hidden);
                  void patchAgentModels({
                    ...agentModels,
                    hiddenModels: allHidden
                      ? agentModels.hiddenModels.filter((v) => !modelOptions.some((m) => m.value === v))
                      : [...new Set([...agentModels.hiddenModels, ...modelOptions.map((m) => m.value)])],
                  });
                }}
              >
                {modelOptions.every((m) => m.hidden) ? <Eye className="mr-1 size-3.5" /> : <EyeOff className="mr-1 size-3.5" />}
                {modelOptions.every((m) => m.hidden) ? "全部显示" : "全部隐藏"}
              </Button>
            </div>
            <div className="flex flex-col max-h-[520px] overflow-y-auto pr-1">
              {modelOptions.map((model) => (
                <ModelInventoryRow
                  key={model.value}
                  model={model}
                  customModel={customModels.get(model.value)}
                  contextWindowOverride={agentModels.modelContextWindows[model.value]}
                  testing={testingModel === model.value}
                  busy={busy}
                  onToggleHidden={() => void patchAgentModels({
                    ...agentModels,
                    hiddenModels: model.hidden
                      ? agentModels.hiddenModels.filter((value) => value !== model.value)
                      : [...new Set([...agentModels.hiddenModels, model.value])],
                  })}
                  onContextWindowChange={(size) => {
                    const next = { ...agentModels.modelContextWindows };
                    if (size == null) delete next[model.value];
                    else next[model.value] = size;
                    void patchAgentModels({ ...agentModels, modelContextWindows: next });
                  }}
                  onCustomLabelChange={(label) => void patchAgentModels({
                    ...agentModels,
                    customModels: agentModels.customModels.map((entry) =>
                      entry.value === model.value ? { ...entry, label } : entry,
                    ),
                  })}
                  onDeleteCustom={() => {
                    const nextWindows = { ...agentModels.modelContextWindows };
                    delete nextWindows[model.value];
                    void patchAgentModels({
                      hiddenModels: agentModels.hiddenModels.filter((value) => value !== model.value),
                      customModels: agentModels.customModels.filter((entry) => entry.value !== model.value),
                      modelContextWindows: nextWindows,
                    });
                  }}
                  onTest={() => {
                    setTestDialogModel(model.value);
                    setTestDialogOpen(true);
                  }}
                />
              ))}
            </div>
            </>
          )}

          <FieldSeparator>添加自定义模型</FieldSeparator>
          <FieldGroup className="sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field data-disabled={draftMode || undefined}>
              <FieldLabel htmlFor="custom-model-id">模型 ID</FieldLabel>
              <Input
                id="custom-model-id"
                aria-label="自定义模型 ID"
                value={customModelId}
                disabled={draftMode || busy}
                onChange={(event) => setCustomModelId(event.currentTarget.value)}
                placeholder="writer-model-1"
              />
            </Field>
            <Field data-disabled={draftMode || undefined}>
              <FieldLabel htmlFor="custom-model-label">显示名称</FieldLabel>
              <Input
                id="custom-model-label"
                aria-label="自定义模型名称"
                value={customModelLabel}
                disabled={draftMode || busy}
                onChange={(event) => setCustomModelLabel(event.currentTarget.value)}
                placeholder="可选，默认使用模型 ID"
              />
            </Field>
            <Button type="button" variant="outline" onClick={() => void addCustomModel()} disabled={draftMode || busy || !customModelId.trim()}>
              <Plus data-icon="inline-start" />
              添加模型
            </Button>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setTestDialogModel(defaultModelValue);
              setTestDialogOpen(true);
            }}
            disabled={Boolean(testingModel) || draftMode || !defaultModelValue}
          >
            <Play data-icon="inline-start" />
            测试默认模型
          </Button>
        </CardFooter>
      </Card>

      {testDialogModel ? (
        <ModelTestDialog
          opened={testDialogOpen}
          onClose={() => {
            setTestDialogOpen(false);
            setTestDialogModel(null);
          }}
          modelValue={testDialogModel}
          onRunTest={(m, p) => onTestModel(m, p)}
        />
      ) : null}
    </section>
  );
}

function ProviderSwitch({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="rounded-lg border p-3">
      <FieldContent>
        <FieldTitle>{label}</FieldTitle>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
    </Field>
  );
}

export function ModelInventoryRow({
  model,
  customModel,
  contextWindowOverride,
  testing,
  busy,
  onToggleHidden,
  onContextWindowChange,
  onCustomLabelChange,
  onDeleteCustom,
  onTest,
}: {
  readonly model: RuntimeModelOption;
  readonly customModel?: RuntimeCustomModelSettings;
  readonly contextWindowOverride?: number;
  readonly testing: boolean;
  readonly busy: boolean;
  readonly onToggleHidden: () => void;
  readonly onContextWindowChange: (size: number | null) => void;
  readonly onCustomLabelChange: (label: string) => void;
  readonly onDeleteCustom: () => void;
  readonly onTest: () => void;
}) {
  const [contextValue, setContextValue] = useState(contextWindowOverride == null ? "" : String(contextWindowOverride));
  const [labelValue, setLabelValue] = useState(customModel?.label ?? model.label);

  useEffect(() => {
    setContextValue(contextWindowOverride == null ? "" : String(contextWindowOverride));
  }, [contextWindowOverride]);
  useEffect(() => {
    setLabelValue(customModel?.label ?? model.label);
  }, [customModel?.label, model.label]);

  return (
    <div data-hidden={model.hidden} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_auto] items-center gap-2 py-1.5 border-b border-border/50 last:border-b-0 data-[hidden=true]:opacity-50">
      <span className="truncate font-mono text-xs text-muted-foreground">{model.value}</span>
      <Input
        aria-label={`模型显示名称 ${model.value}`}
        className="h-7 text-xs"
        value={labelValue}
        disabled={!model.custom || busy}
        onChange={(event) => setLabelValue(event.currentTarget.value)}
        onBlur={() => {
          const next = labelValue.trim() || model.modelId;
          setLabelValue(next);
          if (customModel && next !== customModel.label) onCustomLabelChange(next);
        }}
      />
      <Input
        aria-label={`模型上下文窗口 ${model.value}`}
        className="h-7 text-xs text-right"
        type="number"
        min={1}
        value={contextValue}
        disabled={busy}
        placeholder={model.contextWindow ? `${model.contextWindow} tokens` : "—"}
        onChange={(event) => setContextValue(event.currentTarget.value)}
        onBlur={() => {
          const trimmed = contextValue.trim();
          if (!trimmed) {
            if (contextWindowOverride != null) onContextWindowChange(null);
            return;
          }
          const next = Math.max(1, Math.floor(Number(trimmed) || 1));
          setContextValue(String(next));
          if (next !== contextWindowOverride) onContextWindowChange(next);
        }}
      />
      <div className="flex items-center gap-0.5">
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`${model.hidden ? "显示" : "隐藏"}模型 ${model.value}`} onClick={onToggleHidden} disabled={busy}>
          {model.hidden ? <EyeOff /> : <Eye />}
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`测试模型 ${model.value}`} onClick={onTest} disabled={busy || testing}>
          <Play />
        </Button>
        {model.custom ? (
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除自定义模型 ${model.value}`} onClick={onDeleteCustom} disabled={busy}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
