import { useEffect, useMemo, useState } from "react";
import { Plus, TestTube2, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  createSettingsClient,
  type RuntimeSettings,
  type RuntimeSettingsPatch,
  type TestModelInput,
  type TestModelResult,
} from "../runtime-admin";
import {
  createProviderModelsClient,
  type RefreshRuntimeProviderModelsInput,
  type RuntimeProviderModelsRefreshResult,
} from "../runtime-admin/provider-models";
import { ApiProviderDetail } from "./providers/ApiProviderDetail";
import {
  RUNTIME_PROVIDER_ARRAYS,
  buildRuntimeModelGroups,
  buildRuntimeModelOptions,
  createRuntimeProviderDraft,
  getRuntimeAgentModelState,
  getRuntimeProviderArray,
  maskedSecretSummary,
  migrateRuntimeAgentModelPrefix,
  modelsForProvider,
  providerApiTypeLabel,
  providerSecrets,
  runtimeAgentModelPatch,
  runtimeProviderPatch,
  type RuntimeAgentModelState,
  type RuntimeEditableProvider,
  type RuntimeModelGroup,
  type RuntimeProviderArrayKey,
} from "./runtime-settings-utils";

export interface ProviderSettingsClient {
  readonly get: () => Promise<RuntimeSettings>;
  readonly patch: (patch: RuntimeSettingsPatch) => Promise<RuntimeSettings>;
  readonly testModel: (input: TestModelInput) => Promise<TestModelResult>;
  readonly refreshProviderModels: (
    input: RefreshRuntimeProviderModelsInput,
  ) => Promise<RuntimeProviderModelsRefreshResult>;
}

const defaultClient: ProviderSettingsClient = {
  ...createSettingsClient(),
  ...createProviderModelsClient(),
};

interface ProviderSettingsPageProps {
  readonly client?: ProviderSettingsClient;
}

interface ProviderSelection {
  readonly arrayKey: RuntimeProviderArrayKey;
  readonly providerId: string;
}

interface ProviderDraft {
  readonly arrayKey: RuntimeProviderArrayKey;
  readonly provider: RuntimeEditableProvider;
}

