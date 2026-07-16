import { useCallback, useEffect, useState } from "react";
import { Boxes, Cable, RefreshCw, ServerCog } from "lucide-react";

import {
  createGatewayClient,
  createSettingsClient,
  type GatewayStatus,
  type RuntimeSettings,
} from "@/app-next/runtime-admin";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const settingsClient = createSettingsClient();
const gatewayClient = createGatewayClient();

function objectSummary(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Runtime 未返回配置";
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "使用 Runtime 默认配置";
  return entries
    .slice(0, 6)
    .map(([key, nested]) => `${key}: ${typeof nested === "object" ? "已配置" : String(nested)}`)
    .join(" · ");
}

export function MonitoringPanel() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSettings, nextGateway] = await Promise.all([
        settingsClient.get(),
        gatewayClient.status(),
      ]);
      setSettings(nextSettings);
      setGateway(nextGateway);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">运行资源</h2>
          <p className="text-sm text-muted-foreground">展示 Runtime 已公开的容器、章节与消息网关状态，不伪造 CPU、内存或磁盘指标。</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} data-icon="inline-start" />
          刷新
        </Button>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>运行资源读取失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Alert>
        <AlertTitle>资源指标边界</AlertTitle>
        <AlertDescription>
          当前 Runtime 没有面向 Studio 的 CPU、内存和磁盘实时指标契约；存储占用请前往“存储空间”。此页面只显示现有原生 API 能确认的资源状态。
        </AlertDescription>
      </Alert>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-36 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Cable className="size-4 text-muted-foreground" />消息网关</CardTitle>
              <CardDescription>来自 Runtime 消息网关状态接口。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">服务状态</span><Badge variant={gateway?.started ? "default" : "secondary"}>{gateway?.started ? "已启动" : "未启动"}</Badge></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">已连接平台</span><span className="font-mono">{gateway?.platforms.length ?? 0}</span></div>
              {(gateway?.platforms ?? []).length > 0 ? <p className="text-xs text-muted-foreground">{gateway?.platforms.join("、")}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Boxes className="size-4 text-muted-foreground" />章节容器</CardTitle>
              <CardDescription>读取 Runtime `settings.containers`，不在此执行容器清理。</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{objectSummary(settings?.containers)}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ServerCog className="size-4 text-muted-foreground" />章节运行配置</CardTitle>
              <CardDescription>读取 Runtime `settings.chapters`。</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{objectSummary(settings?.chapters)}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
