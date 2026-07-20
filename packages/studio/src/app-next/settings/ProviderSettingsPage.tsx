import { useEffect, useMemo, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import {
  createPlatformProvidersClient,
  createSettingsClient,
  type RuntimePlatformProvidersClient,
  type RuntimeSettings,
  type RuntimeSettingsPatch,
  type TestModelInput,
  type TestModelResult,
} from "../runtime-admin";
import {
  createProviderModelsClient,
  type RefreshRuntimeProviderModelsInput,
  type RefreshRuntimeNugProviderModelsResult,
  type RuntimeProviderModelsRefreshResult,
} from "../runtime-admin/provider-models";
import {
  createNugProviderClient,
  type RuntimeNugBillingConfig,
  type RuntimeNugBillingOrder,
  type RuntimeNugBillingOrderInput,
  type RuntimeNugChannelHealth,
  type RuntimeNugLoginResult,
  type RuntimeNugOAuthStartResult,
  type RuntimeNugQuota,
  type RuntimeNugUsageInput,
  type RuntimeNugUsageResponse,
  type RuntimeNugUsageSummary,
} from "../runtime-admin/nug";
import { ApiProviderDetail } from "./providers/ApiProviderDetail";
import { NugProviderDetail } from "./providers/NugProviderDetail";
import { PlatformProviderDetail, type PlatformProviderKind } from "./providers/PlatformProviderDetail";
import { ProtocolSelectModal, type ProviderProtocolChoice } from "./providers/ProtocolSelectModal";
import { ProviderOverviewView } from "./providers/ProviderOverviewView";
import {
  buildRuntimeModelGroups,
  createRuntimeNugProviderDraft,
  createRuntimeProviderDraft,
  getRuntimeAgentModelState,
  getRuntimeProviderArray,
  migrateRuntimeAgentModelPrefix,
  modelsForProvider,
  runtimeAgentModelPatch,
  runtimeProviderPatch,
  type RuntimeAgentModelState,
  type RuntimeEditableNugProvider,
  type RuntimeEditableProvider,
  type RuntimeModelGroup,
  type RuntimeModelOption,
  type RuntimeProviderArrayKey,
} from "./runtime-settings-utils";

export interface ProviderSettingsClient extends Partial<RuntimePlatformProvidersClient> {
  readonly get: () => Promise<RuntimeSettings>;
  readonly patch: (patch: RuntimeSettingsPatch) => Promise<RuntimeSettings>;
  readonly testModel: (input: TestModelInput) => Promise<TestModelResult>;
  readonly refreshProviderModels: (
    input: RefreshRuntimeProviderModelsInput,
  ) => Promise<RuntimeProviderModelsRefreshResult>;
  readonly refreshNugProviderModels?: (
    providerId: string,
  ) => Promise<RefreshRuntimeNugProviderModelsResult>;
  readonly nugLogin?: (providerId: string, username: string, password: string) => Promise<RuntimeNugLoginResult>;
  readonly nugOAuthStart?: (providerId: string) => Promise<RuntimeNugOAuthStartResult>;
  readonly nugGetQuota?: (providerId: string) => Promise<RuntimeNugQuota>;
  readonly nugGetChannelsHealth?: (providerId: string) => Promise<RuntimeNugChannelHealth>;
  readonly nugGetUsage?: (providerId: string, input?: RuntimeNugUsageInput) => Promise<RuntimeNugUsageResponse>;
  readonly nugGetUsageSummary?: (providerId: string, range?: RuntimeNugUsageInput["range"]) => Promise<RuntimeNugUsageSummary>;
  readonly nugGetBillingConfig?: (providerId: string) => Promise<RuntimeNugBillingConfig>;
  readonly nugCreateBillingOrder?: (providerId: string, input: RuntimeNugBillingOrderInput) => Promise<RuntimeNugBillingOrder>;
  readonly nugGetBillingOrder?: (providerId: string, orderId: string) => Promise<RuntimeNugBillingOrder>;
  readonly nugRepayBillingOrder?: (providerId: string, orderId: string) => Promise<RuntimeNugBillingOrder>;
}

const defaultClient: ProviderSettingsClient = {
  ...createSettingsClient(),
  ...createProviderModelsClient(),
  ...createNugProviderClient(),
  ...createPlatformProvidersClient(),
};

type EditableProvider = RuntimeEditableProvider | RuntimeEditableNugProvider;

interface ProviderSettingsPageProps {
  readonly client?: ProviderSettingsClient;
}

interface PlatformOverviewState {
  readonly kiro?: Awaited<ReturnType<NonNullable<RuntimePlatformProvidersClient["kiroStatus"]>>>;
  readonly codex?: Awaited<ReturnType<NonNullable<RuntimePlatformProvidersClient["codexStatus"]>>>;
  readonly cline?: Awaited<ReturnType<NonNullable<RuntimePlatformProvidersClient["clineStatus"]>>>;
}

interface ConnectionProviderSelection {
  readonly kind: "connection";
  readonly arrayKey: RuntimeProviderArrayKey;
  readonly providerId: string;
}

interface PlatformProviderSelection {
  readonly kind: "platform";
  readonly platform: PlatformProviderKind;
}

type ProviderSelection = ConnectionProviderSelection | PlatformProviderSelection;

interface ProviderDraft {
  readonly arrayKey: RuntimeProviderArrayKey;
  readonly provider: EditableProvider;
}

export function ProviderSettingsPage({ client = defaultClient }: ProviderSettingsPageProps) {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [selection, setSelection] = useState<ProviderSelection | null>(null);
  const [draftSelection, setDraftSelection] = useState<ProviderDraft | null>(null);
  const [protocolModalOpen, setProtocolModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshingProviderId, setRefreshingProviderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [platformOverview, setPlatformOverview] = useState<PlatformOverviewState>({});

  async function refreshPlatformOverview() {
    const [kiro, codex, cline] = await Promise.all([
      client.kiroStatus ? client.kiroStatus().catch(() => undefined) : Promise.resolve(undefined),
      client.codexStatus ? client.codexStatus().catch(() => undefined) : Promise.resolve(undefined),
      client.clineStatus ? client.clineStatus().catch(() => undefined) : Promise.resolve(undefined),
    ]);
    setPlatformOverview({ kiro, codex, cline });
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    void refreshPlatformOverview();
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
  const agentModels = useMemo(
    () => settings ? getRuntimeAgentModelState(settings) : { hiddenModels: [], customModels: [], modelContextWindows: {} },
    [settings],
  );
  const customProviders = useMemo(
    () => settings ? getRuntimeProviderArray(settings, "customApiProviders") : [],
    [settings],
  );
  const nugProviders = useMemo(
    () => settings ? getRuntimeProviderArray(settings, "nugProviders") : [],
    [settings],
  );
  const selectedProvider = selection?.kind === "connection" && settings
    ? getRuntimeProviderArray(settings, selection.arrayKey).find((provider) => provider.id === selection.providerId) ?? null
    : null;

  const overviewProviders = useMemo(() => [
    ...customProviders.map((provider) => ({
      arrayKey: "customApiProviders" as const,
      provider,
      models: modelsForProvider(modelGroups, provider),
    })),
    ...nugProviders.map((provider) => ({
      arrayKey: "nugProviders" as const,
      provider,
      models: modelsForProvider(modelGroups, provider),
    })),
  ], [customProviders, modelGroups, nugProviders]);
  const platformProviders = useMemo(() => {
    const kiroModelCount = Array.isArray(settings?.kiroModels) ? settings.kiroModels.length : 0;
    const configuredClineCount = settings?.clineProviders?.length ?? 0;
    const kiroSnapshot = platformOverview.kiro?.snapshot;
    const kiroTotal = kiroSnapshot?.total ?? kiroSnapshot?.entries?.length ?? kiroSnapshot?.credentials?.length;
    const kiroAvailable = kiroSnapshot?.available;
    const codexSnapshot = platformOverview.codex?.snapshot ?? platformOverview.codex;
    const codexTotal = codexSnapshot?.total ?? codexSnapshot?.entries?.length ?? codexSnapshot?.credentials?.length;
    const codexAvailable = codexSnapshot?.available;
    const clineStatus = platformOverview.cline;

    return [
      {
        platform: "kiro" as const,
        title: "Kiro",
        description: "独立 Kiro 账号池、负载均衡和专属代理。",
        status: platformOverview.kiro
          ? `账号池：${kiroAvailable ?? 0}/${kiroTotal ?? 0} 可用${kiroModelCount > 0 ? ` · ${kiroModelCount} 个模型` : ""}`
          : kiroModelCount > 0 ? `已缓存 ${kiroModelCount} 个 Kiro 模型` : "管理 Kiro 账号与模型池",
      },
      {
        platform: "codex" as const,
        title: "内建 Codex",
        description: "Runtime OAuth 账号池、原生工具与客户端指纹。",
        status: platformOverview.codex
          ? `账号池：${codexAvailable ?? 0}/${codexTotal ?? 0} 可用${platformOverview.codex.useWebSocket === false ? " · WebSocket 已关闭" : ""}`
          : settings?.codexAvailable === false ? "当前 Runtime 未检测到 Codex 能力" : "管理内建 Codex 账号池",
      },
      {
        platform: "cline" as const,
        title: "Cline",
        description: "Cline 授权、模型目录与独立连接配置。",
        status: clineStatus
          ? clineStatus.authenticated
            ? `已连接${clineStatus.email ? `：${clineStatus.email}` : ""} · ${clineStatus.totalModels ?? 0} 个模型`
            : clineStatus.pendingAuth ? "正在等待 Cline 授权完成" : "尚未连接 Cline 账号"
          : configuredClineCount > 0 ? `已配置 ${configuredClineCount} 个 Cline 连接` : "管理 Cline 授权与连接",
      },
    ];
  }, [platformOverview, settings]);

  function allProviders(): EditableProvider[] {
    return [...customProviders, ...nugProviders];
  }

  function normalizeProviderId(
    prefix: string,
    name: string,
    providers: readonly EditableProvider[],
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

  function assertUniquePrefix(provider: EditableProvider, providers = allProviders()) {
    const conflict = providers.find((candidate) => candidate.id !== provider.id && candidate.prefix === provider.prefix);
    if (conflict && provider.prefix) {
      throw new Error(`模型前缀 ${provider.prefix} 已被 ${conflict.name} 使用。`);
    }
  }

  async function patchRuntimeSettings(patch: RuntimeSettingsPatch, successMessage = "平台供应商设置已更新。") {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const updated = await client.patch(patch);
      setSettings(updated);
      setFeedback(successMessage);
      return updated;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function reloadRuntimeSettings() {
    const updated = await client.get();
    setSettings(updated);
    void refreshPlatformOverview();
    return updated;
  }

  async function replaceProviderArray(
    arrayKey: RuntimeProviderArrayKey,
    providers: readonly EditableProvider[],
    successMessage: string,
    nextAgentModels?: RuntimeAgentModelState,
  ) {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const patch: RuntimeSettingsPatch = {
        ...runtimeProviderPatch(arrayKey, providers as never),
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

  async function saveProvider(
    arrayKey: RuntimeProviderArrayKey,
    provider: EditableProvider,
    draftMode: boolean,
  ) {
    if (!settings) return;
    const providers = getRuntimeProviderArray(settings, arrayKey);
    const currentAll = allProviders();
    try {
      if (draftMode) {
        assertUniquePrefix(provider, currentAll);
        const created = {
          ...provider,
          id: normalizeProviderId(provider.prefix, provider.name, currentAll),
        } as EditableProvider;
        await replaceProviderArray(arrayKey, [...providers, created], `${provider.name} 已创建。`);
        setDraftSelection(null);
        setSelection({ kind: "connection", arrayKey, providerId: created.id });
        return;
      }

      assertUniquePrefix(provider, currentAll);
      const previous = providers.find((candidate) => candidate.id === provider.id);
      const normalizedProvider = provider.disabled ? { ...provider, defaultModel: "" } : provider;
      const migratedAgentModels = previous && previous.prefix !== provider.prefix
        ? migrateRuntimeAgentModelPrefix(agentModels, previous.prefix, provider.prefix)
        : undefined;
      const nextProviders = providers.map((candidate) => candidate.id === provider.id ? normalizedProvider : candidate);
      await replaceProviderArray(arrayKey, nextProviders, `${provider.name} 已更新。`, migratedAgentModels);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    }
  }

  function nextAvailableDefaultModel(
    arrayKey: RuntimeProviderArrayKey,
    nextProviders: readonly EditableProvider[],
  ): string {
    if (!settings) return "";
    const nextSettings = {
      ...settings,
      customApiProviders: arrayKey === "customApiProviders"
        ? nextProviders.filter((provider): provider is RuntimeEditableProvider => "protocol" in provider)
        : customProviders,
      nugProviders: arrayKey === "nugProviders"
        ? nextProviders.filter((provider): provider is RuntimeEditableNugProvider => !("protocol" in provider))
        : nugProviders,
    };
    return buildRuntimeModelGroups(nextSettings)
      .flatMap((group) => group.models)
      .find((model) => !model.hidden)?.value ?? "";
  }

  async function deleteProvider(arrayKey: RuntimeProviderArrayKey, providerId: string) {
    if (!settings) return;
    const providers = getRuntimeProviderArray(settings, arrayKey);
    const provider = providers.find((candidate) => candidate.id === providerId);
    const nextProviders = providers.filter((candidate) => candidate.id !== providerId);
    await replaceProviderArray(arrayKey, nextProviders, `${provider?.name ?? "供应商"} 已删除。`);
    const currentDefault = typeof settings.agent?.defaultModel === "string" ? settings.agent.defaultModel : "";
    if (provider && currentDefault.startsWith(`${provider.prefix}:`)) {
      const updated = await client.patch({ agent: { defaultModel: nextAvailableDefaultModel(arrayKey, nextProviders) } });
      setSettings(updated);
    }
    setSelection(null);
  }

  async function toggleProvider(arrayKey: RuntimeProviderArrayKey, providerId: string, enabled: boolean) {
    if (!settings) return;
    const providers = getRuntimeProviderArray(settings, arrayKey);
    const provider = providers.find((candidate) => candidate.id === providerId);
    const nextProviders = providers.map((candidate) => candidate.id === providerId
      ? { ...candidate, disabled: !enabled, ...(enabled ? {} : { defaultModel: "" }) }
      : candidate);
    await replaceProviderArray(arrayKey, nextProviders, enabled ? "供应商已启用。" : "供应商已停用。");
    const currentDefault = typeof settings.agent?.defaultModel === "string" ? settings.agent.defaultModel : "";
    if (!enabled && provider && currentDefault.startsWith(`${provider.prefix}:`)) {
      const updated = await client.patch({ agent: { defaultModel: nextAvailableDefaultModel(arrayKey, nextProviders) } });
      setSettings(updated);
    }
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

  async function refreshProviderModels(provider: EditableProvider) {
    setRefreshingProviderId(provider.id);
    setError(null);
    setFeedback(null);
    try {
      if ("protocol" in provider) {
        const customProvider = provider as RuntimeEditableProvider;
        const result = await client.refreshProviderModels({
          providerId: customProvider.id,
          protocol: customProvider.protocol,
        });
        const fresh = await client.get();
        setSettings(fresh);
        setFeedback(`${provider.name} 已刷新 ${result.models.length} 个模型。`);
      } else {
        if (!client.refreshNugProviderModels) throw new Error("当前 Runtime 不支持 NUG 模型刷新。");
        const result = await client.refreshNugProviderModels(provider.id);
        const fresh = await client.get();
        setSettings(fresh);
        if (result.modelContextWindows) {
          await client.patch({ agent: { modelContextWindows: result.modelContextWindows } });
        }
        setFeedback(`${provider.name} 已刷新 ${result.models.length} 个模型。`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setRefreshingProviderId(null);
    }
  }

  async function loginNugProvider(providerId: string, username: string, password: string) {
    if (!client.nugLogin) throw new Error("当前 Runtime 不支持 NUG 登录。");
    const result = await client.nugLogin(providerId, username, password);
    const apiKey = result.apiKey;
    if (!apiKey) throw new Error("NUG 登录未返回 API Key。");
    const providers = getRuntimeProviderArray(settings ?? {}, "nugProviders");
    const userName = typeof result.user?.username === "string" ? result.user.username : username;
    await replaceProviderArray(
      "nugProviders",
      providers.map((provider) => provider.id === providerId ? { ...provider, apiKey, nugUsername: userName } : provider),
      "NUG 登录成功，API Key 已保存。",
    );
  }

  async function startNugOAuth(providerId: string) {
    if (!client.nugOAuthStart) throw new Error("当前 Runtime 不支持 NUG OAuth。");
    const result = await client.nugOAuthStart(providerId);
    if (!result.authorizeUrl) throw new Error("NUG 未返回 OAuth 地址。");
    window.location.href = result.authorizeUrl;
  }

  async function testModel(model: string, prompt: string) {
    const result = await client.testModel({ model, prompt });
    return result.text;
  }

  function handleProtocolSelect(choice: ProviderProtocolChoice) {
    setProtocolModalOpen(false);
    if (choice === "nug") {
      setDraftSelection({ arrayKey: "nugProviders", provider: createRuntimeNugProviderDraft() });
      return;
    }
    setDraftSelection({ arrayKey: "customApiProviders", provider: createRuntimeProviderDraft(choice) });
  }

  if (loading) {
    return <section aria-label="正在加载供应商设置" className="flex flex-col gap-4"><Skeleton className="h-10 w-64" /><div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-44" /><Skeleton className="h-44" /></div></section>;
  }
  if (!settings) {
    return <section aria-label="供应商设置加载失败" className="flex flex-col gap-4"><h2 className="text-lg font-semibold">供应商设置加载失败</h2><p className="text-sm text-destructive">{error ?? "未能返回设置数据。"}</p></section>;
  }

  if (draftSelection) {
    return draftSelection.arrayKey === "nugProviders" ? (
      <NugProviderDetail
        provider={draftSelection.provider as RuntimeEditableNugProvider}
        modelOptions={[]}
        agentModels={agentModels}
        draftMode
        busy={busy}
        error={error}
        onBack={() => setDraftSelection(null)}
        onSave={(provider) => saveProvider("nugProviders", provider, true)}
        onRefreshModels={async () => undefined}
        onUpdateAgentModels={updateAgentModels}
        onTestModel={testModel}
        onLogin={loginNugProvider}
        onOAuthStart={startNugOAuth}
        onGetQuota={client.nugGetQuota}
        onGetChannelsHealth={client.nugGetChannelsHealth}
        onGetUsage={client.nugGetUsage}
        onGetUsageSummary={client.nugGetUsageSummary}
        onGetBillingConfig={client.nugGetBillingConfig}
        onCreateBillingOrder={client.nugCreateBillingOrder}
        onGetBillingOrder={client.nugGetBillingOrder}
        onRepayBillingOrder={client.nugRepayBillingOrder}
      />
    ) : (
      <ApiProviderDetail
        arrayKey="customApiProviders"
        provider={draftSelection.provider as RuntimeEditableProvider}
        modelOptions={[]}
        agentModels={agentModels}
        draftMode
        busy={busy}
        error={error}
        onBack={() => setDraftSelection(null)}
        onSave={(provider) => saveProvider("customApiProviders", provider, true)}
        onRefreshModels={async () => undefined}
        onUpdateAgentModels={updateAgentModels}
        onTestModel={testModel}
      />
    );
  }

  if (selection?.kind === "platform") {
    return (
      <PlatformProviderDetail
        platform={selection.platform}
        settings={settings}
        client={client}
        busy={busy}
        agentModels={agentModels}
        onBack={() => setSelection(null)}
        onPatchSettings={patchRuntimeSettings}
        onReloadSettings={reloadRuntimeSettings}
        onUpdateAgentModels={updateAgentModels}
        onTestModel={testModel}
      />
    );
  }

  if (selection?.kind === "connection" && selectedProvider) {
    return selection.arrayKey === "nugProviders" ? (
      <NugProviderDetail
        provider={selectedProvider as RuntimeEditableNugProvider}
        modelOptions={modelsForProvider(modelGroups, selectedProvider)}
        agentModels={agentModels}
        busy={busy}
        refreshing={refreshingProviderId === selectedProvider.id}
        error={error}
        onBack={() => setSelection(null)}
        onSave={(provider) => saveProvider("nugProviders", provider, false)}
        onDelete={(providerId) => deleteProvider("nugProviders", providerId)}
        onRefreshModels={() => refreshProviderModels(selectedProvider)}
        onUpdateAgentModels={updateAgentModels}
        onTestModel={testModel}
        onLogin={loginNugProvider}
        onOAuthStart={startNugOAuth}
        onGetQuota={client.nugGetQuota}
        onGetChannelsHealth={client.nugGetChannelsHealth}
        onGetUsage={client.nugGetUsage}
        onGetUsageSummary={client.nugGetUsageSummary}
        onGetBillingConfig={client.nugGetBillingConfig}
        onCreateBillingOrder={client.nugCreateBillingOrder}
        onGetBillingOrder={client.nugGetBillingOrder}
        onRepayBillingOrder={client.nugRepayBillingOrder}
      />
    ) : (
      <ApiProviderDetail
        arrayKey="customApiProviders"
        provider={selectedProvider as RuntimeEditableProvider}
        modelOptions={modelsForProvider(modelGroups, selectedProvider)}
        agentModels={agentModels}
        busy={busy}
        refreshing={refreshingProviderId === selectedProvider.id}
        error={error}
        onBack={() => setSelection(null)}
        onSave={(provider) => saveProvider("customApiProviders", provider, false)}
        onDelete={(providerId) => deleteProvider("customApiProviders", providerId)}
        onRefreshModels={() => refreshProviderModels(selectedProvider)}
        onUpdateAgentModels={updateAgentModels}
        onTestModel={testModel}
      />
    );
  }

  return (
    <>
      <ProviderOverviewView
        providers={overviewProviders}
        modelGroups={modelGroups}
        platformProviders={platformProviders}
        busy={busy}
        error={error}
        feedback={feedback}
        onAdd={() => setProtocolModalOpen(true)}
        onSelectPlatform={(platform) => setSelection({ kind: "platform", platform })}
        onSelect={(arrayKey, providerId) => setSelection({ kind: "connection", arrayKey, providerId })}
        onToggle={(arrayKey, providerId, enabled) => void toggleProvider(arrayKey, providerId, enabled)}
        onDelete={(arrayKey, providerId) => void deleteProvider(arrayKey, providerId)}
      />
      <ProtocolSelectModal
        open={protocolModalOpen}
        onClose={() => setProtocolModalOpen(false)}
        onSelect={handleProtocolSelect}
      />
    </>
  );
}
