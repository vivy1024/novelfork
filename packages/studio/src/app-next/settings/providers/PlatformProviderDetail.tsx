import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Unplug,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import type {
  RuntimeClineBalance,
  RuntimeClineModel,
  RuntimeClineRecommendedModels,
  RuntimeClineProviderSettings,
  RuntimeCodexFingerprint,
  RuntimeCredentialUsage,
  RuntimePlatformAccountSnapshot,
  RuntimePlatformCredential,
  RuntimePlatformProvidersClient,
  RuntimeProviderProxySettings,
  RuntimeSettings,
  RuntimeSettingsPatch,
} from "../../runtime-admin";
import {
  buildRuntimeClineModelOptions,
  buildRuntimePlatformModelOptions,
  getRuntimeAgentModelState,
  normalizeProviderProxy,
  type RuntimeAgentModelState,
  type RuntimeModelOption,
} from "../runtime-settings-utils";
import { ModelInventoryRow } from "./ApiProviderDetail";

export type PlatformProviderKind = "kiro" | "codex" | "cline";

export interface PlatformProviderDetailProps {
  readonly platform: PlatformProviderKind;
  readonly settings: RuntimeSettings;
  readonly client: Partial<RuntimePlatformProvidersClient>;
  readonly busy?: boolean;
  readonly agentModels?: RuntimeAgentModelState;
  readonly onBack: () => void;
  readonly onPatchSettings: (patch: RuntimeSettingsPatch) => Promise<RuntimeSettings>;
  readonly onReloadSettings: () => Promise<RuntimeSettings>;
  readonly onUpdateAgentModels?: (state: RuntimeAgentModelState) => Promise<void>;
  readonly onTestModel?: (model: string, prompt: string) => Promise<string>;
}

interface CodexSettingsDraft {
  readonly proxy?: RuntimeProviderProxySettings;
  readonly defaultReasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max" | null;
  readonly useWebSearch?: boolean;
  readonly useImageGeneration?: boolean;
}

interface CredentialEditDraft {
  readonly displayName: string;
  readonly priority: string;
  readonly email: string;
  readonly region: string;
}

interface ConfirmState {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly execute: () => Promise<void>;
}

const PROXY_MODE_OPTIONS = [
  { value: "default", label: "继承统一代理" },
  { value: "system", label: "跟随系统环境变量" },
  { value: "direct", label: "直接连接" },
  { value: "custom", label: "自定义代理" },
] as const;

const CODEX_REASONING_OPTIONS = [
  { value: "", label: "继承 Agent 默认" },
  { value: "none", label: "关闭思考" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "很高" },
  { value: "max", label: "最高" },
] as const;

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function accountSnapshotFrom(status: {
  readonly snapshot?: RuntimePlatformAccountSnapshot;
  readonly total?: number;
  readonly available?: number | boolean;
  readonly currentId?: string;
  readonly loadBalancingMode?: "priority" | "balanced" | "tier-balanced";
  readonly entries?: readonly RuntimePlatformCredential[];
  readonly credentials?: readonly RuntimePlatformCredential[];
  readonly accounts?: readonly RuntimePlatformCredential[];
} | null): RuntimePlatformAccountSnapshot | undefined {
  if (!status) return undefined;
  if (status.snapshot) return status.snapshot;
  if (
    status.entries !== undefined
    || status.credentials !== undefined
    || status.accounts !== undefined
    || status.total !== undefined
    || status.available !== undefined
    || status.currentId !== undefined
    || status.loadBalancingMode !== undefined
  ) {
    return {
      total: status.total,
      available: typeof status.available === "number" ? status.available : undefined,
      currentId: status.currentId,
      loadBalancingMode: status.loadBalancingMode,
      entries: status.entries,
      credentials: status.credentials,
      accounts: status.accounts,
    };
  }
  return undefined;
}

function entriesFrom(snapshot: RuntimePlatformAccountSnapshot | null | undefined): readonly RuntimePlatformCredential[] {
  return snapshot?.entries ?? snapshot?.credentials ?? snapshot?.accounts ?? [];
}

function labelForCredential(entry: RuntimePlatformCredential): string {
  return entry.displayName || entry.email || entry.name || entry.id;
}

type KiroTier = "pro" | "free" | "enterprise" | "unknown";

function classifyKiroTier(credential: RuntimePlatformCredential): KiroTier {
  const raw = ((credential.tier ?? "") + " " + (credential.subscriptionTitle ?? "")).toLowerCase();
  if (raw.includes("pro")) return "pro";
  if (raw.includes("free") || raw.includes("builder")) return "free";
  if (raw.includes("enterprise")) return "enterprise";
  return "unknown";
}

const KIRO_TIER_LABEL: Record<KiroTier, string> = {
  pro: "Pro",
  free: "Free / Builder",
  enterprise: "Enterprise",
  unknown: "未知套餐",
};

const KIRO_TIER_ORDER: readonly KiroTier[] = ["enterprise", "pro", "free", "unknown"];

function platformTitle(platform: PlatformProviderKind): string {
  switch (platform) {
    case "kiro": return "Kiro 账号池";
    case "codex": return "内建 Codex 账号池";
    case "cline": return "Cline 平台";
  }
}

function platformDescription(platform: PlatformProviderKind): string {
  switch (platform) {
    case "kiro": return "管理 Kiro 凭据池、模型刷新和专属网络策略；不会写入自定义 API 列表。";
    case "codex": return "管理 Runtime 内建的 Codex OAuth 账号池、负载均衡和原生工具开关。";
    case "cline": return "管理 Cline 授权、模型目录和专属连接配置；不会混入普通 API Key。";
  }
}

function hasProxyUrl(proxy: RuntimeProviderProxySettings | undefined): boolean {
  return proxy?.mode === "custom";
}

function proxyMode(proxy: RuntimeProviderProxySettings | undefined): "default" | "system" | "direct" | "custom" {
  return proxy?.mode ?? "default";
}

function PlatformHeader({ platform, onBack }: { readonly platform: PlatformProviderKind; readonly onBack: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          返回供应商列表
        </Button>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{platformTitle(platform)}</h2>
        <p className="text-sm text-muted-foreground">{platformDescription(platform)}</p>
      </div>
      <Badge variant="outline">平台供应商</Badge>
    </div>
  );
}

function RuntimeRouteUnavailable({ platform }: { readonly platform: PlatformProviderKind }) {
  return (
    <Alert>
      <AlertTitle>当前 Runtime 未提供 {platformTitle(platform)} 管理接口</AlertTitle>
      <AlertDescription>升级或连接支持该平台能力的 Runtime 后，可在此直接管理账号与模型。</AlertDescription>
    </Alert>
  );
}

function StatusMetric({ label, value }: { readonly label: string; readonly value: string | number }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>;
}

function ToggleField({ label, description, checked, onCheckedChange }: { readonly label: string; readonly description: string; readonly checked: boolean; readonly onCheckedChange: (checked: boolean) => void }) {
  return <Field orientation="horizontal" className="rounded-lg border p-3"><FieldContent><FieldTitle>{label}</FieldTitle><FieldDescription>{description}</FieldDescription></FieldContent><Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} /></Field>;
}

