import { useEffect, useState, type ReactNode } from "react";
import { Box, Globe2, RefreshCw, Terminal, Trash2 } from "lucide-react";

import {
  createRuntimeMaintenanceClient,
  type RuntimeCleanupResult,
  type RuntimeCleanupTarget,
  type RuntimeDiagnosticFields,
  type RuntimeScanResult,
} from "@/app-next/runtime-admin";
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
import { notify } from "@/lib/notify";

const runtimeMaintenanceClient = createRuntimeMaintenanceClient();

const TARGET_LABELS: Readonly<Record<RuntimeCleanupTarget, string>> = {
  terminals: "终端",
  containers: "容器",
  browsers: "浏览器",
};

function runtimeDiagnosticMessage(value?: RuntimeDiagnosticFields): string | undefined {
  return value?.reason ?? value?.message ?? value?.error ?? value?.code ?? value?.dbError;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function formatRuntimeMaintenanceError(reason: unknown, operation: string): string {
  const status = typeof reason === "object" && reason !== null && "status" in reason
    ? Number((reason as { status?: unknown }).status)
    : undefined;
  const message = errorMessage(reason);
  if (status === 403) {
    return `403：${operation}需要 Runtime 管理员权限。${message}`;
  }
  if (status === 401) {
    return `401：Runtime 登录已失效，无法${operation}。${message}`;
  }
  return `${operation}失败：${message}`;
}

function cleanupSuccessDescription(target: RuntimeCleanupTarget, result: RuntimeCleanupResult): string {
  if (target === "terminals") return `已清理 ${result.killed ?? 0} 个退出终端或孤立套接字。`;
  if (target === "containers") return `已停止 ${result.stopped ?? 0} 个运行中容器。`;
  return `已关闭 ${result.closedSessions ?? 0} 个浏览器会话。`;
}

interface ResourceCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly cleanupLabel: string;
  readonly cleanupDisabled: boolean;
  readonly cleaning: boolean;
  readonly diagnostic?: string;
  readonly onCleanup: () => void;
  readonly children: ReactNode;
}