function normalizeProviderId(
  prefix: string,
  name: string,
  providers: readonly RuntimeEditableProvider[],
): string {
  const base = (prefix || name || "provider")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider";
  let id = base;
  let suffix = 2;
  while (providers.some((provider) => provider.id === id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function ProviderSettingsPage({ client = defaultClient }: ProviderSettingsPageProps) {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [selection, setSelection] = useState<ProviderSelection | null>(null);
  const [draftSelection, setDraftSelection] = useState<ProviderDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshingProviderId, setRefreshingProviderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.get()
      .then((data) => {
        if (active) setSettings(data);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [client]);

  const modelGroups = useMemo(
    () => settings ? buildRuntimeModelGroups(settings, { includeHidden: true, includeDisabled: true }) : [],
    [settings],
  );
  const selectableModelOptions = useMemo(
    () => settings ? buildRuntimeModelOptions(settings) : [],
    [settings],
  );
  const agentModels = useMemo(
    () => settings ? getRuntimeAgentModelState(settings) : { hiddenModels: [], customModels: [], modelContextWindows: {} },
    [settings],
  );
  const selectedProvider = selection && settings
    ? getRuntimeProviderArray(settings, selection.arrayKey)
      .find((provider) => provider.id === selection.providerId) ?? null
    : null;

  async function replaceProviderArray(
    arrayKey: RuntimeProviderArrayKey,
    nextProviders: RuntimeEditableProvider[],
    successMessage: string,
    nextAgentModels?: RuntimeAgentModelState,
  ) {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const patch: RuntimeSettingsPatch = {
        ...runtimeProviderPatch(arrayKey, nextProviders),
        ...(nextAgentModels ? runtimeAgentModelPatch(nextAgentModels) : {}),
      };
      const updated = await client.patch(patch);
      setSettings(updated);
      setFeedback(successMessage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  function assertUniquePrefix(
    providers: readonly RuntimeEditableProvider[],
    provider: RuntimeEditableProvider,
  ) {
    const conflict = providers.find((candidate) =>
      candidate.id !== provider.id && candidate.prefix === provider.prefix,
    );
    if (conflict) throw new Error(`模型前缀 ${provider.prefix} 已被 ${conflict.name} 使用。`);
  }

  async function saveProvider(
    arrayKey: RuntimeProviderArrayKey,
    provider: RuntimeEditableProvider,
    draftMode: boolean,
  ) {
    if (!settings) return;
    const providers = getRuntimeProviderArray(settings, arrayKey);
    try {
      if (draftMode) {
        assertUniquePrefix(providers, provider);
        const created = {
          ...provider,
          id: normalizeProviderId(provider.prefix, provider.name, providers),
        };
        await replaceProviderArray(arrayKey, [...providers, created], `${provider.name} 已创建。`);
        setDraftSelection(null);
        setSelection({ arrayKey, providerId: created.id });
        return;
      }

      assertUniquePrefix(providers, provider);
      const previous = providers.find((candidate) => candidate.id === provider.id);
      const migratedAgentModels = previous && previous.prefix !== provider.prefix
        ? migrateRuntimeAgentModelPrefix(agentModels, previous.prefix, provider.prefix)
        : undefined;
      await replaceProviderArray(
        arrayKey,
        providers.map((candidate) => candidate.id === provider.id ? provider : candidate),
        `${provider.name} 已更新。`,
        migratedAgentModels,
      );
    } catch (reason) {
      if (!(reason instanceof Error && error === reason.message)) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      throw reason;
    }
  }

  async function deleteProvider(arrayKey: RuntimeProviderArrayKey, providerId: string) {
    if (!settings) return;
    const providers = getRuntimeProviderArray(settings, arrayKey);
    const provider = providers.find((candidate) => candidate.id === providerId);
    await replaceProviderArray(
      arrayKey,
      providers.filter((candidate) => candidate.id !== providerId),
      `${provider?.name ?? "供应商"} 已删除。`,
    );
    setSelection(null);
  }

  async function toggleProvider(
    arrayKey: RuntimeProviderArrayKey,
    providerId: string,
    enabled: boolean,
  ) {
    if (!settings) return;
    const providers = getRuntimeProviderArray(settings, arrayKey);
    await replaceProviderArray(
      arrayKey,
      providers.map((provider) => provider.id === providerId
        ? { ...provider, disabled: !enabled }
        : provider),
      enabled ? "供应商已启用。" : "供应商已停用。",
    );
  }

  async function updateAgentModels(next: RuntimeAgentModelState) {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const updated = await client.patch(runtimeAgentModelPatch(next));
      setSettings(updated);
      setFeedback("模型显示、上下文或自定义库存已更新。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function refreshProviderModels(provider: RuntimeEditableProvider) {
    setRefreshingProviderId(provider.id);
    setError(null);
    setFeedback(null);
    try {
      const result = await client.refreshProviderModels({
        providerId: provider.id,
        protocol: provider.protocol,
      });
      const fresh = await client.get();
      setSettings(fresh);
      setFeedback(`${provider.name} 已刷新 ${result.models.length} 个模型。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setRefreshingProviderId(null);
    }
  }

  async function testModel(model: string, prompt: string) {
    const result = await client.testModel({ model, prompt });
    return result.text;
  }

  if (loading) {
    return (
      <section aria-label="正在加载供应商设置" className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      </section>
    );
  }
  if (!settings) {
    return (
      <Alert>
        <AlertTitle>供应商设置加载失败</AlertTitle>
        <AlertDescription>{error ?? "Runtime 未返回设置数据。"}</AlertDescription>
      </Alert>
    );
  }

  if (draftSelection) {
    return (
      <ApiProviderDetail
        arrayKey={draftSelection.arrayKey}
        provider={draftSelection.provider}
        modelOptions={[]}
        agentModels={agentModels}
        draftMode
        busy={busy}
        error={error}
        onBack={() => setDraftSelection(null)}
        onSave={(provider) => saveProvider(draftSelection.arrayKey, provider, true)}
        onRefreshModels={async () => undefined}
        onUpdateAgentModels={updateAgentModels}
        onTestModel={testModel}
      />
    );
  }

  if (selection && selectedProvider) {
    return (
      <ApiProviderDetail
        arrayKey={selection.arrayKey}
        provider={selectedProvider}
        modelOptions={modelsForProvider(modelGroups, selectedProvider)}
        agentModels={agentModels}
        busy={busy}
        refreshing={refreshingProviderId === selectedProvider.id}
        error={error}
        onBack={() => setSelection(null)}
        onSave={(provider) => saveProvider(selection.arrayKey, provider, false)}
        onDelete={(providerId) => deleteProvider(selection.arrayKey, providerId)}
        onRefreshModels={() => refreshProviderModels(selectedProvider)}
        onUpdateAgentModels={updateAgentModels}
        onTestModel={testModel}
      />
    );
  }

  const definition = RUNTIME_PROVIDER_ARRAYS[0];
  const configuredProviders = getRuntimeProviderArray(settings, definition.key);
  const enabledProviders = configuredProviders.filter((provider) => !provider.disabled).length;
  const inventoryCount = modelGroups.reduce((total, group) => total + group.models.length, 0);

  return (
    <section aria-label="AI 供应商设置" className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">AI 供应商</h2>
        <p className="text-sm text-muted-foreground">
          `customApiProviders` 是唯一可编辑数据源；OpenAI / Anthropic 数组仅作为 Runtime 派生模型缓存使用。
        </p>
      </div>

      <Alert>
        <AlertTitle>开源供应商边界</AlertTitle>
        <AlertDescription>
          Kiro、Codex 内置账户池、NUG、Cline 及其模型不会显示或进入新模型选项；Codex Native 仅作为标准自定义 API 协议保留。历史当前模型字符串不会被自动清除。
        </AlertDescription>
      </Alert>

      {error ? (
        <Alert>
          <AlertTitle>供应商操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {feedback ? (
        <Alert>
          <AlertTitle>Runtime 设置已更新</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="标准 API 供应商" value={configuredProviders.length} />
        <SummaryCard label="已启用供应商" value={enabledProviders} />
        <SummaryCard label="完整模型库存" value={inventoryCount} detail={`${selectableModelOptions.length} 个当前可选`} />
      </div>

      <section aria-labelledby={`${definition.key}-heading`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id={`${definition.key}-heading`} className="text-base font-semibold text-foreground">
              {definition.label}
            </h3>
            <p className="text-xs text-muted-foreground">
              {definition.description} 当前 {configuredProviders.length} 个实例。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDraftSelection({
              arrayKey: definition.key,
              provider: createRuntimeProviderDraft(definition.key),
            })}
          >
            <Plus data-icon="inline-start" />
            {definition.addLabel}
          </Button>
        </div>

        {configuredProviders.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>暂无标准 API 供应商</EmptyTitle>
              <EmptyDescription>使用上方按钮创建真实 canonical 配置。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent />
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {configuredProviders.map((provider) => (
              <ProviderCard
                key={provider.id}
                arrayKey={definition.key}
                provider={provider}
                modelGroups={modelGroups}
                busy={busy}
                onSelect={() => setSelection({ arrayKey: definition.key, providerId: provider.id })}
                onToggle={(enabled) => void toggleProvider(definition.key, provider.id, enabled)}
                onDelete={() => void deleteProvider(definition.key, provider.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="runtime-model-heading" className="flex flex-col gap-3">
        <div>
          <h3 id="runtime-model-heading" className="text-base font-semibold text-foreground">完整标准 API 模型库存</h3>
          <p className="text-xs text-muted-foreground">
            展示 canonical provider 对应的全部 Runtime 缓存与自定义模型；已隐藏模型仍在此可见，但不会进入新的模型选择器。
          </p>
        </div>

        {modelGroups.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>暂无标准 API 模型</EmptyTitle>
              <EmptyDescription>进入供应商详情刷新真实模型库存，或添加自定义模型。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {modelGroups.map((group) => (
              <Card key={group.id} size="sm">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {group.label}
                    {group.disabled ? <Badge variant="secondary">供应商已停用</Badge> : null}
                  </CardTitle>
                  <CardDescription>{group.models.length} 个模型 · {group.prefix}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {group.models.map((model) => (
                    <div key={model.value} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs">{model.value}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {model.label}{model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} tokens` : ""}
                        </p>
                      </div>
                      {model.custom ? <Badge variant="secondary">自定义</Badge> : null}
                      {model.hidden ? <Badge variant="outline">已隐藏</Badge> : null}
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`测试模型 ${model.value}`}
                        onClick={async () => {
                          setBusy(true);
                          setError(null);
                          setFeedback(null);
                          try {
                            const text = await testModel(model.value, "请用一句话确认 NovelFork 模型连接正常。");
                            setFeedback(`${model.value}：${text || "测试成功"}`);
                          } catch (reason) {
                            setError(reason instanceof Error ? reason.message : String(reason));
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy || model.hidden || group.disabled}
                      >
                        <TestTube2 />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: number;
  readonly detail?: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
        {detail ? <CardDescription>{detail}</CardDescription> : null}
      </CardHeader>
    </Card>
  );
}

function ProviderCard({
  arrayKey,
  provider,
  modelGroups,
  busy,
  onSelect,
  onToggle,
  onDelete,
}: {
  readonly arrayKey: RuntimeProviderArrayKey;
  readonly provider: RuntimeEditableProvider;
  readonly modelGroups: readonly RuntimeModelGroup[];
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onToggle: (enabled: boolean) => void;
  readonly onDelete: () => void;
}) {
  const models = modelsForProvider(modelGroups, provider);
  const primarySecret = providerSecrets(arrayKey, provider).find((secret) => secret.primary);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {provider.name}
          <Badge variant={provider.disabled ? "secondary" : "default"}>
            {provider.disabled ? "已停用" : "已启用"}
          </Badge>
          <Badge variant="outline">{providerApiTypeLabel(arrayKey, provider)}</Badge>
        </CardTitle>
        <CardDescription>
          {provider.prefix || "未配置前缀"} · {provider.baseUrl || "未配置 Base URL"}
        </CardDescription>
        <CardAction>
          <Switch
            aria-label={`启用 ${provider.name}`}
            checked={!provider.disabled}
            disabled={busy}
            onCheckedChange={onToggle}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>默认模型：<span className="font-mono text-foreground">{provider.defaultModel || "未配置"}</span></p>
        <p>完整模型库存：<span className="text-foreground">{models.length}</span></p>
        <p>{primarySecret?.label ?? "密钥"}：<span className="font-mono text-foreground">{maskedSecretSummary(primarySecret?.value)}</span></p>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <Button type="button" variant="outline" aria-label={`编辑与测试 ${provider.name}`} onClick={onSelect}>
          编辑、库存与测试
        </Button>
        <Button type="button" variant="ghost" aria-label={`删除 ${provider.name}`} onClick={onDelete} disabled={busy}>
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
      </CardFooter>
    </Card>
  );
}