function UsageSnapshot({ usage }: { readonly usage: RuntimeCredentialUsage }) {
  const record = recordOf(usage);
  const used = numberOf(record.used ?? record.usage ?? record.usedPercent);
  const limit = numberOf(record.limit ?? record.total ?? record.quota);
  const remaining = numberOf(record.remaining);
  const explicitPercent = numberOf(record.percent ?? record.percentage);
  const percent = explicitPercent ?? (used != null && limit != null && limit > 0 ? (used / limit) * 100 : null);
  const resetAt = stringOf(record.resetAt ?? record.reset_at ?? record.resetTime);
  const rawWindows = Array.isArray(record.windows) ? record.windows : [];

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        {used != null ? <span>已用：<strong className="text-foreground">{used}</strong></span> : null}
        {limit != null ? <span>总额：<strong className="text-foreground">{limit}</strong></span> : null}
        {remaining != null ? <span>剩余：<strong className="text-foreground">{remaining}</strong></span> : null}
        {resetAt ? <span>重置：<strong className="text-foreground">{resetAt}</strong></span> : null}
      </div>
      {percent != null ? <Progress value={Math.max(0, Math.min(percent, 100))} aria-label={`配额已使用 ${Math.round(percent)}%`} /> : null}
      {rawWindows.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {rawWindows.map((window, index) => {
            const current = recordOf(window);
            const windowUsed = numberOf(current.used);
            const windowLimit = numberOf(current.limit);
            const windowPercent = numberOf(current.percent) ?? (windowUsed != null && windowLimit != null && windowLimit > 0 ? (windowUsed / windowLimit) * 100 : null);
            return (
              <div key={`${stringOf(current.label) ?? "window"}-${index}`} className="rounded border bg-background p-2">
                <p className="font-medium">{stringOf(current.label) ?? `配额窗口 ${index + 1}`}</p>
                <p className="text-muted-foreground">{windowUsed ?? "—"} / {windowLimit ?? "—"}</p>
                {windowPercent != null ? <Progress className="mt-1" value={Math.max(0, Math.min(windowPercent, 100))} /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {used == null && limit == null && remaining == null && rawWindows.length === 0 ? <span className="text-muted-foreground">Runtime 已返回用量结果，但没有可展示的标准化额度字段。</span> : null}
    </div>
  );
}

function CredentialPool({
  title,
  entries,
  currentId,
  action,
  busy,
  usageCache,
  allowKiroMetadata = false,
  selectable = false,
  selectedIds = new Set<string>(),
  onToggleSelected,
  onEnable,
  onDisable,
  onRefresh,
  onReset,
  onUsage,
  onEdit,
  onDelete,
}: {
  readonly title: string;
  readonly entries: readonly RuntimePlatformCredential[];
  readonly currentId?: string;
  readonly action: string | null;
  readonly busy: boolean;
  readonly usageCache?: Readonly<Record<string, RuntimeCredentialUsage>>;
  readonly allowKiroMetadata?: boolean;
  readonly selectable?: boolean;
  readonly selectedIds?: ReadonlySet<string>;
  readonly onToggleSelected?: (id: string) => void;
  readonly onEnable?: (id: string) => void;
  readonly onDisable?: (id: string) => void;
  readonly onRefresh?: (id: string) => void;
  readonly onReset?: (id: string) => void;
  readonly onUsage?: (id: string) => Promise<RuntimeCredentialUsage>;
  readonly onEdit?: (id: string, patch: { readonly displayName?: string; readonly priority?: number; readonly email?: string; readonly region?: string }) => Promise<void>;
  readonly onDelete?: (id: string) => void;
}) {
  const [usageById, setUsageById] = useState<Readonly<Record<string, RuntimeCredentialUsage>>>(usageCache ?? {});
  const [usageLoading, setUsageLoading] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<RuntimePlatformCredential | null>(null);
  const [editDraft, setEditDraft] = useState<CredentialEditDraft>({ displayName: "", priority: "0", email: "", region: "" });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => setUsageById(usageCache ?? {}), [usageCache]);

  function openEdit(entry: RuntimePlatformCredential) {
    setEditTarget(entry);
    setEditDraft({
      displayName: entry.displayName ?? entry.name ?? "",
      priority: String(entry.priority ?? 0),
      email: entry.email ?? "",
      region: entry.region ?? "",
    });
  }

  async function queryUsage(id: string) {
    if (!onUsage) return;
    setUsageLoading(id);
    try {
      const usage = await onUsage(id);
      setUsageById((current) => ({ ...current, [id]: usage }));
    } finally {
      setUsageLoading(null);
    }
  }

  async function saveEdit() {
    if (!editTarget || !onEdit) return;
    const priority = Math.max(0, Math.floor(Number(editDraft.priority) || 0));
    await onEdit(editTarget.id, {
      displayName: editDraft.displayName.trim() || undefined,
      priority,
      ...(allowKiroMetadata ? {
        email: editDraft.email.trim() || undefined,
        region: editDraft.region.trim() || undefined,
      } : {}),
    });
    setEditTarget(null);
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.execute();
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{entries.length ? `共 ${entries.length} 个凭据；可直接查看额度、编辑优先级并管理失败账号。` : "当前账号池没有可用凭据。"}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {entries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                {selectable ? <TableHead>选择</TableHead> : null}
                <TableHead>账号</TableHead>
                <TableHead>状态与套餐</TableHead>
                <TableHead>优先级</TableHead>
                <TableHead>用量</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const active = entry.id === currentId;
                const changing = action?.endsWith(`:${entry.id}`) ?? false;
                const usage = usageById[entry.id];
                return (
                  <TableRow key={entry.id}>
                    {selectable ? (
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant={selectedIds.has(entry.id) ? "secondary" : "outline"}
                          aria-pressed={selectedIds.has(entry.id)}
                          aria-label={`${selectedIds.has(entry.id) ? "取消选择" : "选择"}凭据 ${labelForCredential(entry)}`}
                          onClick={() => onToggleSelected?.(entry.id)}
                          disabled={busy || changing}
                        >
                          {selectedIds.has(entry.id) ? "已选" : "选择"}
                        </Button>
                      </TableCell>
                    ) : null}
                    <TableCell className="align-top">
                      <div className="flex min-w-48 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1"><span className="font-medium">{labelForCredential(entry)}</span>{active ? <Badge>当前使用</Badge> : null}</div>
                        <span className="font-mono text-xs text-muted-foreground">{entry.id}</span>
                        {entry.region ? <span className="text-xs text-muted-foreground">区域：{entry.region}</span> : null}
                        {entry.expiresAt ? <span className="text-xs text-muted-foreground">到期：{entry.expiresAt}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap gap-1"><Badge variant={entry.disabled ? "secondary" : "outline"}>{entry.disabled ? "已停用" : "可用"}</Badge>{entry.tier ? <Badge variant="secondary">{entry.tier}</Badge> : null}{entry.disabledReason ? <Badge variant="destructive">{entry.disabledReason}</Badge> : null}</div>
                      <p className="mt-1 text-xs text-muted-foreground">成功 {entry.successCount ?? 0} · 失败 {entry.failureCount ?? 0}</p>
                    </TableCell>
                    <TableCell className="align-top">{entry.priority ?? 0}</TableCell>
                    <TableCell className="align-top">
                      {usage ? <UsageSnapshot usage={usage} /> : <span className="text-xs text-muted-foreground">尚未查询</span>}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap justify-end gap-1">
                        {entry.disabled ? <Button type="button" variant="outline" size="sm" onClick={() => onEnable?.(entry.id)} disabled={!onEnable || changing || busy}>启用</Button> : <Button type="button" variant="outline" size="sm" onClick={() => onDisable?.(entry.id)} disabled={!onDisable || changing || busy}>停用</Button>}
                        {onUsage ? <Button type="button" variant="outline" size="sm" onClick={() => void queryUsage(entry.id)} disabled={usageLoading === entry.id || changing || busy}>{usageLoading === entry.id ? "查询中…" : "用量"}</Button> : null}
                        {onEdit ? <Button type="button" variant="outline" size="sm" onClick={() => openEdit(entry)} disabled={changing || busy}><Pencil data-icon="inline-start" />编辑</Button> : null}
                        {onRefresh ? <Button type="button" variant="outline" size="sm" onClick={() => onRefresh(entry.id)} disabled={changing || busy}><RefreshCw data-icon="inline-start" />刷新</Button> : null}
                        {onReset ? <Button type="button" variant="outline" size="sm" onClick={() => onReset(entry.id)} disabled={changing || busy}><RotateCcw data-icon="inline-start" />重置</Button> : null}
                        {onDelete ? <Button type="button" variant="destructive" size="sm" onClick={() => setConfirm({ title: "删除凭据", description: `将永久删除 ${labelForCredential(entry)}，此操作不可撤销。`, actionLabel: "删除凭据", execute: async () => onDelete(entry.id) })} disabled={changing || busy}><Trash2 data-icon="inline-start" />删除</Button> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : <p className="text-sm text-muted-foreground">暂无凭据。请使用上方登录或导入操作添加账号。</p>}
      </CardContent>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑账号凭据</DialogTitle><DialogDescription>修改账号显示信息和调度优先级；保存后由 Runtime 立即应用。</DialogDescription></DialogHeader>
          <FieldGroup>
            <Field><FieldLabel htmlFor="platform-credential-name">显示名称</FieldLabel><Input id="platform-credential-name" value={editDraft.displayName} onChange={(event) => setEditDraft((current) => ({ ...current, displayName: event.currentTarget.value }))} /></Field>
            <Field><FieldLabel htmlFor="platform-credential-priority">优先级</FieldLabel><Input id="platform-credential-priority" type="number" min={0} value={editDraft.priority} onChange={(event) => setEditDraft((current) => ({ ...current, priority: event.currentTarget.value }))} /></Field>
            {allowKiroMetadata ? <><Field><FieldLabel htmlFor="platform-credential-email">账号邮箱</FieldLabel><Input id="platform-credential-email" type="email" value={editDraft.email} onChange={(event) => setEditDraft((current) => ({ ...current, email: event.currentTarget.value }))} /></Field><Field><FieldLabel htmlFor="platform-credential-region">区域</FieldLabel><Input id="platform-credential-region" value={editDraft.region} onChange={(event) => setEditDraft((current) => ({ ...current, region: event.currentTarget.value }))} /></Field></> : null}
          </FieldGroup>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setEditTarget(null)}>取消</Button><Button type="button" onClick={() => void saveEdit()} disabled={!onEdit || busy}><Save data-icon="inline-start" />保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open && !confirmBusy) setConfirm(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{confirm?.title ?? "确认操作"}</DialogTitle><DialogDescription>{confirm?.description}</DialogDescription></DialogHeader>
          <DialogFooter><Button type="button" variant="outline" disabled={confirmBusy} onClick={() => setConfirm(null)}>取消</Button><Button type="button" variant="destructive" disabled={confirmBusy} onClick={() => void runConfirm()}>{confirmBusy ? "处理中…" : confirm?.actionLabel}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PlatformModelInventory({
  title,
  description,
  providerPrefix,
  modelOptions,
  agentModels,
  busy,
  onUpdateAgentModels,
  onTestModel,
}: {
  readonly title: string;
  readonly description: string;
  readonly providerPrefix: string;
  readonly modelOptions: readonly RuntimeModelOption[];
  readonly agentModels: RuntimeAgentModelState;
  readonly busy: boolean;
  readonly onUpdateAgentModels?: (state: RuntimeAgentModelState) => Promise<void>;
  readonly onTestModel?: (model: string, prompt: string) => Promise<string>;
}) {
  const [customModelId, setCustomModelId] = useState("");
  const [customModelLabel, setCustomModelLabel] = useState("");
  const [testPrompt, setTestPrompt] = useState("请用一句话确认连接正常。");
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const customModels = useMemo(() => new Map(agentModels.customModels.map((model) => [model.value, model])), [agentModels.customModels]);

  async function patch(next: RuntimeAgentModelState) {
    if (!onUpdateAgentModels) return;
    setError(null);
    try {
      await onUpdateAgentModels(next);
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }

  async function testModel(model: string) {
    if (!onTestModel || !testPrompt.trim()) return;
    setTestingModel(model);
    setResult(null);
    setError(null);
    try {
      const text = await onTestModel(model, testPrompt.trim());
      setResult(`${model}：${text || "模型已响应，但未返回文本。"}`);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setTestingModel(null);
    }
  }

  async function addCustomModel() {
    const raw = customModelId.trim();
    const modelId = raw.startsWith(`${providerPrefix}:`) ? raw.slice(providerPrefix.length + 1) : raw;
    if (!modelId || !onUpdateAgentModels) return;
    const value = `${providerPrefix}:${modelId}`;
    if (modelOptions.some((model) => model.value === value)) {
      setError(`${value} 已存在于模型库存。`);
      return;
    }
    await patch({
      ...agentModels,
      customModels: [...agentModels.customModels, { value, label: customModelLabel.trim() || modelId, provider: providerPrefix }],
    });
    setCustomModelId("");
    setCustomModelLabel("");
  }

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field><FieldLabel htmlFor={`${providerPrefix}-test-prompt`}>模型测试提示词</FieldLabel><Input id={`${providerPrefix}-test-prompt`} aria-label={`${title} 测试提示词`} value={testPrompt} onChange={(event) => setTestPrompt(event.currentTarget.value)} /></Field>
        {result ? <Alert><AlertTitle>模型响应</AlertTitle><AlertDescription>{result}</AlertDescription></Alert> : null}
        {error ? <Alert><AlertTitle>模型操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {modelOptions.length > 0 ? modelOptions.map((model) => (
          <ModelInventoryRow
            key={model.value}
            model={model}
            customModel={customModels.get(model.value)}
            contextWindowOverride={agentModels.modelContextWindows[model.value]}
            testing={testingModel === model.value}
            busy={busy || !onUpdateAgentModels}
            onToggleHidden={() => void patch({ ...agentModels, hiddenModels: model.hidden ? agentModels.hiddenModels.filter((value) => value !== model.value) : [...new Set([...agentModels.hiddenModels, model.value])] })}
            onContextWindowChange={(size) => {
              const next = { ...agentModels.modelContextWindows };
              if (size == null) delete next[model.value]; else next[model.value] = size;
              void patch({ ...agentModels, modelContextWindows: next });
            }}
            onCustomLabelChange={(label) => void patch({ ...agentModels, customModels: agentModels.customModels.map((entry) => entry.value === model.value ? { ...entry, label } : entry) })}
            onDeleteCustom={() => void patch({ ...agentModels, hiddenModels: agentModels.hiddenModels.filter((value) => value !== model.value), customModels: agentModels.customModels.filter((entry) => entry.value !== model.value) })}
            onTest={() => void testModel(model.value)}
          />
        )) : <p className="text-sm text-muted-foreground">暂无已发现模型。刷新目录或添加自定义模型后将在此显示。</p>}
        <FieldSeparator>添加自定义模型</FieldSeparator>
        <FieldGroup className="sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <Field><FieldLabel htmlFor={`${providerPrefix}-custom-model-id`}>模型 ID</FieldLabel><Input id={`${providerPrefix}-custom-model-id`} value={customModelId} disabled={busy || !onUpdateAgentModels} onChange={(event) => setCustomModelId(event.currentTarget.value)} placeholder="模型 ID" /></Field>
          <Field><FieldLabel htmlFor={`${providerPrefix}-custom-model-label`}>显示名称</FieldLabel><Input id={`${providerPrefix}-custom-model-label`} value={customModelLabel} disabled={busy || !onUpdateAgentModels} onChange={(event) => setCustomModelLabel(event.currentTarget.value)} placeholder="可选" /></Field>
          <Button type="button" variant="outline" onClick={() => void addCustomModel()} disabled={busy || !onUpdateAgentModels || !customModelId.trim()}>添加模型</Button>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

export function PlatformProviderDetail(props: PlatformProviderDetailProps) {
  switch (props.platform) {
    case "kiro": return <KiroPlatformDetail {...props} />;
    case "codex": return <CodexPlatformDetail {...props} />;
    case "cline": return <ClinePlatformDetail {...props} />;
  }
}

function KiroGroupedCredentialPool({
  entries,
  currentId,
  action,
  busy,
  usageCache,
  onEnable,
  onDisable,
  onRefresh,
  onReset,
  onUsage,
  onEdit,
  onDelete,
}: {
  readonly entries: readonly RuntimePlatformCredential[];
  readonly currentId?: string;
  readonly action: string | null;
  readonly busy: boolean;
  readonly usageCache?: Readonly<Record<string, RuntimeCredentialUsage>>;
  readonly onEnable?: (id: string) => void;
  readonly onDisable?: (id: string) => void;
  readonly onRefresh?: (id: string) => void;
  readonly onReset?: (id: string) => void;
  readonly onUsage?: (id: string) => Promise<RuntimeCredentialUsage>;
  readonly onEdit?: (id: string, patch: { readonly displayName?: string; readonly priority?: number; readonly email?: string; readonly region?: string }) => Promise<void>;
  readonly onDelete?: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<KiroTier, RuntimePlatformCredential[]>();
    for (const entry of entries) {
      const tier = classifyKiroTier(entry);
      const group = map.get(tier) ?? [];
      group.push(entry);
      map.set(tier, group);
    }
    return KIRO_TIER_ORDER
      .filter((tier) => map.has(tier))
      .map((tier) => ({ tier, entries: map.get(tier)! }));
  }, [entries]);

  if (grouped.length <= 1) {
    return <CredentialPool title="Kiro 凭据" entries={entries} currentId={currentId} action={action} busy={busy} usageCache={usageCache} allowKiroMetadata onEnable={onEnable} onDisable={onDisable} onRefresh={onRefresh} onReset={onReset} onUsage={onUsage} onEdit={onEdit} onDelete={onDelete} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(({ tier, entries: groupEntries }) => (
        <div key={tier} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{KIRO_TIER_LABEL[tier]}</Badge>
            <span className="text-xs text-muted-foreground">{groupEntries.length} 个账号</span>
          </div>
          <CredentialPool title={`Kiro 凭据 — ${KIRO_TIER_LABEL[tier]}`} entries={groupEntries} currentId={currentId} action={action} busy={busy} usageCache={usageCache} allowKiroMetadata onEnable={onEnable} onDisable={onDisable} onRefresh={onRefresh} onReset={onReset} onUsage={onUsage} onEdit={onEdit} onDelete={onDelete} />
        </div>
      ))}
    </div>
  );
}

function KiroPlatformDetail({ settings, client, busy = false, agentModels = getRuntimeAgentModelState(settings), onBack, onPatchSettings, onReloadSettings, onUpdateAgentModels, onTestModel }: PlatformProviderDetailProps) {
  const [status, setStatus] = useState<Awaited<ReturnType<NonNullable<typeof client.kiroStatus>>> | null>(null);
  const [loading, setLoading] = useState(Boolean(client.kiroStatus));
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [draftProxy, setDraftProxy] = useState<RuntimeProviderProxySettings | undefined>(settings.kiro?.proxy as RuntimeProviderProxySettings | undefined);
  const modelOptions = useMemo(() => buildRuntimePlatformModelOptions(settings, "kiro", { includeHidden: true }), [settings]);

  const reloadStatus = async () => {
    if (!client.kiroStatus) return;
    setLoading(true);
    try { setStatus(await client.kiroStatus()); setError(null); } catch (reason) { setError(messageFrom(reason)); } finally { setLoading(false); }
  };

  useEffect(() => { void reloadStatus(); }, []);
  useEffect(() => { setDraftProxy(settings.kiro?.proxy as RuntimeProviderProxySettings | undefined); }, [settings.kiro]);

  const snapshot = accountSnapshotFrom(status);
  const entries = entriesFrom(snapshot);

  async function runAction(label: string, fn: () => Promise<unknown>, refresh = true) {
    setAction(label); setError(null);
    try { await fn(); if (refresh) await reloadStatus(); await onReloadSettings(); } catch (reason) { setError(messageFrom(reason)); } finally { setAction(null); }
  }

  async function importCredentials() {
    if (!client.kiroImportCredentials || !importText.trim()) return;
    try {
      const parsed: unknown = JSON.parse(importText);
      const credentials = Array.isArray(parsed) ? parsed : [parsed];
      await runAction("import", async () => { await client.kiroImportCredentials?.(credentials); setImportText(""); });
    } catch { setError("凭据内容必须是 JSON 对象或 JSON 数组。"); }
  }

  if (!client.kiroStatus) return <section aria-label="Kiro 平台供应商" className="flex flex-col gap-6"><PlatformHeader platform="kiro" onBack={onBack} /><RuntimeRouteUnavailable platform="kiro" /></section>;

  return (
    <section aria-label="Kiro 平台供应商" className="flex flex-col gap-6">
      <PlatformHeader platform="kiro" onBack={onBack} />
      {error ? <Alert><AlertTitle>Kiro 操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Card>
        <CardHeader><CardTitle>账号池状态</CardTitle><CardDescription>Runtime 会根据负载均衡策略选择可用 Kiro 凭据，并异步更新额度信息。</CardDescription><CardAction><Button type="button" variant="outline" size="sm" onClick={() => void reloadStatus()} disabled={loading || busy}><RefreshCw data-icon="inline-start" />{loading ? "刷新中…" : "刷新状态"}</Button></CardAction></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3"><StatusMetric label="账号总数" value={snapshot?.total ?? entries.length} /><StatusMetric label="可用账号" value={snapshot?.available ?? entries.filter((entry) => !entry.disabled).length} /><StatusMetric label="当前策略" value={snapshot?.loadBalancingMode === "balanced" ? "均衡" : "优先级"} /></CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-3"><SimpleSelect aria-label="Kiro 负载均衡" value={snapshot?.loadBalancingMode === "balanced" ? "balanced" : "priority"} onValueChange={(value) => client.kiroSetLoadBalancingMode && void runAction("load-balancing", () => client.kiroSetLoadBalancingMode?.(value as "priority" | "balanced") ?? Promise.resolve())} options={[{ value: "priority", label: "按优先级" }, { value: "balanced", label: "均衡使用" }]} /><Button type="button" variant="outline" onClick={() => client.kiroRefreshModels && void runAction("models", client.kiroRefreshModels)} disabled={!client.kiroRefreshModels || action === "models" || busy}><RefreshCw data-icon="inline-start" />{action === "models" ? "刷新中…" : "刷新模型"}</Button></CardFooter>
      </Card>
      <Card><CardHeader><CardTitle>网络策略</CardTitle><CardDescription>只覆盖 Kiro；“继承统一代理”继续使用 Runtime 的全局代理配置。</CardDescription></CardHeader><CardContent><FieldGroup className="sm:grid sm:grid-cols-2"><Field><FieldLabel>Kiro 代理策略</FieldLabel><SimpleSelect aria-label="Kiro 代理策略" value={proxyMode(draftProxy)} onValueChange={(value) => setDraftProxy(normalizeProviderProxy(value as "default" | "system" | "direct" | "custom", draftProxy?.url))} options={[...PROXY_MODE_OPTIONS]} /></Field>{hasProxyUrl(draftProxy) ? <Field><FieldLabel htmlFor="kiro-proxy-url">代理 URL</FieldLabel><Input id="kiro-proxy-url" aria-label="Kiro 代理 URL" value={draftProxy?.url ?? ""} onChange={(event) => setDraftProxy(normalizeProviderProxy("custom", event.currentTarget.value))} placeholder="http://127.0.0.1:7890" /></Field> : null}</FieldGroup></CardContent><CardFooter className="justify-end"><Button type="button" onClick={() => void runAction("proxy", () => onPatchSettings({ kiro: { proxy: draftProxy } }))} disabled={busy || action === "proxy"}><Save data-icon="inline-start" />保存 Kiro 网络策略</Button></CardFooter></Card>
      <Card><CardHeader><CardTitle>导入凭据</CardTitle><CardDescription>粘贴 Runtime 支持的 Kiro 凭据 JSON；账号会留在独立 Kiro 池中。</CardDescription></CardHeader><CardContent><Textarea aria-label="Kiro 凭据 JSON" value={importText} onChange={(event) => setImportText(event.currentTarget.value)} placeholder={'[{\n  "refreshToken": "…"\n}]'} rows={5} /></CardContent><CardFooter className="justify-end"><Button type="button" onClick={() => void importCredentials()} disabled={!importText.trim() || action === "import" || busy || !client.kiroImportCredentials}><KeyRound data-icon="inline-start" />{action === "import" ? "导入中…" : "导入 Kiro 凭据"}</Button></CardFooter></Card>
      <KiroGroupedCredentialPool entries={entries} currentId={snapshot?.currentId} action={action} busy={busy} usageCache={status?.usageCache} onEnable={(id) => client.kiroEnableCredential && void runAction(`enable:${id}`, () => client.kiroEnableCredential?.(id) ?? Promise.resolve())} onDisable={(id) => client.kiroDisableCredential && void runAction(`disable:${id}`, () => client.kiroDisableCredential?.(id) ?? Promise.resolve())} onRefresh={(id) => client.kiroRefreshCredential && void runAction(`refresh:${id}`, () => client.kiroRefreshCredential?.(id) ?? Promise.resolve())} onReset={(id) => client.kiroResetCredential && void runAction(`reset:${id}`, () => client.kiroResetCredential?.(id) ?? Promise.resolve())} onUsage={client.kiroGetCredentialUsage} onEdit={async (id, patch) => { await runAction(`edit:${id}`, async () => { const metadata = { displayName: patch.displayName, email: patch.email, region: patch.region }; if (client.kiroUpdateCredential && Object.values(metadata).some(Boolean)) await client.kiroUpdateCredential(id, metadata); if (client.kiroSetCredentialPriority && patch.priority != null) await client.kiroSetCredentialPriority(id, patch.priority); }); }} onDelete={(id) => client.kiroDeleteCredential && void runAction(`delete:${id}`, () => client.kiroDeleteCredential?.(id) ?? Promise.resolve())} />
      <PlatformModelInventory title="Kiro 模型库存" description="管理 Kiro 模型的隐藏状态、上下文覆盖、自定义条目和连通性测试。" providerPrefix="kiro" modelOptions={modelOptions} agentModels={agentModels} busy={busy} onUpdateAgentModels={onUpdateAgentModels} onTestModel={onTestModel} />
    </section>
  );
}

function CodexQuotaOverview({ status, entries }: {
  readonly status: Record<string, unknown> | null;
  readonly entries: readonly RuntimePlatformCredential[];
}) {
  const quota = useMemo(() => {
    // 优先从 status.quotaOverview 取
    const raw = status ? recordOf((status as Record<string, unknown>).quotaOverview) : {};
    const used = numberOf(raw.used);
    const total = numberOf(raw.total ?? raw.limit);
    const resetAt = stringOf(raw.resetAt ?? raw.reset_at ?? raw.resetTime);
    if (used != null && total != null) return { used, total, resetAt };
    // 回退：从凭据 usage 汇总
    let sumUsed = 0;
    let sumTotal = 0;
    let hasData = false;
    for (const entry of entries) {
      const usage = recordOf((entry as Record<string, unknown>).usage);
      const u = numberOf(usage.used ?? usage.usage);
      const t = numberOf(usage.total ?? usage.limit ?? usage.quota);
      if (u != null) { sumUsed += u; hasData = true; }
      if (t != null) { sumTotal += t; hasData = true; }
    }
    if (!hasData) return null;
    return { used: sumUsed, total: sumTotal, resetAt: null as string | null };
  }, [status, entries]);

  if (!quota) return null;

  const percent = quota.total > 0 ? (quota.used / quota.total) * 100 : 0;
  const progressColor = percent >= 90 ? "text-destructive" : percent >= 70 ? "text-warning" : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>配额概览</CardTitle>
        <CardDescription>Codex 账号池总体配额使用状况。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>已用：<strong>{quota.used}</strong></span>
          <span>总额：<strong>{quota.total}</strong></span>
          {quota.resetAt ? <span>重置时间：<strong>{quota.resetAt}</strong></span> : null}
        </div>
        <div className={progressColor}>
          <Progress value={Math.max(0, Math.min(percent, 100))} aria-label={`Codex 配额已使用 ${Math.round(percent)}%`} />
        </div>
        <p className="text-xs text-muted-foreground">已使用 {Math.round(percent)}%</p>
      </CardContent>
    </Card>
  );
}

function CodexPlatformDetail({ settings, client, busy = false, agentModels = getRuntimeAgentModelState(settings), onBack, onPatchSettings, onReloadSettings, onUpdateAgentModels, onTestModel }: PlatformProviderDetailProps) {
  const [status, setStatus] = useState<Awaited<ReturnType<NonNullable<typeof client.codexStatus>>> | null>(null);
  const [fingerprint, setFingerprint] = useState<RuntimeCodexFingerprint | null>(null);
  const [loading, setLoading] = useState(Boolean(client.codexStatus));
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [deviceAuth, setDeviceAuth] = useState<{ userCode?: string; verificationUri?: string; verificationUriComplete?: string } | null>(null);
  const [browserAuthPending, setBrowserAuthPending] = useState(false);
  const [tierOrder, setTierOrder] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [fingerprintHeaders, setFingerprintHeaders] = useState("{}");
  const codexSettings = (settings.codex ?? {}) as CodexSettingsDraft;
  const [draft, setDraft] = useState<CodexSettingsDraft>(codexSettings);
  const modelOptions = useMemo(() => buildRuntimePlatformModelOptions(settings, "codex", { includeHidden: true }), [settings]);

  const reloadStatus = async () => {
    if (!client.codexStatus) return;
    setLoading(true);
    try {
      const [nextStatus, nextFingerprint] = await Promise.all([
        client.codexStatus(),
        client.codexGetFingerprint ? client.codexGetFingerprint() : Promise.resolve(null),
      ]);
      setStatus(nextStatus);
      if (nextStatus.tierOrder) setTierOrder([...nextStatus.tierOrder]);
      if (nextFingerprint) { setFingerprint(nextFingerprint); setFingerprintHeaders(JSON.stringify(nextFingerprint.extraHeaders, null, 2)); }
      setError(null);
    } catch (reason) { setError(messageFrom(reason)); } finally { setLoading(false); }
  };

  useEffect(() => { void reloadStatus(); }, []);
  useEffect(() => { setDraft(codexSettings); }, [settings.codex]);
  useEffect(() => {
    if (!deviceAuth || !client.codexPollDeviceAuth) return;
    const timer = window.setInterval(() => { void client.codexPollDeviceAuth?.().then(async (next) => { if (!next.pending) { setDeviceAuth(null); await reloadStatus(); await onReloadSettings(); } }).catch((reason) => setError(messageFrom(reason))); }, 2500);
    return () => window.clearInterval(timer);
  }, [deviceAuth, client.codexPollDeviceAuth]);

  const snapshot = accountSnapshotFrom(status);
  const entries = entriesFrom(snapshot);

  async function runAction(label: string, fn: () => Promise<unknown>, refresh = true) {
    setAction(label); setError(null);
    try { await fn(); if (refresh) await reloadStatus(); await onReloadSettings(); } catch (reason) { setError(messageFrom(reason)); } finally { setAction(null); }
  }

  async function beginBrowserAuth() {
    if (!client.codexBrowserAuth) return;
    await runAction("browser-auth", async () => { const result = await client.codexBrowserAuth?.(); if (!result?.authorizeUrl) throw new Error("Runtime 未返回 Codex 授权地址。"); setBrowserAuthPending(true); window.open(result.authorizeUrl, "_blank", "noopener,noreferrer"); }, false);
  }

  async function beginDeviceAuth() {
    if (!client.codexStartDeviceAuth) return;
    await runAction("device-auth", async () => { const result = await client.codexStartDeviceAuth?.(); if (!result?.verificationUri || !result?.userCode) throw new Error("Runtime 未返回 Codex 设备授权信息。"); setDeviceAuth(result); window.open(result.verificationUriComplete ?? result.verificationUri, "_blank", "noopener,noreferrer"); }, false);
  }

  async function importCredentials() {
    if (!importText.trim()) return;
    if (client.codexImportText) { await runAction("import", async () => { await client.codexImportText?.(importText.trim()); setImportText(""); }); return; }
    if (!client.codexImportCredentials) return;
    try { const parsed: unknown = JSON.parse(importText); const credentials = Array.isArray(parsed) ? parsed : [parsed]; await runAction("import", async () => { await client.codexImportCredentials?.(credentials); setImportText(""); }); } catch { setError("当前 Runtime 不支持文本导入；请输入 JSON 对象或数组。"); }
  }

  function moveTier(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= tierOrder.length) return;
    setTierOrder((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }

  async function saveFingerprint() {
    if (!client.codexUpdateFingerprint || !fingerprint) return;
    let headers: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(fingerprintHeaders || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("请求头必须是 JSON 对象。");
      headers = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
    } catch (reason) { setError(messageFrom(reason)); return; }
    await runAction("fingerprint", async () => { const saved = await client.codexUpdateFingerprint?.({ userAgentMode: fingerprint.userAgentMode, customUserAgent: fingerprint.customUserAgent, extraHeaders: headers, emulateCodexHeaders: fingerprint.emulateCodexHeaders }); if (saved) setFingerprint((current) => current ? { ...current, ...saved } : current); }, false);
  }

  if (!client.codexStatus) return <section aria-label="Codex 平台供应商" className="flex flex-col gap-6"><PlatformHeader platform="codex" onBack={onBack} /><RuntimeRouteUnavailable platform="codex" /></section>;

  return (
    <section aria-label="Codex 平台供应商" className="flex flex-col gap-6">
      <PlatformHeader platform="codex" onBack={onBack} />
      {error ? <Alert><AlertTitle>Codex 操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Card>
        <CardHeader><CardTitle>账号池状态</CardTitle><CardDescription>账号池由 Runtime 内建的 Codex OAuth 管理；不会转换为自定义 Codex Native API Key。</CardDescription><CardAction><Button type="button" variant="outline" size="sm" onClick={() => void reloadStatus()} disabled={loading || busy}><RefreshCw data-icon="inline-start" />{loading ? "刷新中…" : "刷新状态"}</Button></CardAction></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3"><StatusMetric label="账号总数" value={snapshot?.total ?? entries.length} /><StatusMetric label="可用账号" value={snapshot?.available ?? entries.filter((entry) => !entry.disabled).length} /><StatusMetric label="当前策略" value={snapshot?.loadBalancingMode ?? "priority"} /></CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-3"><SimpleSelect aria-label="Codex 负载均衡" value={snapshot?.loadBalancingMode ?? "priority"} onValueChange={(value) => client.codexSetLoadBalancingMode && void runAction("load-balancing", () => client.codexSetLoadBalancingMode?.(value as "priority" | "balanced" | "tier-balanced") ?? Promise.resolve())} options={[{ value: "priority", label: "按优先级" }, { value: "balanced", label: "均衡使用" }, { value: "tier-balanced", label: "按套餐均衡" }]} /><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void beginBrowserAuth()} disabled={!client.codexBrowserAuth || action === "browser-auth" || busy}><ExternalLink data-icon="inline-start" />浏览器登录</Button><Button type="button" variant="outline" onClick={() => void beginDeviceAuth()} disabled={!client.codexStartDeviceAuth || action === "device-auth" || busy}><KeyRound data-icon="inline-start" />设备码登录</Button></div></CardFooter>
        {browserAuthPending ? <CardContent className="border-t pt-4"><Alert><AlertTitle>等待浏览器授权</AlertTitle><AlertDescription>请在已打开的浏览器完成 Codex 登录；完成后刷新状态。<Button type="button" variant="ghost" size="sm" onClick={() => client.codexCancelBrowserAuth && void runAction("cancel-browser-auth", client.codexCancelBrowserAuth, false)} disabled={!client.codexCancelBrowserAuth || action === "cancel-browser-auth"}>取消等待</Button></AlertDescription></Alert></CardContent> : null}
        {deviceAuth ? <CardContent className="border-t pt-4"><Alert><AlertTitle>完成 Codex 设备授权</AlertTitle><AlertDescription>在已打开的授权页输入设备码：<strong className="font-mono">{deviceAuth.userCode}</strong>{deviceAuth.verificationUri ? <span className="block pt-1 break-all">{deviceAuth.verificationUri}</span> : null}</AlertDescription></Alert><div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => client.codexPollDeviceAuth && void client.codexPollDeviceAuth().then((next) => { if (!next.pending) setDeviceAuth(null); })}>检查授权状态</Button><Button type="button" variant="ghost" size="sm" onClick={() => client.codexCancelDeviceAuth && void runAction("cancel-device-auth", client.codexCancelDeviceAuth, false)}>取消</Button></div></CardContent> : null}
      </Card>
      <CodexQuotaOverview status={status} entries={entries} />
      <Card><CardHeader><CardTitle>套餐优先级</CardTitle><CardDescription>仅“按套餐均衡”时使用；通过上下移动调整到由高至低的调度顺序。</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{tierOrder.length ? tierOrder.map((tier, index) => <div key={tier} className="flex items-center gap-2 rounded-lg border p-2"><Badge variant="secondary">{index + 1}</Badge><span className="flex-1 font-mono text-sm">{tier}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={`上移套餐 ${tier}`} disabled={index === 0 || busy} onClick={() => moveTier(index, -1)}><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={`下移套餐 ${tier}`} disabled={index === tierOrder.length - 1 || busy} onClick={() => moveTier(index, 1)}><ArrowDown /></Button></div>) : <p className="text-sm text-muted-foreground">Runtime 尚未返回套餐顺序。</p>}</CardContent><CardFooter className="justify-end"><Button type="button" variant="outline" onClick={() => client.codexSetTierOrder && void runAction("tier-order", () => client.codexSetTierOrder?.(tierOrder) ?? Promise.resolve())} disabled={!client.codexSetTierOrder || tierOrder.length === 0 || busy || action === "tier-order"}><Save data-icon="inline-start" />保存套餐顺序</Button></CardFooter></Card>
      <Card><CardHeader><CardTitle>原生能力与网络</CardTitle><CardDescription>这些设置只影响内建 Codex 账号池，不影响 Custom API 连接。</CardDescription></CardHeader><CardContent><FieldGroup className="sm:grid sm:grid-cols-2"><Field><FieldLabel>Codex 代理策略</FieldLabel><SimpleSelect aria-label="Codex 代理策略" value={proxyMode(draft.proxy)} onValueChange={(value) => setDraft((current) => ({ ...current, proxy: normalizeProviderProxy(value as "default" | "system" | "direct" | "custom", current.proxy?.url) }))} options={[...PROXY_MODE_OPTIONS]} /></Field>{hasProxyUrl(draft.proxy) ? <Field><FieldLabel htmlFor="codex-proxy-url">代理 URL</FieldLabel><Input id="codex-proxy-url" aria-label="Codex 代理 URL" value={draft.proxy?.url ?? ""} onChange={(event) => setDraft((current) => ({ ...current, proxy: normalizeProviderProxy("custom", event.currentTarget.value) }))} placeholder="http://127.0.0.1:7890" /></Field> : null}<Field><FieldLabel>默认推理强度</FieldLabel><SimpleSelect aria-label="Codex 默认推理强度" value={draft.defaultReasoningEffort ?? ""} onValueChange={(value) => setDraft((current) => ({ ...current, defaultReasoningEffort: value ? value as NonNullable<CodexSettingsDraft["defaultReasoningEffort"]> : null }))} options={[...CODEX_REASONING_OPTIONS]} /></Field><ToggleField label="允许 Web Search" description="将原生 web_search 工具提供给 Codex 模型。" checked={draft.useWebSearch !== false} onCheckedChange={(checked) => setDraft((current) => ({ ...current, useWebSearch: checked }))} /><ToggleField label="允许 Image Generation" description="将原生 image_generation 工具提供给 Codex 模型。" checked={draft.useImageGeneration !== false} onCheckedChange={(checked) => setDraft((current) => ({ ...current, useImageGeneration: checked }))} /><ToggleField label="使用 Responses WebSocket" description="通过 Runtime 的原生 WebSocket transport 执行 Codex Responses 请求。" checked={status?.useWebSocket !== false} onCheckedChange={(checked) => client.codexSetUseWebSocket && void runAction("websocket", () => client.codexSetUseWebSocket?.(checked) ?? Promise.resolve())} /></FieldGroup></CardContent><CardFooter className="justify-end"><Button type="button" onClick={() => void runAction("save-settings", () => onPatchSettings({ codex: draft as RuntimeSettingsPatch["codex"] }))} disabled={busy || action === "save-settings"}><Save data-icon="inline-start" />保存 Codex 设置</Button></CardFooter></Card>
      <Card><CardHeader><CardTitle>客户端指纹</CardTitle><CardDescription>管理 Codex 用户代理、额外请求头、稳定头模拟和本机 installation ID。</CardDescription></CardHeader><CardContent>{fingerprint ? <FieldGroup className="sm:grid sm:grid-cols-2"><Field><FieldLabel>客户端指纹</FieldLabel><SimpleSelect aria-label="Codex 客户端指纹" value={fingerprint.userAgentMode} onValueChange={(value) => setFingerprint((current) => current ? { ...current, userAgentMode: value as RuntimeCodexFingerprint["userAgentMode"] } : current)} options={[{ value: "codex", label: "Codex CLI" }, { value: "narrafork", label: "NarraFork 默认" }, { value: "claude-code", label: "Claude Code" }, { value: "custom", label: "自定义" }]} /></Field>{fingerprint.userAgentMode === "custom" ? <Field><FieldLabel htmlFor="codex-custom-user-agent">自定义 User-Agent</FieldLabel><Input id="codex-custom-user-agent" value={fingerprint.customUserAgent} onChange={(event) => setFingerprint((current) => current ? { ...current, customUserAgent: event.currentTarget.value } : current)} /></Field> : null}<Field className="sm:col-span-2"><FieldLabel htmlFor="codex-fingerprint-headers">额外请求头（JSON）</FieldLabel><Textarea id="codex-fingerprint-headers" aria-label="Codex 额外请求头" rows={4} value={fingerprintHeaders} onChange={(event) => setFingerprintHeaders(event.currentTarget.value)} /></Field><ToggleField label="模拟 Codex 稳定请求头" description="保留 Codex CLI 风格的 originator、session 和线程指纹。" checked={fingerprint.emulateCodexHeaders} onCheckedChange={(checked) => setFingerprint((current) => current ? { ...current, emulateCodexHeaders: checked } : current)} /><Field><FieldLabel>Installation ID</FieldLabel><Input value={fingerprint.installationId} readOnly /><FieldDescription>重新生成会让下一次 Codex 请求使用新的设备指纹。</FieldDescription></Field></FieldGroup> : <p className="text-sm text-muted-foreground">正在读取 Runtime 指纹配置。</p>}</CardContent><CardFooter className="flex flex-wrap justify-between gap-2"><Button type="button" variant="outline" onClick={() => client.codexRegenerateInstallationId && void runAction("regenerate-installation", async () => { const result = await client.codexRegenerateInstallationId?.(); if (result) setFingerprint((current) => current ? { ...current, installationId: result.installationId } : current); }, false)} disabled={!client.codexRegenerateInstallationId || busy}>重新生成 Installation ID</Button><Button type="button" onClick={() => void saveFingerprint()} disabled={!fingerprint || !client.codexUpdateFingerprint || busy || action === "fingerprint"}><Save data-icon="inline-start" />保存指纹</Button></CardFooter></Card>
      <Card><CardHeader><CardTitle>导入凭据</CardTitle><CardDescription>粘贴文本、JSON 或嵌套账号导出内容；Runtime 会识别 access token / refresh token。</CardDescription></CardHeader><CardContent><Textarea aria-label="Codex 凭据 JSON" value={importText} onChange={(event) => setImportText(event.currentTarget.value)} placeholder={'[{\n  "refreshToken": "…"\n}]'} rows={5} /></CardContent><CardFooter className="justify-end"><Button type="button" onClick={() => void importCredentials()} disabled={!importText.trim() || (!client.codexImportText && !client.codexImportCredentials) || action === "import" || busy}><KeyRound data-icon="inline-start" />{action === "import" ? "导入中…" : "导入 Codex 凭据"}</Button></CardFooter></Card>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSelectedIds(new Set(entries.map((entry) => entry.id)))} disabled={!entries.length || busy}>全选账号</Button><Button type="button" variant="outline" onClick={() => client.codexDeleteUnhealthyCredentials && setCleanupOpen(true)} disabled={!client.codexDeleteUnhealthyCredentials || busy}>清理异常账号</Button><Button type="button" variant="destructive" onClick={() => client.codexDeleteCredentials && void runAction("batch-delete", () => client.codexDeleteCredentials?.([...selectedIds]) ?? Promise.resolve()).then(() => setSelectedIds(new Set()))} disabled={!client.codexDeleteCredentials || selectedIds.size === 0 || busy}>删除已选 {selectedIds.size ? `(${selectedIds.size})` : ""}</Button></div>
      <CredentialPool title="Codex 凭据" entries={entries} currentId={snapshot?.currentId} action={action} busy={busy} usageCache={status?.usageCache} selectable selectedIds={selectedIds} onToggleSelected={(id) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onEnable={(id) => client.codexEnableCredential && void runAction(`enable:${id}`, () => client.codexEnableCredential?.(id) ?? Promise.resolve())} onDisable={(id) => client.codexDisableCredential && void runAction(`disable:${id}`, () => client.codexDisableCredential?.(id) ?? Promise.resolve())} onRefresh={(id) => client.codexRefreshCredential && void runAction(`refresh:${id}`, () => client.codexRefreshCredential?.(id) ?? Promise.resolve())} onReset={(id) => client.codexResetCredential && void runAction(`reset:${id}`, () => client.codexResetCredential?.(id) ?? Promise.resolve())} onUsage={client.codexGetCredentialUsage} onEdit={(id, patch) => client.codexUpdateCredential ? runAction(`edit:${id}`, () => client.codexUpdateCredential?.(id, { displayName: patch.displayName, priority: patch.priority }) ?? Promise.resolve()) : Promise.resolve()} onDelete={(id) => client.codexDeleteCredential && void runAction(`delete:${id}`, () => client.codexDeleteCredential?.(id) ?? Promise.resolve())} />
      {status?.usageQueue?.items?.length ? <Card><CardHeader><CardTitle>用量查询队列</CardTitle><CardDescription>Runtime 正在异步获取账号额度；完成/失败项目可手动清理。</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{status.usageQueue.items.map((item, index) => <div key={`${item.id ?? item.credentialId ?? "queue"}-${index}`} className="flex flex-wrap justify-between gap-2 rounded border p-2 text-sm"><span className="font-mono">{item.credentialId ?? item.id ?? "账号"}</span><Badge variant={item.status === "failed" ? "destructive" : item.status === "done" ? "secondary" : "outline"}>{item.status ?? "pending"}</Badge>{item.error ? <span className="w-full text-xs text-destructive">{item.error}</span> : null}</div>)}</CardContent><CardFooter className="justify-end"><Button type="button" variant="outline" onClick={() => client.codexClearUsageQueue && void runAction("clear-usage-queue", client.codexClearUsageQueue)} disabled={!client.codexClearUsageQueue || busy}>清理已完成队列</Button></CardFooter></Card> : null}
      <PlatformModelInventory title="Codex 模型库存" description="管理内建 Codex 模型的隐藏状态、上下文覆盖、自定义条目和连通性测试。" providerPrefix="codex" modelOptions={modelOptions} agentModels={agentModels} busy={busy} onUpdateAgentModels={onUpdateAgentModels} onTestModel={onTestModel} />
      <Dialog open={cleanupOpen} onOpenChange={setCleanupOpen}><DialogContent><DialogHeader><DialogTitle>清理异常 Codex 账号</DialogTitle><DialogDescription>将删除已因持续失败或封禁被 Runtime 标记为异常的账号，此操作不可撤销。</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setCleanupOpen(false)}>取消</Button><Button type="button" variant="destructive" onClick={() => client.codexDeleteUnhealthyCredentials && void runAction("delete-unhealthy", client.codexDeleteUnhealthyCredentials).then(() => setCleanupOpen(false))}>清理异常账号</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}

function ClinePlatformDetail({ settings, client, busy = false, agentModels = getRuntimeAgentModelState(settings), onBack, onPatchSettings, onReloadSettings, onUpdateAgentModels, onTestModel }: PlatformProviderDetailProps) {
  const providers = settings.clineProviders ?? [];
  const [providerIndex, setProviderIndex] = useState(0);
  const fallbackProvider = useMemo<RuntimeClineProviderSettings>(() => ({ id: "cline", name: "Cline", prefix: "cline", baseUrl: "https://api.cline.bot/api/v1", defaultModel: "anthropic/claude-sonnet-4", enabledModels: [] }), []);
  const currentProvider = providers[providerIndex] ?? providers[0] ?? fallbackProvider;
  const [draft, setDraft] = useState<RuntimeClineProviderSettings>(currentProvider);
  const [status, setStatus] = useState<Awaited<ReturnType<NonNullable<typeof client.clineStatus>>> | null>(null);
  const [balance, setBalance] = useState<RuntimeClineBalance | null>(null);
  const [recommended, setRecommended] = useState<RuntimeClineRecommendedModels | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<readonly RuntimeClineModel[]>([]);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [loading, setLoading] = useState(Boolean(client.clineStatus));
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modelOptions = useMemo(() => buildRuntimeClineModelOptions(settings, draft, { includeHidden: true }), [settings, draft]);

  const reloadStatus = async () => {
    if (!client.clineStatus) return;
    setLoading(true);
    try {
      const nextStatus = await client.clineStatus();
      const [nextCount, nextBalance, nextRecommended] = await Promise.all([
        client.clinePoolCount ? client.clinePoolCount() : Promise.resolve(null),
        nextStatus.authenticated && client.clineBalance ? client.clineBalance().catch(() => null) : Promise.resolve(null),
        client.clineRecommendedModels ? client.clineRecommendedModels().catch(() => null) : Promise.resolve(null),
      ]);
      setStatus(nextStatus); setPoolCount(nextCount?.count ?? null); setBalance(nextBalance); setRecommended(nextRecommended); setError(null);
    } catch (reason) { setError(messageFrom(reason)); } finally { setLoading(false); }
  };

  useEffect(() => { void reloadStatus(); }, []);
  useEffect(() => { setProviderIndex((index) => Math.min(index, Math.max(providers.length - 1, 0))); }, [providers.length]);
  useEffect(() => { setDraft(currentProvider); }, [currentProvider]);
  useEffect(() => {
    if (!client.clinePoolSearch || search.trim().length < 2) { setSearchResults([]); return; }
    let active = true;
    const timer = window.setTimeout(() => { void client.clinePoolSearch?.(search.trim(), 50).then((result) => { if (active) setSearchResults(result.models); }).catch((reason) => { if (active) setError(messageFrom(reason)); }); }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, client.clinePoolSearch]);

  async function runAction(label: string, fn: () => Promise<unknown>, refresh = true) {
    setAction(label); setError(null);
    try { await fn(); if (refresh) await reloadStatus(); await onReloadSettings(); } catch (reason) { setError(messageFrom(reason)); } finally { setAction(null); }
  }

  async function saveProvider() {
    const next = [...providers]; if (next.length === 0) next.push(draft); else next[providerIndex] = draft;
    await runAction("save-provider", () => onPatchSettings({ clineProviders: next }));
  }

  async function updateEnabledModels(models: readonly string[]) {
    const next = [...new Set(models)]; setDraft((current) => ({ ...current, enabledModels: next }));
    if (providerIndex === 0 && client.clineSetEnabledModels) { await runAction("enabled-models", () => client.clineSetEnabledModels?.(next) ?? Promise.resolve()); return; }
    const nextProviders = [...providers]; if (nextProviders.length === 0) nextProviders.push({ ...draft, enabledModels: next }); else nextProviders[providerIndex] = { ...draft, enabledModels: next };
    await runAction("enabled-models", () => onPatchSettings({ clineProviders: nextProviders }));
  }

  if (!client.clineStatus) return <section aria-label="Cline 平台供应商" className="flex flex-col gap-6"><PlatformHeader platform="cline" onBack={onBack} /><RuntimeRouteUnavailable platform="cline" /></section>;

  const enabledModels = draft.enabledModels ?? [];
  const proxy = draft.proxy;

  return (
    <section aria-label="Cline 平台供应商" className="flex flex-col gap-6">
      <PlatformHeader platform="cline" onBack={onBack} />
      {error ? <Alert><AlertTitle>Cline 操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Card><CardHeader><CardTitle>账号状态与余额</CardTitle><CardDescription>{status?.authenticated ? `已登录：${status.email ?? status.displayName ?? "Cline 账号"}` : "尚未登录 Cline 账号。"}</CardDescription><CardAction><Button type="button" variant="outline" size="sm" onClick={() => void reloadStatus()} disabled={loading || busy}><RefreshCw data-icon="inline-start" />{loading ? "刷新中…" : "刷新状态"}</Button></CardAction></CardHeader><CardContent className="flex flex-wrap gap-2">{status?.authenticated ? <Button type="button" variant="outline" onClick={() => client.clineLogout && void runAction("logout", client.clineLogout)} disabled={!client.clineLogout || action === "logout" || busy}><Unplug data-icon="inline-start" />退出登录</Button> : <Button type="button" variant="outline" onClick={() => client.clineBrowserAuth && void runAction("browser-auth", async () => { const result = await client.clineBrowserAuth?.(); if (!result?.authorizeUrl) throw new Error("Runtime 未返回 Cline 授权地址。"); window.open(result.authorizeUrl, "_blank", "noopener,noreferrer"); }, false)} disabled={!client.clineBrowserAuth || action === "browser-auth" || busy}><ExternalLink data-icon="inline-start" />浏览器登录</Button>}{status?.pendingAuth ? <Badge>正在等待授权完成</Badge> : null}{balance ? <Badge variant="secondary">余额：{balance.balance.toFixed(2)}{balance.currency ? ` ${balance.currency}` : ""}</Badge> : null}{status?.authenticated && client.clineBalance ? <Button type="button" variant="ghost" size="sm" onClick={() => void client.clineBalance?.().then(setBalance).catch((reason) => setError(messageFrom(reason)))}>刷新余额</Button> : null}</CardContent>{!status?.authenticated ? <CardContent className="border-t pt-4"><Field><FieldLabel htmlFor="cline-callback-url">远程部署回调 URL</FieldLabel><Textarea id="cline-callback-url" aria-label="Cline 回调 URL" value={callbackUrl} onChange={(event) => setCallbackUrl(event.currentTarget.value)} placeholder="粘贴 Cline OAuth 回调完整 URL" rows={3} /><FieldDescription>部署在远程主机时，可以在本地完成授权后将回调 URL 粘贴到这里。</FieldDescription></Field><div className="mt-3 flex justify-end gap-2">{status?.pendingAuth ? <Button type="button" variant="ghost" onClick={() => client.clineCancelBrowserAuth && void runAction("cancel-auth", client.clineCancelBrowserAuth, false)}>取消等待</Button> : null}<Button type="button" onClick={() => client.clineImportCallback && void runAction("import-callback", () => client.clineImportCallback?.(callbackUrl.trim()) ?? Promise.resolve())} disabled={!callbackUrl.trim() || !client.clineImportCallback || action === "import-callback" || busy}><Check data-icon="inline-start" />导入回调</Button></div></CardContent> : null}</Card>
      <Card><CardHeader><CardTitle>连接配置</CardTitle><CardDescription>每个 Cline 连接保持在 Runtime 的 clineProviders 中，不会转换成 customApiProviders。</CardDescription></CardHeader><CardContent><FieldGroup className="sm:grid sm:grid-cols-2">{providers.length > 1 ? <Field className="sm:col-span-2"><FieldLabel>配置连接</FieldLabel><SimpleSelect aria-label="Cline 配置连接" value={String(providerIndex)} onValueChange={(value) => setProviderIndex(Number(value))} options={providers.map((provider, index) => ({ value: String(index), label: `${provider.name} (${provider.prefix})` }))} /></Field> : null}<Field><FieldLabel htmlFor="cline-name">连接名称</FieldLabel><Input id="cline-name" aria-label="Cline 连接名称" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))} /></Field><Field><FieldLabel htmlFor="cline-prefix">模型前缀</FieldLabel><Input id="cline-prefix" aria-label="Cline 模型前缀" value={draft.prefix} onChange={(event) => setDraft((current) => ({ ...current, prefix: event.currentTarget.value.replace(/:/g, "") }))} /></Field><Field className="sm:col-span-2"><FieldLabel htmlFor="cline-base-url">Cline API 地址</FieldLabel><Input id="cline-base-url" aria-label="Cline API 地址" value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.currentTarget.value }))} placeholder="https://api.cline.bot/api/v1" /></Field><Field><FieldLabel htmlFor="cline-default-model">默认模型</FieldLabel><Input id="cline-default-model" aria-label="Cline 默认模型" value={draft.defaultModel} onChange={(event) => setDraft((current) => ({ ...current, defaultModel: event.currentTarget.value }))} placeholder="anthropic/claude-sonnet-4" /></Field><Field><FieldLabel>Cline 代理策略</FieldLabel><SimpleSelect aria-label="Cline 代理策略" value={proxyMode(proxy)} onValueChange={(value) => setDraft((current) => ({ ...current, proxy: normalizeProviderProxy(value as "default" | "system" | "direct" | "custom", current.proxy?.url) }))} options={[...PROXY_MODE_OPTIONS]} /></Field>{hasProxyUrl(proxy) ? <Field className="sm:col-span-2"><FieldLabel htmlFor="cline-proxy-url">代理 URL</FieldLabel><Input id="cline-proxy-url" aria-label="Cline 代理 URL" value={proxy?.url ?? ""} onChange={(event) => setDraft((current) => ({ ...current, proxy: normalizeProviderProxy("custom", event.currentTarget.value) }))} placeholder="http://127.0.0.1:7890" /></Field> : null}</FieldGroup></CardContent><CardFooter className="justify-end"><Button type="button" onClick={() => void saveProvider()} disabled={busy || action === "save-provider" || !draft.name.trim() || !draft.prefix.trim() || !draft.baseUrl.trim()}><Save data-icon="inline-start" />保存 Cline 连接</Button></CardFooter></Card>
      <Tabs defaultValue="recommended"><TabsList><TabsTrigger value="recommended">推荐与免费</TabsTrigger><TabsTrigger value="catalog">模型目录</TabsTrigger></TabsList><TabsContent value="recommended"><Card><CardHeader><CardTitle>推荐与免费模型</CardTitle><CardDescription>Runtime 从 Cline 目录加载推荐和免费模型；可一键加入当前连接。</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{(["recommended", "free"] as const).map((kind) => <div key={kind} className="flex flex-col gap-2"><h3 className="font-medium">{kind === "recommended" ? "推荐模型" : "免费模型"}</h3>{recommended?.[kind]?.length ? recommended[kind].map((model) => { const enabled = enabledModels.includes(model.id); return <div key={model.id} className="flex items-center gap-2 rounded border p-2"><span className="min-w-0 flex-1 truncate font-mono text-xs">{model.name ?? model.id}</span><Button type="button" variant={enabled ? "secondary" : "outline"} size="sm" onClick={() => void updateEnabledModels(enabled ? enabledModels.filter((id) => id !== model.id) : [...enabledModels, model.id])} disabled={busy || action === "enabled-models"}>{enabled ? "已启用" : "启用"}</Button></div>; }) : <p className="text-sm text-muted-foreground">暂无 {kind === "recommended" ? "推荐" : "免费"} 模型。</p>}</div>)}</CardContent></Card></TabsContent><TabsContent value="catalog"><Card><CardHeader><CardTitle>模型目录与启用模型</CardTitle><CardDescription>{poolCount == null ? "可以从 Cline 模型目录搜索并启用模型。" : `当前缓存模型目录：${poolCount} 个模型。`}</CardDescription><CardAction><Button type="button" variant="outline" size="sm" onClick={() => (client.clineRefreshProviderModels ? void runAction("refresh-provider-models", () => client.clineRefreshProviderModels?.(draft.id) ?? Promise.resolve()) : client.clineRefreshModels && void runAction("refresh-models", client.clineRefreshModels))} disabled={(!client.clineRefreshProviderModels && !client.clineRefreshModels) || busy || action === "refresh-provider-models" || action === "refresh-models"}><RefreshCw data-icon="inline-start" />刷新模型目录</Button></CardAction></CardHeader><CardContent className="flex flex-col gap-4"><Field><FieldLabel htmlFor="cline-model-search">搜索模型目录</FieldLabel><Input id="cline-model-search" aria-label="搜索 Cline 模型目录" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="输入至少两个字符，例如 claude" /></Field>{search.trim().length >= 2 ? <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-md border p-2">{searchResults.length === 0 ? <p className="text-sm text-muted-foreground">没有匹配模型。</p> : searchResults.map((model) => { const enabled = enabledModels.includes(model.id); return <div key={model.id} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"><span className="min-w-0 flex-1 truncate font-mono text-xs">{model.id}</span>{model.name && model.name !== model.id ? <span className="truncate text-xs text-muted-foreground">{model.name}</span> : null}{model.contextLength ? <Badge variant="secondary">{Math.round(model.contextLength / 1000)}k</Badge> : null}<Button type="button" variant={enabled ? "secondary" : "outline"} size="sm" onClick={() => void updateEnabledModels(enabled ? enabledModels.filter((id) => id !== model.id) : [...enabledModels, model.id])} disabled={action === "enabled-models" || busy}>{enabled ? "移除" : "启用"}</Button></div>; })}</div> : null}<FieldSeparator>已启用模型</FieldSeparator>{enabledModels.length === 0 ? <p className="text-sm text-muted-foreground">尚未启用任何 Cline 模型。</p> : <div className="flex flex-wrap gap-2">{enabledModels.map((model) => <Badge key={model} variant="secondary" className="gap-1 font-mono"><span>{model}</span><button type="button" aria-label={`移除模型 ${model}`} className="rounded-sm hover:text-destructive" onClick={() => void updateEnabledModels(enabledModels.filter((id) => id !== model))}>×</button></Badge>)}</div>}</CardContent></Card></TabsContent></Tabs>
      <PlatformModelInventory title="Cline 模型库存" description="对已启用的 Cline 模型统一管理隐藏、上下文覆盖、自定义条目和测试。" providerPrefix={draft.prefix} modelOptions={modelOptions} agentModels={agentModels} busy={busy} onUpdateAgentModels={onUpdateAgentModels} onTestModel={onTestModel} />
    </section>
  );
}
