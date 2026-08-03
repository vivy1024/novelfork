import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MessagesSquare,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { notify } from "@/lib/notify";
import {
  createGatewayClient,
  type GatewayConfig,
  type GatewayPlatform,
  type GatewayPlatformConfig,
  type GatewaySession,
  type GatewayStatus,
} from "../../runtime-admin/gateway";

const gatewayClient = createGatewayClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_PLATFORMS: GatewayPlatform[] = [
  "telegram",
  "discord",
  "slack",
  "feishu",
  "webhook",
  "weixin",
  "qqbot",
];

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  feishu: "飞书 / Lark",
  webhook: "Webhook",
  weixin: "微信",
  qqbot: "QQ Bot",
};

const PERMISSION_MODES = [
  { value: "default", label: "默认" },
  { value: "acceptEdits", label: "自动接受编辑" },
  { value: "bypassPermissions", label: "跳过权限确认" },
  { value: "readOnly", label: "只读" },
  { value: "dontAsk", label: "不询问" },
] as const;

const GATEWAY_DEFAULT_PERMISSION_MODE = "bypassPermissions";

const QQ_POLICY_OPTIONS = [
  { value: "open", label: "开放" },
  { value: "allowlist", label: "白名单" },
  { value: "disabled", label: "禁用" },
] as const;

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