function ResourceCard({
  icon,
  title,
  description,
  cleanupLabel,
  cleanupDisabled,
  cleaning,
  diagnostic,
  onCleanup,
  children,
}: ResourceCardProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="shrink-0 text-muted-foreground">{icon}</div>
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        <CardAction>
          <Button
            type="button"
            variant="destructive"
            size="icon-sm"
            aria-label={cleanupLabel}
            title={cleaning ? "正在清理" : cleanupDisabled ? "当前没有可清理资源" : cleanupLabel}
            onClick={onCleanup}
            disabled={cleanupDisabled || cleaning}
          >
            {cleaning ? <RefreshCw className="motion-safe:animate-spin" /> : <Trash2 />}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">{children}</div>
        {diagnostic ? (
          <Alert>
            <AlertTitle>诊断原因</AlertTitle>
            <AlertDescription>{diagnostic}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LoadingCards() {
  return (
    <div className="grid gap-3 lg:grid-cols-3" aria-label="正在读取运行时缓存">
      {["terminal", "container", "browser"].map((key) => (
        <Card key={key} size="sm">
          <CardHeader>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </CardHeader>
          <CardContent className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function RuntimeEnvironmentPanel() {
  const [scanResult, setScanResult] = useState<RuntimeScanResult | null>(null);
  const [loadingCached, setLoadingCached] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [cleaningTarget, setCleaningTarget] = useState<RuntimeCleanupTarget | null>(null);
  const [cleanupTarget, setCleanupTarget] = useState<RuntimeCleanupTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    runtimeMaintenanceClient.cached()
      .then((result) => {
        if (!cancelled && result.cached) setScanResult(result.data);
      })
      .catch((reason) => {
        if (!cancelled) setError(formatRuntimeMaintenanceError(reason, "读取运行时缓存"));
      })
      .finally(() => {
        if (!cancelled) setLoadingCached(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function scanRuntime() {
    setScanning(true);
    setError(null);
    try {
      const result = await runtimeMaintenanceClient.scan();
      setScanResult(result);
      return true;
    } catch (reason) {
      const message = formatRuntimeMaintenanceError(reason, "扫描运行时资源");
      setError(message);
      notify.error("运行时扫描失败", { description: message });
      return false;
    } finally {
      setScanning(false);
    }
  }

  async function handleConfirmedCleanup() {
    if (!cleanupTarget) return;
    const target = cleanupTarget;
    setCleanupTarget(null);
    setCleaningTarget(target);
    setError(null);
    try {
      const result = await runtimeMaintenanceClient.cleanup(target);
      if (result.dryRun) {
        notify.warning("Runtime 仅返回清理预览", { description: "没有实际删除或停止任何资源。" });
        return;
      }
      if (!result.ok) {
        throw new Error(result.errors?.[0]?.error ?? `${TARGET_LABELS[target]}资源未完成清理`);
      }
      notify.success(`${TARGET_LABELS[target]}资源清理完成`, {
        description: cleanupSuccessDescription(target, result),
      });
      await scanRuntime();
    } catch (reason) {
      const message = formatRuntimeMaintenanceError(reason, `清理${TARGET_LABELS[target]}资源`);
      setError(message);
      notify.error(`${TARGET_LABELS[target]}资源清理失败`, { description: message });
    } finally {
      setCleaningTarget(null);
    }
  }

  const terminals = scanResult?.terminals;
  const containers = scanResult?.containers;
  const browsers = scanResult?.browsers;
  const canCleanTerminals = Boolean(terminals && (terminals.exited > 0 || terminals.orphanSockets > 0));
  const canCleanContainers = Boolean(containers && containers.running > 0);
  const canCleanBrowsers = Boolean(
    browsers && (browsers.processRunning || browsers.headedRunning || browsers.activeSessions > 0),
  );

  return (
    <div data-slot="runtime-environment-panel" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">运行时环境</h2>
          <p className="text-sm text-muted-foreground">
            读取 Runtime 缓存或重新扫描终端、容器与浏览器资源，并通过管理员路由执行真实清理。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {scanResult ? (
            <span className="text-xs text-muted-foreground">
              最近扫描：{new Date(scanResult.scannedAt).toLocaleString("zh-CN")}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void scanRuntime()}
            disabled={loadingCached || scanning || cleaningTarget !== null}
          >
            {scanning ? <RefreshCw data-icon="inline-start" className="motion-safe:animate-spin" /> : <RefreshCw data-icon="inline-start" />}
            {scanning ? "扫描中…" : scanResult ? "重新扫描" : "扫描运行时"}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>Runtime 管理操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loadingCached && !scanResult ? <LoadingCards /> : null}

      {!loadingCached && !scanResult ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><RefreshCw /></EmptyMedia>
            <EmptyTitle>尚无运行时扫描结果</EmptyTitle>
            <EmptyDescription>缓存中没有可用结果。点击“扫描运行时”从真实 Runtime 获取当前资源状态。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {scanResult && terminals && containers && browsers ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <ResourceCard
            icon={<Terminal />}
            title="终端资源"
            description="Runtime 管理的终端进程与孤立套接字。"
            cleanupLabel="清理终端资源"
            cleanupDisabled={!canCleanTerminals}
            cleaning={cleaningTarget === "terminals"}
            diagnostic={runtimeDiagnosticMessage(terminals)}
            onCleanup={() => setCleanupTarget("terminals")}
          >
            <Badge variant="secondary">运行中 {terminals.running}</Badge>
            <Badge variant={terminals.exited > 0 ? "destructive" : "outline"}>已退出 {terminals.exited}</Badge>
            <Badge variant={terminals.orphanSockets > 0 ? "destructive" : "outline"}>孤立套接字 {terminals.orphanSockets}</Badge>
          </ResourceCard>

          <ResourceCard
            icon={<Box />}
            title="容器资源"
            description="Runtime 数据库记录的 Podman 容器。"
            cleanupLabel="清理容器资源"
            cleanupDisabled={!canCleanContainers}
            cleaning={cleaningTarget === "containers"}
            diagnostic={runtimeDiagnosticMessage(containers) ?? (!containers.podmanAvailable ? "未检测到可用的 Podman 运行时。" : undefined)}
            onCleanup={() => setCleanupTarget("containers")}
          >
            <Badge variant={containers.podmanAvailable ? "secondary" : "outline"}>
              Podman {containers.podmanAvailable ? "可用" : "不可用"}
            </Badge>
            <Badge variant={containers.running > 0 ? "destructive" : "outline"}>运行中 {containers.running}</Badge>
            <Badge variant="outline">已停止 {containers.stopped}</Badge>
          </ResourceCard>

          <ResourceCard
            icon={<Globe2 />}
            title="浏览器资源"
            description="Runtime 托管的无头、有头浏览器进程与会话。"
            cleanupLabel="清理浏览器资源"
            cleanupDisabled={!canCleanBrowsers}
            cleaning={cleaningTarget === "browsers"}
            diagnostic={runtimeDiagnosticMessage(browsers)}
            onCleanup={() => setCleanupTarget("browsers")}
          >
            <Badge variant={browsers.processRunning ? "secondary" : "outline"}>
              无头进程 {browsers.processRunning ? "运行中" : "已停止"}
            </Badge>
            <Badge variant={browsers.headedRunning ? "secondary" : "outline"}>
              有头进程 {browsers.headedRunning ? "运行中" : "已停止"}
            </Badge>
            <Badge variant={browsers.activeSessions > 0 ? "destructive" : "outline"}>
              活跃会话 {browsers.activeSessions}
            </Badge>
          </ResourceCard>
        </div>
      ) : null}

      <Dialog open={cleanupTarget !== null} onOpenChange={(open) => { if (!open) setCleanupTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认清理{cleanupTarget ? TARGET_LABELS[cleanupTarget] : "运行时"}资源？</DialogTitle>
            <DialogDescription>
              此操作会调用 Runtime 管理员清理接口，终止或关闭当前可清理资源。完成后会自动重新扫描。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCleanupTarget(null)}>取消</Button>
            <Button type="button" variant="destructive" onClick={() => void handleConfirmedCleanup()}>
              确认清理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
