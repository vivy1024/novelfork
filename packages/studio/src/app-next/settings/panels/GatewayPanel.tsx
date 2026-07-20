import { useCallback, useEffect, useState } from "react";
import { MessagesSquare, RefreshCw, RotateCcw, Trash2 } from "lucide-react";

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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
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
  type GatewaySession,
  type GatewayStatus,
} from "../../runtime-admin/gateway";

const gatewayClient = createGatewayClient();

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  feishu: "Feishu / Lark",
  webhook: "Webhook",
  weixin: "微信",
  qqbot: "QQ Bot",
};

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

export function GatewayPanel() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [sessions, setSessions] = useState<readonly GatewaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<GatewaySession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadGateway = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [statusResult, sessionsResult] = await Promise.allSettled([
      gatewayClient.status(),
      gatewayClient.sessions(),
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

    setError(failures.length > 0 ? failures.join("；") : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadGateway();
  }, [loadGateway]);

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

  return (
    <div data-slot="gateway-panel" className="flex flex-col gap-6">
      <div data-slot="gateway-panel-header">
        <h2 className="text-lg font-semibold text-foreground">Gateway</h2>
        <p className="text-sm text-muted-foreground">
          查看外部聊天渠道的运行状态，重载已配置平台，并管理聊天会话。
        </p>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>Gateway 操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

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
            <p className="text-sm text-muted-foreground">暂时无法获取渠道状态。</p>
          )}
        </CardContent>
      </Card>

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