function formatDateTime(value: string | null): string {
  if (!value) return "尚无消息";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function sessionDisplayName(session: GatewaySession): string {
  return session.username?.trim() || `${platformLabel(session.platform)} · ${session.chatId}`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function normalizePermissionMode(value: unknown): string {
  if (typeof value !== "string") return GATEWAY_DEFAULT_PERMISSION_MODE;
  const validModes = PERMISSION_MODES.map((m) => m.value) as readonly string[];
  if (validModes.includes(value)) return value;
  if (value === "allowByDefault") return "acceptEdits";
  if (value === "denyByDefault") return "dontAsk";
  return GATEWAY_DEFAULT_PERMISSION_MODE;
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function GatewayPanel() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [sessions, setSessions] = useState<readonly GatewaySession[]>([]);
  const [config, setConfig] = useState<GatewayConfig>({});
  const [configLoaded, setConfigLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<GatewaySession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serverSnapshot = useRef<GatewayConfig>({});

  const isDirty = useMemo(() => {
    if (!configLoaded) return false;
    return JSON.stringify(config) !== JSON.stringify(serverSnapshot.current);
  }, [configLoaded, config]);

  const loadGateway = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [statusResult, sessionsResult, configResult] = await Promise.allSettled([
      gatewayClient.status(),
      gatewayClient.sessions(),
      gatewayClient.getConfig(),
    ]);
    const failures: string[] = [];

    if (statusResult.status === "fulfilled") {
      setStatus(statusResult.value);
    } else {
      failures.push(`状态：${errorMessage(statusResult.reason)}`);
    }

    if (sessionsResult.status === "fulfilled") {
      setSessions(sessionsResult.value);
    } else {
      failures.push(`会话：${errorMessage(sessionsResult.reason)}`);
    }

    if (configResult.status === "fulfilled") {
      const normalized = {
        ...configResult.value,
        defaultPermissionMode: normalizePermissionMode(configResult.value.defaultPermissionMode),
      };
      setConfig(normalized);
      serverSnapshot.current = normalized;
      setConfigLoaded(true);
    } else {
      failures.push(`配置：${errorMessage(configResult.reason)}`);
    }

    setError(failures.length > 0 ? failures.join("；") : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadGateway();
  }, [loadGateway]);

  // Compute which platforms changed (for targeted reload)
  const getChangedPlatforms = useCallback(
    (nextConfig: GatewayConfig = config): GatewayPlatform[] => {
      const oldPlatforms = serverSnapshot.current.platforms ?? [];
      const newPlatforms = nextConfig.platforms ?? [];
      const changed = new Set<GatewayPlatform>();

      for (const np of newPlatforms) {
        const op = oldPlatforms.find((p) => p.platform === np.platform);
        if (!op || JSON.stringify(op) !== JSON.stringify(np)) {
          changed.add(np.platform);
        }
      }
      for (const op of oldPlatforms) {
        if (!newPlatforms.find((p) => p.platform === op.platform)) {
          changed.add(op.platform);
        }
      }
      return Array.from(changed);
    },
    [config],
  );

  async function handleSaveConfig() {
    setSaving(true);
    setError(null);
    try {
      await gatewayClient.saveConfig(config);

      const changedPlatforms = getChangedPlatforms(config);
      const globalChanged =
        serverSnapshot.current.enabled !== config.enabled ||
        serverSnapshot.current.streaming !== config.streaming ||
        serverSnapshot.current.defaultPermissionMode !== config.defaultPermissionMode ||
        serverSnapshot.current.defaultProjectId !== config.defaultProjectId ||
        serverSnapshot.current.defaultChapterId !== config.defaultChapterId ||
        serverSnapshot.current.sessionIdleMinutes !== config.sessionIdleMinutes ||
        serverSnapshot.current.rateLimitPerMinute !== config.rateLimitPerMinute;

      if (globalChanged && changedPlatforms.length === 0) {
        await gatewayClient.reload();
      } else if (changedPlatforms.length > 0) {
        await gatewayClient.reload(changedPlatforms);
      }

      serverSnapshot.current = config;
      notify.success("Gateway 配置已保存");
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify.error("Gateway 配置保存失败", { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    setReloading(true);
    setError(null);
    try {
      const result = await gatewayClient.reload();
      setStatus(result.status);
      notify.success("Gateway 已重载", {
        description: result.reloaded.length > 0
          ? `已重载：${result.reloaded.map(platformLabel).join("、")}`
          : "Runtime 已完成 Gateway 全量重载。",
      });
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify.error("Gateway 重载失败", { description: message });
    } finally {
      setReloading(false);
    }
  }

  async function handleDeleteSession() {
    if (!deleteCandidate) return;
    const candidate = deleteCandidate;
    setDeletingId(candidate.id);
    setError(null);
    try {
      await gatewayClient.deleteSession(candidate.id);
      setSessions((current) => current.filter((session) => session.id !== candidate.id));
      setDeleteCandidate(null);
      notify.success("Gateway 会话已删除", { description: sessionDisplayName(candidate) });
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify.error("Gateway 会话删除失败", { description: message });
    } finally {
      setDeletingId(null);
    }
  }

  // Config field helpers
  const updateField = <K extends keyof GatewayConfig>(key: K, value: GatewayConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const platforms = config.platforms ?? [];

  const addPlatform = (platform: GatewayPlatform) => {
    if (platforms.some((p) => p.platform === platform)) return;
    setConfig((prev) => ({
      ...prev,
      platforms: [...(prev.platforms ?? []), { platform, enabled: true }],
    }));
  };

  const removePlatform = (index: number) => {
    setConfig((prev) => {
      const updated = [...(prev.platforms ?? [])];
      updated.splice(index, 1);
      return { ...prev, platforms: updated };
    });
  };

  const updatePlatform = (index: number, patch: Partial<GatewayPlatformConfig>) => {
    setConfig((prev) => {
      const updated = [...(prev.platforms ?? [])];
      updated[index] = { ...updated[index], ...patch };
      return { ...prev, platforms: updated };
    });
  };

  const availablePlatforms = ALL_PLATFORMS.filter(
    (p) => !platforms.some((existing) => existing.platform === p),
  );

  return (
    <div data-slot="gateway-panel" className="flex flex-col gap-6">
      <div data-slot="gateway-panel-header">
        <h2 className="text-lg font-semibold text-foreground">Gateway</h2>
        <p className="text-sm text-muted-foreground">
          配置外部聊天渠道接入，管理平台与会话。
        </p>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>Gateway 操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* ── Gateway Config ── */}
      <Card>
        <CardHeader>
          <CardTitle>网关配置</CardTitle>
          <CardDescription>全局开关、权限模式与默认参数。</CardDescription>
        </CardHeader>
        <CardContent>
          {!configLoaded ? (
            <div className="flex flex-col gap-3" aria-label="正在加载网关配置">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-full max-w-md" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={config.enabled ?? false}
                  onCheckedChange={(checked) => updateField("enabled", checked)}
                />
                <Label>启用 Gateway</Label>
              </div>

              {config.enabled && (
                <>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={config.streaming ?? true}
                      onCheckedChange={(checked) => updateField("streaming", checked)}
                    />
                    <Label>流式输出</Label>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="gateway-permission-mode">默认权限模式</Label>
                    <Select
                      value={normalizePermissionMode(config.defaultPermissionMode)}
                      onValueChange={(v) => updateField("defaultPermissionMode", v)}
                    >
                      <SelectTrigger id="gateway-permission-mode" className="w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERMISSION_MODES.map((mode) => (
                          <SelectItem key={mode.value} value={mode.value}>
                            {mode.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="gateway-session-idle">会话空闲超时（分钟）</Label>
                      <Input
                        id="gateway-session-idle"
                        type="number"
                        min={0}
                        max={43200}
                        value={config.sessionIdleMinutes ?? 0}
                        onChange={(e) =>
                          updateField("sessionIdleMinutes", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="gateway-rate-limit">速率限制（条/分）</Label>
                      <Input
                        id="gateway-rate-limit"
                        type="number"
                        min={0}
                        max={1000}
                        value={config.rateLimitPerMinute ?? 20}
                        onChange={(e) =>
                          updateField("rateLimitPerMinute", Number(e.target.value) || 20)
                        }
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="gateway-default-project">默认项目 ID</Label>
                      <Input
                        id="gateway-default-project"
                        value={config.defaultProjectId ?? ""}
                        onChange={(e) =>
                          updateField("defaultProjectId", e.target.value || undefined)
                        }
                        placeholder="留空则自动分配"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="gateway-default-chapter">默认章节 ID</Label>
                      <Input
                        id="gateway-default-chapter"
                        value={config.defaultChapterId ?? ""}
                        onChange={(e) =>
                          updateField("defaultChapterId", e.target.value || undefined)
                        }
                        placeholder="留空则不绑定"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Platforms Config ── */}
      {config.enabled && configLoaded && (
        <Card>
          <CardHeader>
            <CardTitle>平台配置</CardTitle>
            <CardDescription>
              添加并配置各消息平台通道。
            </CardDescription>
            <CardAction>
              {availablePlatforms.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      <Plus data-icon="inline-start" />
                      添加平台
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {availablePlatforms.map((p) => (
                      <DropdownMenuItem key={p} onClick={() => addPlatform(p)}>
                        {platformLabel(p)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardAction>
          </CardHeader>
          <CardContent>
            {platforms.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                尚未配置任何平台。点击「添加平台」开始。
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {platforms.map((platform, index) => (
                  <PlatformCard
                    key={platform.platform}
                    platform={platform}
                    index={index}
                    onUpdate={updatePlatform}
                    onRemove={removePlatform}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Save bar ── */}
      {isDirty && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => void handleSaveConfig()} disabled={saving}>
            <Save data-icon="inline-start" />
            {saving ? "保存中…" : "保存配置"}
          </Button>
        </div>
      )}

      {/* ── Runtime Status ── */}
      <Card>
        <CardHeader>
          <CardTitle>运行状态</CardTitle>
          <CardDescription>显示当前渠道状态；重载会重新连接已配置的平台。</CardDescription>
          <CardAction>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void loadGateway()} disabled={loading || reloading}>
                <RefreshCw data-icon="inline-start" />
                {loading ? "刷新中…" : "刷新"}
              </Button>
              <Button type="button" size="sm" onClick={() => void handleReload()} disabled={loading || reloading}>
                <RotateCcw data-icon="inline-start" />
                {reloading ? "重载中…" : "重载 Gateway"}
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading && !status ? (
            <div className="flex flex-col gap-3" aria-label="正在加载 Gateway 状态">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-full max-w-md" />
            </div>
          ) : status ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">连接状态</span>
                <Badge variant={status.started ? "default" : "secondary"}>
                  {status.started ? "运行中" : "已停止"}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">已加载平台</span>
                {status.platforms.length > 0 ? status.platforms.map((platform) => (
                  <Badge key={platform} variant="outline">{platformLabel(platform)}</Badge>
                )) : <span className="text-sm text-muted-foreground">无</span>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Runtime 未返回 Gateway 状态。</p>
          )}
        </CardContent>
      </Card>

      {/* ── Sessions ── */}
      <Card>
        <CardHeader>
          <CardTitle>Gateway 会话</CardTitle>
          <CardDescription>
            {loading ? "正在读取聊天会话…" : `共 ${sessions.length} 个外部聊天会话。删除后，下一条消息将创建新会话。`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && sessions.length === 0 ? (
            <div className="flex flex-col gap-3" aria-label="正在加载 Gateway 会话">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : sessions.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><MessagesSquare /></EmptyMedia>
                <EmptyTitle>暂无 Gateway 会话</EmptyTitle>
                <EmptyDescription>外部平台收到首条消息后，会在这里创建会话。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>平台</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>绑定</TableHead>
                  <TableHead>最近消息</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell><Badge variant="outline">{platformLabel(session.platform)}</Badge></TableCell>
                    <TableCell>
                      <div className="flex min-w-0 max-w-56 flex-col gap-1">
                        <span className="truncate font-medium">{sessionDisplayName(session)}</span>
                        <span className="truncate text-xs text-muted-foreground">{session.userId || session.chatId}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 max-w-64 flex-col gap-1 text-xs">
                        <span className="truncate">叙述者：{session.narratorId}</span>
                        <span className="truncate text-muted-foreground">
                          {session.projectId ? `项目：${session.projectId}` : "未绑定项目"}
                          {session.chapterId ? ` · 章节：${session.chapterId}` : ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(session.lastMessageAt ?? session.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`删除 ${sessionDisplayName(session)} 的 Gateway 会话`}
                        onClick={() => setDeleteCandidate(session)}
                        disabled={deletingId === session.id}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={deleteCandidate !== null} onOpenChange={(open) => {
        if (!open && !deletingId) setDeleteCandidate(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 Gateway 会话？</DialogTitle>
            <DialogDescription>
              {deleteCandidate
                ? `将删除 ${sessionDisplayName(deleteCandidate)} 的会话映射。此操作不会删除关联的叙述者。`
                : "将删除所选 Gateway 会话映射。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteCandidate(null)} disabled={deletingId !== null}>
              取消
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleDeleteSession()} disabled={deletingId !== null}>
              <Trash2 data-icon="inline-start" />
              {deletingId ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform card
// ---------------------------------------------------------------------------

function PlatformCard({
  platform,
  index,
  onUpdate,
  onRemove,
}: {
  platform: GatewayPlatformConfig;
  index: number;
  onUpdate: (index: number, patch: Partial<GatewayPlatformConfig>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">{platformLabel(platform.platform)}</span>
            <Switch
              checked={platform.enabled}
              onCheckedChange={(checked) => onUpdate(index, { enabled: checked })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onRemove(index)}
            aria-label={`移除 ${platformLabel(platform.platform)}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>

        {platform.enabled && (
          <PlatformFields platform={platform} index={index} onUpdate={onUpdate} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform-specific fields
// ---------------------------------------------------------------------------

function PlatformFields({
  platform,
  index,
  onUpdate,
}: {
  platform: GatewayPlatformConfig;
  index: number;
  onUpdate: (index: number, patch: Partial<GatewayPlatformConfig>) => void;
}) {
  switch (platform.platform) {
    case "telegram":
    case "discord":
      return (
        <TokenAndAllowedUsers
          platform={platform}
          index={index}
          onUpdate={onUpdate}
          tokenLabel={platform.platform === "telegram" ? "Bot Token" : "Bot Token"}
        />
      );
    case "slack":
      return <SlackFields platform={platform} index={index} onUpdate={onUpdate} />;
    case "feishu":
      return <FeishuFields platform={platform} index={index} onUpdate={onUpdate} />;
    case "webhook":
      return <WebhookFields platform={platform} index={index} onUpdate={onUpdate} />;
    case "weixin":
      return <WeixinFields platform={platform} index={index} onUpdate={onUpdate} />;
    case "qqbot":
      return <QQBotFields platform={platform} index={index} onUpdate={onUpdate} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Token + AllowedUsers (Telegram / Discord)
// ---------------------------------------------------------------------------

function TokenAndAllowedUsers({
  platform,
  index,
  onUpdate,
  tokenLabel,
}: {
  platform: GatewayPlatformConfig;
  index: number;
  onUpdate: (index: number, patch: Partial<GatewayPlatformConfig>) => void;
  tokenLabel: string;
}) {
  const [token, setToken] = useState(platform.token ?? "");
  const [allowedUsers, setAllowedUsers] = useState((platform.allowedUsers ?? []).join(", "));

  useEffect(() => {
    setToken(platform.token ?? "");
    setAllowedUsers((platform.allowedUsers ?? []).join(", "));
  }, [platform.token, platform.allowedUsers]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>{tokenLabel}</Label>
        <Input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onBlur={() => {
            if (!token.startsWith("*")) onUpdate(index, { token });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>允许的用户</Label>
        <Input
          value={allowedUsers}
          onChange={(e) => setAllowedUsers(e.target.value)}
          onBlur={() => {
            const users = allowedUsers.split(",").map((s) => s.trim()).filter(Boolean);
            onUpdate(index, { allowedUsers: users.length > 0 ? users : undefined });
          }}
          placeholder="逗号分隔，留空允许所有"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slack fields
// ---------------------------------------------------------------------------

function SlackFields({
  platform,
  index,
  onUpdate,
}: {
  platform: GatewayPlatformConfig;
  index: number;
  onUpdate: (index: number, patch: Partial<GatewayPlatformConfig>) => void;
}) {
  const [botToken, setBotToken] = useState(platform.botToken ?? "");
  const [appToken, setAppToken] = useState(platform.appToken ?? "");
  const [allowedUsers, setAllowedUsers] = useState((platform.allowedUsers ?? []).join(", "));

  useEffect(() => {
    setBotToken(platform.botToken ?? "");
    setAppToken(platform.appToken ?? "");
    setAllowedUsers((platform.allowedUsers ?? []).join(", "));
  }, [platform.botToken, platform.appToken, platform.allowedUsers]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Bot Token</Label>
        <Input
          type="password"
          autoComplete="off"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          onBlur={() => {
            if (!botToken.startsWith("*")) onUpdate(index, { botToken });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>App Token</Label>
        <Input
          type="password"
          autoComplete="off"
          value={appToken}
          onChange={(e) => setAppToken(e.target.value)}
          onBlur={() => {
            if (!appToken.startsWith("*")) onUpdate(index, { appToken });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>允许的用户</Label>
        <Input
          value={allowedUsers}
          onChange={(e) => setAllowedUsers(e.target.value)}
          onBlur={() => {
            const users = allowedUsers.split(",").map((s) => s.trim()).filter(Boolean);
            onUpdate(index, { allowedUsers: users.length > 0 ? users : undefined });
          }}
          placeholder="逗号分隔，留空允许所有"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feishu / Lark fields
// ---------------------------------------------------------------------------

function FeishuFields({
  platform,
  index,
  onUpdate,
}: {
  platform: GatewayPlatformConfig;
  index: number;
  onUpdate: (index: number, patch: Partial<GatewayPlatformConfig>) => void;
}) {
  const [appId, setAppId] = useState(platform.appId ?? "");
  const [appSecret, setAppSecret] = useState(platform.appSecret ?? "");
  const [allowedUsers, setAllowedUsers] = useState((platform.allowedUsers ?? []).join(", "));

  useEffect(() => {
    setAppId(platform.appId ?? "");
    setAppSecret(platform.appSecret ?? "");
    setAllowedUsers((platform.allowedUsers ?? []).join(", "));
  }, [platform.appId, platform.appSecret, platform.allowedUsers]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>App ID</Label>
        <Input
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          onBlur={() => onUpdate(index, { appId })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>App Secret</Label>
        <Input
          type="password"
          autoComplete="off"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          onBlur={() => {
            if (!appSecret.startsWith("*")) onUpdate(index, { appSecret });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>允许的用户</Label>
        <Input
          value={allowedUsers}
          onChange={(e) => setAllowedUsers(e.target.value)}
          onBlur={() => {
            const users = allowedUsers.split(",").map((s) => s.trim()).filter(Boolean);
            onUpdate(index, { allowedUsers: users.length > 0 ? users : undefined });
          }}
          placeholder="逗号分隔，留空允许所有"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Webhook fields
// ---------------------------------------------------------------------------

function WebhookFields({
  platform,
  index,
  onUpdate,
}: {
  platform: GatewayPlatformConfig;
  index: number;
  onUpdate: (index: number, patch: Partial<GatewayPlatformConfig>) => void;
}) {
  const [secret, setSecret] = useState(platform.secret ?? "");

  useEffect(() => {
    setSecret(platform.secret ?? "");
  }, [platform.secret]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>HMAC Secret</Label>
        <Input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          onBlur={() => {
            if (!secret.startsWith("*")) onUpdate(index, { secret });
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WeChat fields + QR login
// ---------------------------------------------------------------------------

type QrStatus = "idle" | "wait" | "scaned" | "confirmed" | "expired" | "error";

function WeixinFields({
  platform,
  index,
  onUpdate,
}: {
  platform: GatewayPlatformConfig;
  index: number;
  onUpdate: (index: number, patch: Partial<GatewayPlatformConfig>) => void;
}) {
  const [allowedUsers, setAllowedUsers] = useState((platform.allowedUsers ?? []).join(", "));
  const [qrStatus, setQrStatus] = useState<QrStatus>("idle");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setAllowedUsers((platform.allowedUsers ?? []).join(", "));
  }, [platform.allowedUsers]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startQrLogin = useCallback(async () => {
    setQrStatus("wait");
    setQrError(null);
    setQrUrl(null);
    stopPolling();

    try {
      const res = await gatewayClient.weixinQrStart();
      if (res.error) {
        setQrStatus("error");
        setQrError(res.error);
        return;
      }
      setQrUrl(res.qrcodeUrl);

      pollRef.current = setInterval(async () => {
        try {
          const poll = await gatewayClient.weixinQrPoll();

          if (poll.status === "scaned") {
            setQrStatus("scaned");
          } else if (poll.status === "confirmed") {
            stopPolling();
            setQrStatus("confirmed");
            setQrUrl(null);
            onUpdate(index, {
              token: poll.token,
              accountId: poll.accountId,
              baseUrl: poll.baseUrl,
            });
          } else if (poll.status === "expired") {
            if (poll.qrcodeUrl) {
              setQrUrl(poll.qrcodeUrl);
              setQrStatus("wait");
            } else {
              stopPolling();
              setQrStatus("expired");
              setQrUrl(null);
            }
          } else if (poll.status === "error") {
            stopPolling();
            setQrStatus("error");
            setQrError(poll.reason ?? poll.message ?? poll.error ?? "未知错误");
            setQrUrl(null);
          }
        } catch {
          stopPolling();
          setQrStatus("error");
          setQrError("轮询失败");
          setQrUrl(null);
        }
      }, 2000);
    } catch (err) {
      setQrStatus("error");
      setQrError(err instanceof Error ? err.message : String(err));
    }
  }, [index, onUpdate, stopPolling]);

  const hasCredentials = !!(platform.accountId && platform.token);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        通过扫码登录微信，获取凭证后自动填入。
      </p>

      {/* QR login section */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void startQrLogin()}
          disabled={qrStatus === "wait" || qrStatus === "scaned"}
        >
          <QrCode data-icon="inline-start" />
          扫码登录
        </Button>
        <QrStatusBadge status={qrStatus} error={qrError} />
      </div>

      {qrUrl && (
        <a
          href={qrUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <QrCode className="h-3 w-3" />
          在新窗口打开二维码
        </a>
      )}

      {/* Credentials (read-only, filled by QR login) */}
      {hasCredentials && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>账户 ID</Label>
            <Input value={platform.accountId ?? ""} readOnly className="bg-muted" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Token</Label>
            <Input type="password" value={platform.token ?? ""} readOnly className="bg-muted" />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>允许的用户</Label>
        <Input
          value={allowedUsers}
          onChange={(e) => setAllowedUsers(e.target.value)}
          onBlur={() => {
            const users = allowedUsers.split(",").map((s) => s.trim()).filter(Boolean);
            onUpdate(index, { allowedUsers: users.length > 0 ? users : undefined });
          }}
          placeholder="逗号分隔，留空允许所有"
        />
      </div>
    </div>
  );
}

function QrStatusBadge({ status, error }: { status: QrStatus; error: string | null }) {
  switch (status) {
    case "wait":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          等待扫码
        </Badge>
      );
    case "scaned":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          已扫码，等待确认
        </Badge>
      );
    case "confirmed":
      return <Badge variant="default">登录成功</Badge>;
    case "expired":
      return <Badge variant="secondary">二维码已过期</Badge>;
    case "error":
      return <Badge variant="destructive">{error ?? "错误"}</Badge>;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// QQ Bot fields
// ---------------------------------------------------------------------------

function QQBotFields({
  platform,
  index,
  onUpdate,
}: {
  platform: GatewayPlatformConfig;
  index: number;
  onUpdate: (index: number, patch: Partial<GatewayPlatformConfig>) => void;
}) {
  const [appId, setAppId] = useState(platform.appId ?? "");
  const [clientSecret, setClientSecret] = useState(platform.clientSecret ?? "");
  const [allowedUsers, setAllowedUsers] = useState((platform.allowedUsers ?? []).join(", "));
  const [allowedGroups, setAllowedGroups] = useState((platform.allowedGroups ?? []).join(", "));
  const [sttApiKey, setSttApiKey] = useState(platform.stt?.apiKey ?? "");
  const [sttBaseUrl, setSttBaseUrl] = useState(platform.stt?.baseUrl ?? "");
  const [sttModel, setSttModel] = useState(platform.stt?.model ?? "");

  useEffect(() => {
    setAppId(platform.appId ?? "");
    setClientSecret(platform.clientSecret ?? "");
    setAllowedUsers((platform.allowedUsers ?? []).join(", "));
    setAllowedGroups((platform.allowedGroups ?? []).join(", "));
    setSttApiKey(platform.stt?.apiKey ?? "");
    setSttBaseUrl(platform.stt?.baseUrl ?? "");
    setSttModel(platform.stt?.model ?? "");
  }, [platform]);

  const saveStt = (patch: Partial<NonNullable<GatewayPlatformConfig["stt"]>>) => {
    const current = platform.stt ?? { apiKey: "" };
    const updated = { ...current, ...patch };
    if (!updated.apiKey) {
      onUpdate(index, { stt: undefined });
    } else {
      onUpdate(index, { stt: updated });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        QQ 官方机器人平台接入。需要在{" "}
        <a href="https://q.qq.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          q.qq.com
        </a>
        {" "}创建应用。
      </p>

      <div className="flex flex-col gap-1.5">
        <Label>App ID</Label>
        <Input
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          onBlur={() => onUpdate(index, { appId })}
          placeholder="QQ 开放平台的 App ID"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Client Secret</Label>
        <Input
          type="password"
          autoComplete="off"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          onBlur={() => {
            if (!clientSecret.startsWith("*")) onUpdate(index, { clientSecret });
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>私聊策略</Label>
          <Select
            value={platform.dmPolicy ?? "open"}
            onValueChange={(v) => onUpdate(index, { dmPolicy: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QQ_POLICY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>群聊策略</Label>
          <Select
            value={platform.groupPolicy ?? "open"}
            onValueChange={(v) => onUpdate(index, { groupPolicy: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QQ_POLICY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {platform.dmPolicy === "allowlist" && (
        <div className="flex flex-col gap-1.5">
          <Label>允许的用户</Label>
          <Input
            value={allowedUsers}
            onChange={(e) => setAllowedUsers(e.target.value)}
            onBlur={() => {
              const users = allowedUsers.split(",").map((s) => s.trim()).filter(Boolean);
              onUpdate(index, { allowedUsers: users.length > 0 ? users : undefined });
            }}
            placeholder="逗号分隔用户 ID"
          />
        </div>
      )}

      {platform.groupPolicy === "allowlist" && (
        <div className="flex flex-col gap-1.5">
          <Label>允许的群组</Label>
          <Input
            value={allowedGroups}
            onChange={(e) => setAllowedGroups(e.target.value)}
            onBlur={() => {
              const groups = allowedGroups.split(",").map((s) => s.trim()).filter(Boolean);
              onUpdate(index, { allowedGroups: groups.length > 0 ? groups : undefined });
            }}
            placeholder="逗号分隔群组 ID"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <Switch
            checked={platform.markdownSupport ?? false}
            onCheckedChange={(checked) => onUpdate(index, { markdownSupport: checked })}
          />
          <Label>Markdown 支持</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={platform.sandbox ?? false}
            onCheckedChange={(checked) => onUpdate(index, { sandbox: checked })}
          />
          <Label>沙箱模式</Label>
        </div>
      </div>

      {/* STT 配置 */}
      <div className="mt-2 flex flex-col gap-3 border-t pt-3">
        <span className="text-sm font-medium">语音转文字（STT）</span>
        <div className="flex flex-col gap-1.5">
          <Label>STT API Key</Label>
          <Input
            type="password"
            autoComplete="off"
            value={sttApiKey}
            onChange={(e) => setSttApiKey(e.target.value)}
            onBlur={() => saveStt({ apiKey: sttApiKey })}
            placeholder="留空则禁用语音识别"
          />
        </div>
        {sttApiKey && (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>STT Base URL</Label>
              <Input
                value={sttBaseUrl}
                onChange={(e) => setSttBaseUrl(e.target.value)}
                onBlur={() => saveStt({ baseUrl: sttBaseUrl || undefined })}
                placeholder="https://open.bigmodel.cn/api/coding/paas/v4"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>STT 模型</Label>
              <Input
                value={sttModel}
                onChange={(e) => setSttModel(e.target.value)}
                onBlur={() => saveStt({ model: sttModel || undefined })}
                placeholder="glm-asr"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
