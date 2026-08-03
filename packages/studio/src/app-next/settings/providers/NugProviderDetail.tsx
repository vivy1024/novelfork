import { ArrowLeft, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ModelTestDialog } from "./ModelTestDialog";
import type { RuntimeCustomModelSettings } from "../../runtime-admin";
import type {
  RuntimeNugChannelHealth,
  RuntimeNugChannelHealthItem,
  RuntimeNugQuota,
  RuntimeNugUsageInput,
  RuntimeNugUsageRange,
  RuntimeNugUsageResponse,
  RuntimeNugUsageSummary,
} from "../../runtime-admin/nug";
import {
  isMaskedSecret,
  normalizeProviderProxy,
  providerSecrets,
  type RuntimeAgentModelState,
  type RuntimeEditableNugProvider,
  type RuntimeModelOption,
} from "../runtime-settings-utils";
import { ModelInventoryRow } from "./ApiProviderDetail";

export interface NugProviderDetailProps {
  readonly provider: RuntimeEditableNugProvider;
  readonly modelOptions: readonly RuntimeModelOption[];
  readonly agentModels: RuntimeAgentModelState;
  readonly draftMode?: boolean;
  readonly busy?: boolean;
  readonly refreshing?: boolean;
  readonly error?: string | null;
  readonly onBack: () => void;
  readonly onSave: (provider: RuntimeEditableNugProvider) => Promise<void>;
  readonly onDelete?: (providerId: string) => Promise<void>;
  readonly onRefreshModels: () => Promise<void>;
  readonly onUpdateAgentModels: (state: RuntimeAgentModelState) => Promise<void>;
  readonly onTestModel: (model: string, prompt: string) => Promise<string>;
  readonly onLogin?: (providerId: string, username: string, password: string) => Promise<void>;
  readonly onOAuthStart?: (providerId: string) => Promise<void>;
  readonly onGetQuota?: (providerId: string) => Promise<RuntimeNugQuota>;
  readonly onGetChannelsHealth?: (providerId: string) => Promise<RuntimeNugChannelHealth>;
  readonly onGetUsage?: (providerId: string, input?: RuntimeNugUsageInput) => Promise<RuntimeNugUsageResponse>;
  readonly onGetUsageSummary?: (providerId: string, range?: RuntimeNugUsageRange) => Promise<RuntimeNugUsageSummary>;
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 从服务地址推导有意义的域名标签，作为默认名称与模型前缀。 */
function extractPrefixFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const hostname = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`).hostname;
    if (!hostname || /^[\d.]+$/.test(hostname) || hostname === "localhost") return "";
    const parts = hostname.split(".").filter(Boolean);
    const generic = new Set(["www", "api", "gateway", "com", "net", "org", "io", "dev", "cn", "co"]);
    const meaningful = parts.filter((part) => !generic.has(part));
    const candidate = meaningful[0] ?? parts[0] ?? "";
    return candidate.toLowerCase().replace(/[^a-z0-9-]/g, "");
  } catch {
    return "";
  }
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function valueOf(record: Readonly<Record<string, unknown>>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "—";
}

function usageRecords(data: RuntimeNugUsageResponse | null): readonly Readonly<Record<string, unknown>>[] {
  if (!data) return [];
  return data.records ?? data.usage ?? [];
}

function SummaryMetric({ label, value }: { readonly label: string; readonly value: string | number }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>;
}

export function NugProviderDetail({
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
  onLogin,
  onOAuthStart,
  onGetQuota,
  onGetChannelsHealth,
  onGetUsage,
  onGetUsageSummary,
}: NugProviderDetailProps) {
  const [draft, setDraft] = useState<RuntimeEditableNugProvider>(provider);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [oauthSecretInput, setOauthSecretInput] = useState("");
  const [testPrompt, setTestPrompt] = useState("请用一句话确认 NUG 连接正常。");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testDialogModel, setTestDialogModel] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [customModelId, setCustomModelId] = useState("");
  const [customModelLabel, setCustomModelLabel] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [quota, setQuota] = useState<RuntimeNugQuota | null>(null);
  const [channelHealth, setChannelHealth] = useState<RuntimeNugChannelHealth | null>(null);
  const [usageRange, setUsageRange] = useState<RuntimeNugUsageRange>("30days");
  const [usage, setUsage] = useState<RuntimeNugUsageResponse | null>(null);
  const [usageSummary, setUsageSummary] = useState<RuntimeNugUsageSummary | null>(null);

  useEffect(() => {
    setDraft(provider);
    setApiKeyInput("");
    setOauthSecretInput("");
    setTestResult(null);
    setTestError(null);
    setModelError(null);
    setAccountError(null);
    setQuota(null);
    setChannelHealth(null);
    setUsage(null);
    setUsageSummary(null);
  }, [provider]);

  const customModels = useMemo(() => new Map(agentModels.customModels.map((model) => [model.value, model])), [agentModels.customModels]);
  const apiKey = providerSecrets("nugProviders", provider)[0]?.value ?? "";
  const oauthSecret = typeof provider.oauthClientSecret === "string" ? provider.oauthClientSecret : "";
  const proxyMode = draft.proxy?.mode ?? "default";
  const records = usageRecords(usage);

  function updateDraft(updates: Partial<RuntimeEditableNugProvider>) {
    setDraft((current) => ({ ...current, ...updates }));
  }

  async function runAccountAction(action: () => Promise<void>) {
    setAccountBusy(true);
    setAccountError(null);
    try { await action(); } catch (reason) { setAccountError(messageFrom(reason)); } finally { setAccountBusy(false); }
  }

  async function handleLogin() {
    if (!onLogin || !loginUsername.trim() || !loginPassword) return;
    await runAccountAction(async () => { await onLogin(draft.id, loginUsername.trim(), loginPassword); setLoginOpen(false); setLoginPassword(""); });
  }

  async function handleQuota() {
    if (!onGetQuota) return;
    await runAccountAction(async () => setQuota(await onGetQuota(draft.id)));
  }

  async function handleChannelHealth() {
    if (!onGetChannelsHealth) return;
    await runAccountAction(async () => setChannelHealth(await onGetChannelsHealth(draft.id)));
  }

  async function handleUsage(range = usageRange) {
    if (!onGetUsage || !onGetUsageSummary) return;
    await runAccountAction(async () => {
      const [nextUsage, nextSummary] = await Promise.all([
        onGetUsage(draft.id, { range, limit: 50, offset: 0 }),
        onGetUsageSummary(draft.id, range),
      ]);
      setUsage(nextUsage);
      setUsageSummary(nextSummary);
    });
  }

  async function handleSave(): Promise<boolean> {
    const next = { ...draft, apiKey: apiKeyInput.trim() || apiKey, oauthClientSecret: oauthSecretInput.trim() || oauthSecret };
    try { await onSave(next); return true; } catch { return false; }
  }

  async function handleRefreshModels() {
    if (draftMode) return;
    const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(provider) || Boolean(apiKeyInput.trim()) || Boolean(oauthSecretInput.trim());
    if (hasUnsavedChanges && !(await handleSave())) return;
    await onRefreshModels();
  }

  async function patchAgentModels(next: RuntimeAgentModelState) {
    setModelError(null);
    try { await onUpdateAgentModels(next); } catch (reason) { setModelError(messageFrom(reason)); }
  }

  async function addCustomModel() {
    const inputId = customModelId.trim();
    const prefix = `${draft.prefix}:`;
    const bareId = inputId.startsWith(prefix) ? inputId.slice(prefix.length) : inputId;
    if (!bareId) return;
    const value = `${draft.prefix}:${bareId}`;
    if (modelOptions.some((model) => model.value === value)) { setModelError(`${value} 已存在于当前库存。`); return; }
    const nextModel: RuntimeCustomModelSettings = { value, label: customModelLabel.trim() || bareId, provider: draft.prefix };
    await patchAgentModels({ ...agentModels, customModels: [...agentModels.customModels, nextModel] });
    setCustomModelId(""); setCustomModelLabel("");
  }

  async function handleTest(model: string) {
    if (!model || !testPrompt.trim()) return;
    setTestingModel(model); setTestResult(null); setTestError(null);
    try { const text = await onTestModel(model, testPrompt.trim()); setTestResult(`${model}：${text || "模型已响应，但未返回文本。"}`); } catch (reason) { setTestError(messageFrom(reason)); } finally { setTestingModel(null); }
  }

  return (
    <section aria-label={`${draft.name} NUG 详情`} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><Button type="button" variant="ghost" size="sm" onClick={onBack}><ArrowLeft data-icon="inline-start" />返回供应商列表</Button><h2 className="mt-2 text-lg font-semibold text-foreground">{draftMode ? "新建 NUG 反代服务" : draft.name}</h2><p className="text-sm text-muted-foreground">连接远端 NUG 服务、管理模型通道、使用量和账单。</p></div>
        {!draftMode && onDelete ? <Button type="button" variant="destructive" onClick={() => void onDelete(draft.id)} disabled={busy}><Trash2 data-icon="inline-start" />删除服务</Button> : null}
      </div>
      {error ? <Alert><AlertTitle>供应商操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {accountError ? <Alert><AlertTitle>NUG 服务操作失败</AlertTitle><AlertDescription>{accountError}</AlertDescription></Alert> : null}

      {!draftMode && (onLogin || onOAuthStart || onGetQuota || onGetChannelsHealth || onGetUsage) ? (
        <Card>
          <CardHeader><CardTitle>账号、通道与额度</CardTitle><CardDescription>{draft.nugUsername ? `当前账号：${draft.nugUsername}` : "可使用 NUG 账号登录获取 API Key，也可直接填写服务密钥。"}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {onLogin ? <Button type="button" variant="outline" onClick={() => setLoginOpen(true)} disabled={accountBusy || !draft.baseUrl}>账号登录</Button> : null}
            {onOAuthStart && draft.oauthClientId ? <Button type="button" variant="outline" onClick={() => void onOAuthStart(draft.id)} disabled={accountBusy || !draft.baseUrl}>OAuth 登录</Button> : null}
            {onGetQuota ? <Button type="button" variant="outline" onClick={() => void handleQuota()} disabled={accountBusy || !apiKey || !draft.baseUrl}>查询额度</Button> : null}
            {onGetChannelsHealth ? <Button type="button" variant="outline" onClick={() => void handleChannelHealth()} disabled={accountBusy || !apiKey || !draft.baseUrl}>通道状态</Button> : null}
            {onGetUsage && onGetUsageSummary ? <Button type="button" variant="outline" onClick={() => void handleUsage()} disabled={accountBusy || !apiKey || !draft.baseUrl}>使用明细</Button> : null}
          </CardContent>
          {quota ? <CardContent className="grid gap-3 border-t pt-4 sm:grid-cols-4"><SummaryMetric label="账号" value={String(quota.username ?? draft.nugUsername ?? "未返回")} /><SummaryMetric label="角色" value={String(quota.role ?? "未返回")} /><SummaryMetric label="额度余额" value={numeric(quota.balance)?.toFixed(2) ?? "未返回"} /><SummaryMetric label="已授予额度" value={numeric(quota.totalGranted)?.toFixed(2) ?? "未返回"} /></CardContent> : null}
        </Card>
      ) : null}

      {(channelHealth || usage || usageSummary) ? <Tabs defaultValue={channelHealth ? "health" : "usage"}><TabsList>{channelHealth ? <TabsTrigger value="health">通道健康</TabsTrigger> : null}{usage || usageSummary ? <TabsTrigger value="usage">用量</TabsTrigger> : null}</TabsList>{channelHealth ? <TabsContent value="health"><ChannelHealthPanel health={channelHealth} /></TabsContent> : null}{usage || usageSummary ? <TabsContent value="usage"><UsagePanel range={usageRange} summary={usageSummary} records={records} busy={accountBusy} onRangeChange={(range) => { setUsageRange(range); void handleUsage(range); }} /></TabsContent> : null}</Tabs> : null}

      <Dialog open={loginOpen} onOpenChange={setLoginOpen}><DialogContent><DialogHeader><DialogTitle>NUG 账号登录</DialogTitle><DialogDescription>登录后 Runtime 会向 NUG 服务申请 API Key，并保存到当前服务配置。</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel htmlFor="nug-login-username">用户名</FieldLabel><Input id="nug-login-username" aria-label="NUG 用户名" value={loginUsername} onChange={(event) => setLoginUsername(event.currentTarget.value)} /></Field><Field><FieldLabel htmlFor="nug-login-password">密码</FieldLabel><Input id="nug-login-password" aria-label="NUG 密码" type="password" autoComplete="off" value={loginPassword} onChange={(event) => setLoginPassword(event.currentTarget.value)} /></Field></FieldGroup><DialogFooter><Button type="button" variant="outline" onClick={() => setLoginOpen(false)}>取消</Button><Button type="button" onClick={() => void handleLogin()} disabled={accountBusy || !loginUsername.trim() || !loginPassword}>登录并保存</Button></DialogFooter></DialogContent></Dialog>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">NUG 反代服务 <Badge variant="outline">Gateway</Badge></CardTitle><CardDescription>API Key 会保留在 Runtime 中，留空不会覆盖已有密钥。</CardDescription></CardHeader>
        <form className="contents" onSubmit={(event) => { event.preventDefault(); void handleSave(); }}><CardContent><FieldGroup className="sm:grid sm:grid-cols-2"><Field><FieldLabel htmlFor="nug-provider-name">服务名称</FieldLabel><Input id="nug-provider-name" aria-label="服务名称" value={draft.name} onChange={(event) => updateDraft({ name: event.currentTarget.value })} /></Field><Field><FieldLabel htmlFor="nug-provider-prefix">模型前缀</FieldLabel><Input id="nug-provider-prefix" aria-label="模型前缀" value={draft.prefix} onChange={(event) => updateDraft({ prefix: event.currentTarget.value.replace(/:/g, "") })} placeholder="nug" /><FieldDescription>模型会以此前缀形成 provider:model 标识。</FieldDescription></Field><Field className="sm:col-span-2"><FieldLabel htmlFor="nug-provider-base-url">NUG 服务地址</FieldLabel><Input id="nug-provider-base-url" aria-label="NUG 服务地址" value={draft.baseUrl} onChange={(event) => { const nextUrl = event.currentTarget.value; const derived = extractPrefixFromUrl(nextUrl); const previousDerived = extractPrefixFromUrl(draft.baseUrl); const prefixUntouched = !draft.prefix || draft.prefix === "nug" || draft.prefix === previousDerived; const nameUntouched = !draft.name || draft.name === previousDerived; updateDraft({ baseUrl: nextUrl, ...(derived && prefixUntouched ? { prefix: derived } : {}), ...(derived && nameUntouched ? { name: derived } : {}) }); }} placeholder="http://127.0.0.1:7800" /><FieldDescription>填入公网地址时会自动推导服务名称与模型前缀；手动改过则不再覆盖。</FieldDescription></Field><Field className="sm:col-span-2"><FieldLabel htmlFor="nug-provider-api-key">API Key</FieldLabel><Input id="nug-provider-api-key" aria-label="NUG API Key" type="password" autoComplete="off" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.currentTarget.value)} placeholder={apiKey ? "已配置，留空保持不变" : "请输入 NUG API Key"} /><FieldDescription>{apiKey ? (isMaskedSecret(apiKey) ? `已配置密钥：${apiKey}` : "已配置密钥；为安全起见不显示原值。") : "当前未配置。"}</FieldDescription></Field><Field><FieldLabel htmlFor="nug-oauth-client-id">OAuth Client ID</FieldLabel><Input id="nug-oauth-client-id" aria-label="NUG OAuth Client ID" value={draft.oauthClientId ?? ""} onChange={(event) => updateDraft({ oauthClientId: event.currentTarget.value })} placeholder="可选" /></Field><Field><FieldLabel htmlFor="nug-oauth-client-secret">OAuth Client Secret</FieldLabel><Input id="nug-oauth-client-secret" aria-label="NUG OAuth Client Secret" type="password" autoComplete="off" value={oauthSecretInput} onChange={(event) => setOauthSecretInput(event.currentTarget.value)} placeholder={oauthSecret ? "已配置，留空保持不变" : "可选"} /></Field><Field><FieldLabel htmlFor="nug-default-model">默认模型</FieldLabel><Input id="nug-default-model" aria-label="NUG 默认模型" value={draft.defaultModel} onChange={(event) => updateDraft({ defaultModel: event.currentTarget.value })} placeholder="channel:model" /></Field><Field orientation="horizontal" className="rounded-lg border p-3"><div className="flex-1"><FieldTitle>启用 NUG</FieldTitle><FieldDescription>关闭后保留服务配置，但不参与模型选择。</FieldDescription></div><Switch aria-label="启用 NUG" checked={!draft.disabled} onCheckedChange={(enabled) => updateDraft({ disabled: !enabled })} /></Field><FieldSeparator className="sm:col-span-2">网络</FieldSeparator><Field><FieldLabel>NUG 代理策略</FieldLabel><SimpleSelect aria-label="NUG 代理策略" value={proxyMode} onValueChange={(value) => updateDraft({ proxy: normalizeProviderProxy(value as "default" | "system" | "direct" | "custom", draft.proxy?.url) })} options={[{ value: "default", label: "继承统一代理" }, { value: "system", label: "跟随系统环境变量" }, { value: "direct", label: "直接连接" }, { value: "custom", label: "自定义代理" }]} /></Field>{proxyMode === "custom" ? <Field><FieldLabel htmlFor="nug-proxy-url">代理 URL</FieldLabel><Input id="nug-proxy-url" aria-label="NUG 代理 URL" value={draft.proxy?.url ?? ""} onChange={(event) => updateDraft({ proxy: normalizeProviderProxy("custom", event.currentTarget.value) })} placeholder="http://127.0.0.1:7890" /></Field> : null}</FieldGroup></CardContent><CardFooter className="justify-end"><Button type="submit" disabled={busy || !draft.name.trim() || !draft.prefix.trim() || !draft.baseUrl.trim()}><Save data-icon="inline-start" />{busy ? "保存中…" : draftMode ? "创建 NUG 服务" : "保存变更"}</Button></CardFooter></form>
      </Card>

      <Card>
        <CardHeader><CardTitle>模型通道</CardTitle><CardDescription>刷新 NUG 真实模型目录，管理隐藏状态、上下文窗口和自定义模型。</CardDescription><CardAction><Button type="button" variant="outline" size="sm" onClick={() => void handleRefreshModels()} disabled={draftMode || refreshing || busy || !apiKey || !draft.baseUrl}><RefreshCw data-icon="inline-start" />{refreshing ? "刷新中…" : "刷新模型"}</Button></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-4">{modelError ? <Alert><AlertTitle>模型设置更新失败</AlertTitle><AlertDescription>{modelError}</AlertDescription></Alert> : null}{modelOptions.length > 0 ? <div className="flex flex-col max-h-[520px] overflow-y-auto pr-1">{modelOptions.map((model) => <ModelInventoryRow key={model.value} model={model} customModel={customModels.get(model.value)} contextWindowOverride={agentModels.modelContextWindows[model.value]} testing={testingModel === model.value} busy={busy} onToggleHidden={() => void patchAgentModels({ ...agentModels, hiddenModels: model.hidden ? agentModels.hiddenModels.filter((value) => value !== model.value) : [...new Set([...agentModels.hiddenModels, model.value])] })} onContextWindowChange={(size) => { const next = { ...agentModels.modelContextWindows }; if (size == null) delete next[model.value]; else next[model.value] = size; void patchAgentModels({ ...agentModels, modelContextWindows: next }); }} onCustomLabelChange={(label) => void patchAgentModels({ ...agentModels, customModels: agentModels.customModels.map((entry) => entry.value === model.value ? { ...entry, label } : entry) })} onDeleteCustom={() => void patchAgentModels({ ...agentModels, hiddenModels: agentModels.hiddenModels.filter((value) => value !== model.value), customModels: agentModels.customModels.filter((entry) => entry.value !== model.value) })} onTest={() => { setTestDialogModel(model.value); setTestDialogOpen(true); }} />)}</div> : <Alert><AlertTitle>{draftMode ? "先保存服务" : "暂无模型目录"}</AlertTitle><AlertDescription>{draftMode ? "保存 NUG 服务后才能刷新模型。" : "点击刷新模型获取 NUG 服务目录。"}</AlertDescription></Alert>}<FieldSeparator>添加自定义模型</FieldSeparator><FieldGroup className="sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><Field data-disabled={draftMode || undefined}><FieldLabel htmlFor="nug-custom-model-id">模型 ID</FieldLabel><Input id="nug-custom-model-id" aria-label="NUG 自定义模型 ID" value={customModelId} disabled={draftMode || busy} onChange={(event) => setCustomModelId(event.currentTarget.value)} placeholder="channel:model" /></Field><Field data-disabled={draftMode || undefined}><FieldLabel htmlFor="nug-custom-model-label">显示名称</FieldLabel><Input id="nug-custom-model-label" aria-label="NUG 自定义模型名称" value={customModelLabel} disabled={draftMode || busy} onChange={(event) => setCustomModelLabel(event.currentTarget.value)} placeholder="可选" /></Field><Button type="button" variant="outline" onClick={() => void addCustomModel()} disabled={draftMode || busy || !customModelId.trim()}><Plus data-icon="inline-start" />添加模型</Button></FieldGroup></CardContent><CardFooter className="justify-end"><Button type="button" variant="outline" onClick={() => void handleTest(draft.defaultModel)} disabled={draftMode || busy || !draft.defaultModel || !testPrompt.trim()}>测试默认模型</Button></CardFooter>
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

function ChannelHealthPanel({ health }: { readonly health: RuntimeNugChannelHealth }) {
  const channels = health.channels ?? [];
  return <Card><CardHeader><CardTitle>通道健康</CardTitle><CardDescription>展示 Runtime 从 NUG 获取的可用性、凭据、并发和队列状态。</CardDescription></CardHeader><CardContent>{channels.length ? <Table><TableHeader><TableRow><TableHead>通道</TableHead><TableHead>状态</TableHead><TableHead>可用率</TableHead><TableHead>凭据</TableHead><TableHead>并发 / 队列</TableHead><TableHead>错误</TableHead></TableRow></TableHeader><TableBody>{channels.map((channel, index) => <ChannelHealthRow key={`${valueOf(channel, ["id", "name", "channel"])}-${index}`} channel={channel} />)}</TableBody></Table> : <p className="text-sm text-muted-foreground">NUG 未返回可用通道详情。</p>}</CardContent></Card>;
}

function ChannelHealthRow({ channel }: { readonly channel: RuntimeNugChannelHealthItem }) {
  const availability = numeric(channel.availability ?? channel.availableRate);
  const status = valueOf(channel, ["status"]);
  return <TableRow><TableCell><div className="flex flex-col"><span>{valueOf(channel, ["name", "channel", "id"])}</span><span className="font-mono text-xs text-muted-foreground">{valueOf(channel, ["channelType", "type"])}</span></div></TableCell><TableCell><Badge variant={status === "healthy" || channel.available ? "secondary" : status === "error" ? "destructive" : "outline"}>{status}</Badge></TableCell><TableCell>{availability == null ? "—" : (() => { const pct = Math.min(100, Math.max(0, availability <= 1 ? availability * 100 : availability)); return <div className="flex items-center gap-2"><div className="h-2 w-16 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div><span className="text-xs tabular-nums">{Math.round(pct)}%</span></div>; })()}</TableCell><TableCell>{valueOf(channel, ["credentialCount", "credentials", "availableCredentials"])}</TableCell><TableCell>{valueOf(channel, ["concurrency", "maxConcurrency"])} / {valueOf(channel, ["queueDepth", "queue", "queueSize"])}</TableCell><TableCell className="max-w-56 truncate text-xs text-muted-foreground">{valueOf(channel, ["error", "message", "lastError"])}</TableCell></TableRow>;
}

function UsagePanel({ range, summary, records, busy, onRangeChange }: { readonly range: RuntimeNugUsageRange; readonly summary: RuntimeNugUsageSummary | null; readonly records: readonly Readonly<Record<string, unknown>>[]; readonly busy: boolean; readonly onRangeChange: (range: RuntimeNugUsageRange) => void }) {
  return <Card><CardHeader><CardTitle>使用量</CardTitle><CardDescription>按时间范围查看 NUG 聚合消耗和最近请求明细。</CardDescription><CardAction><SimpleSelect aria-label="NUG 使用时间范围" value={range} onValueChange={(value) => onRangeChange(value as RuntimeNugUsageRange)} disabled={busy} options={[{ value: "today", label: "今天" }, { value: "7days", label: "近 7 天" }, { value: "30days", label: "近 30 天" }, { value: "all", label: "全部" }]} /></CardAction></CardHeader><CardContent className="flex flex-col gap-4">{summary ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SummaryMetric label="请求数" value={summary.requestCount} /><SummaryMetric label="计量用量" value={summary.totalMeterUsage.toFixed(2)} /><SummaryMetric label="额度成本" value={summary.totalQuotaCost.toFixed(2)} /><SummaryMetric label="输入 / 输出 Token" value={`${summary.totalInputTokens} / ${summary.totalOutputTokens}`} /></div> : null}{records.length ? <Table><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>模型</TableHead><TableHead>通道</TableHead><TableHead>输入 / 输出</TableHead><TableHead>费用</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{records.map((record, index) => <TableRow key={`${valueOf(record, ["id", "requestId"])}-${index}`}><TableCell>{valueOf(record, ["createdAt", "timestamp", "created_at"])}</TableCell><TableCell className="font-mono text-xs">{valueOf(record, ["model", "modelId"])}</TableCell><TableCell>{valueOf(record, ["channel", "channelType", "provider"])}</TableCell><TableCell>{valueOf(record, ["inputTokens", "input_tokens"])} / {valueOf(record, ["outputTokens", "output_tokens"])}</TableCell><TableCell>{valueOf(record, ["quotaCost", "quota_cost", "meterUsage", "meter_usage"])} </TableCell><TableCell><Badge variant={valueOf(record, ["status"]) === "error" ? "destructive" : "outline"}>{valueOf(record, ["status"])}</Badge></TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-muted-foreground">当前范围没有可展示的请求明细。</p>}</CardContent></Card>;
}
