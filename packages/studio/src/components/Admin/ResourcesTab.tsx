/**
 * 资源监控标签页
 */

import { useEffect, useState, type ReactNode } from "react";
import { Activity, Cpu, HardDrive, Network } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "../../hooks/use-api";

interface ResourceStats {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number };
  disk: { used: number; total: number };
  network: { sent: number; received: number };
}

export function ResourcesTab() {
  const [stats, setStats] = useState<ResourceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadResources();
  }, []);

  const loadResources = async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ stats: ResourceStats }>("/api/admin/resources");
      setStats(data.stats);
      setError(null);
    } catch (loadError) {
      setStats(null);
      setError(loadError instanceof Error ? loadError.message : "加载资源快照失败");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <PageEmptyState
        title="正在加载资源数据"
        description="正在向 /api/admin/resources 拉取最新系统快照。"
        icon={Activity}
      />
    );
  }

  if (error) {
    return (
      <PageEmptyState
        title="资源数据加载失败"
        description={error}
        action={<Button variant="outline" onClick={() => void loadResources()}>重试</Button>}
      />
    );
  }

  if (!stats) {
    return (
      <PageEmptyState
        title="暂无资源数据"
        description="接入资源监控后，这里会显示 CPU、内存、磁盘和网络快照。"
        icon={Activity}
        action={<Button variant="outline" onClick={() => void loadResources()}>刷新</Button>}
      />
    );
  }

  const memoryUsagePercent = stats.memory.total > 0 ? (stats.memory.used / stats.memory.total) * 100 : 0;
  const diskUsagePercent = stats.disk.total > 0 ? (stats.disk.used / stats.disk.total) * 100 : 0;
  const networkTotal = stats.network.sent + stats.network.received;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">资源监控</h2>
            <Badge variant="secondary">API 快照</Badge>
          </div>
          <p className="text-sm text-muted-foreground">直接读取 /api/admin/resources 的最新系统快照，避免 WebSocket 重连抖动。</p>
        </div>
        <Button variant="outline" onClick={() => void loadResources()}>
          刷新
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Cpu}
          title="CPU 使用率"
          value={`${stats.cpu.usage.toFixed(1)}%`}
          description={`${stats.cpu.cores} 核心`}
          ratio={Math.min(stats.cpu.usage, 100)}
          ratioLabel="CPU 负载"
          accent="blue"
        />
        <MetricCard
          icon={Activity}
          title="内存使用"
          value={`${memoryUsagePercent.toFixed(1)}%`}
          description={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
          ratio={Math.min(memoryUsagePercent, 100)}
          ratioLabel="内存占用"
          accent="violet"
        />
        <MetricCard
          icon={HardDrive}
          title="磁盘使用"
          value={stats.disk.total > 0 ? `${diskUsagePercent.toFixed(1)}%` : "待接入"}
          description={stats.disk.total > 0 ? `${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}` : "当前 API 暂未返回磁盘统计"}
          ratio={stats.disk.total > 0 ? Math.min(diskUsagePercent, 100) : undefined}
          ratioLabel={stats.disk.total > 0 ? "磁盘占用" : undefined}
          accent="emerald"
          badge={stats.disk.total > 0 ? undefined : <Badge variant="outline">未接入</Badge>}
        />
        <MetricCard
          icon={Network}
          title="网络流量"
          value={formatBytes(networkTotal)}
          description={`↑ ${formatBytes(stats.network.sent)} · ↓ ${formatBytes(stats.network.received)}`}
          ratio={networkTotal > 0 ? Math.min((stats.network.sent / networkTotal) * 100, 100) : undefined}
          ratioLabel="发送占比"
          accent="amber"
        />
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  description,
  ratio,
  ratioLabel,
  badge,
  accent,
}: {
  icon: typeof Cpu;
  title: string;
  value: string;
  description: string;
  ratio?: number;
  ratioLabel?: string;
  badge?: ReactNode;
  accent: "blue" | "violet" | "emerald" | "amber";
}) {
  const accentClassName = {
    blue: "border-sky-500/20 bg-sky-500/5",
    violet: "border-violet-500/20 bg-violet-500/5",
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    amber: "border-amber-500/20 bg-amber-500/5",
  }[accent];

  const barClassName = {
    blue: "bg-sky-500",
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
  }[accent];

  return (
    <Card size="sm" className={accentClassName}>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <CardDescription className="flex items-center gap-2">
            <Icon className="size-4 text-primary" />
            {title}
          </CardDescription>
          {badge}
        </div>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {ratio !== undefined ? (
          <div className="space-y-1.5">
            <div className="h-2 rounded-full bg-muted/80">
              <div className={`h-2 rounded-full ${barClassName}`} style={{ width: `${Math.max(0, Math.min(ratio, 100))}%` }} />
            </div>
            {ratioLabel && <p className="text-xs text-muted-foreground">{ratioLabel}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">暂未提供百分比数据</p>
        )}
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
