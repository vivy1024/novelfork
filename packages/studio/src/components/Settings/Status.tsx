import { useEffect, useState } from "react";
import { Activity, Cpu, Database, HardDrive } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface StatusProps {
  theme: "light" | "dark";
}

interface SystemStatus {
  version: string;
  uptime: number;
  memory: { used: number; total: number };
  storage: { used: number; total: number };
}

export function Status({ theme }: StatusProps) {
  const [status, setStatus] = useState<SystemStatus>({
    version: "2.0.0",
    uptime: 0,
    memory: { used: 0, total: 0 },
    storage: { used: 0, total: 0 },
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setStatus((prev) => ({
        ...prev,
        uptime: prev.uptime + 1,
      }));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">系统状态</h2>
          <p className="text-sm text-muted-foreground">展示当前应用版本、运行时长和资源占用的本地快照。</p>
        </div>
        <Badge variant="outline">{theme === "dark" ? "深色" : "浅色"}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard
          icon={Activity}
          title="版本"
          value={status.version}
          description="当前应用版本"
        />
        <MetricCard
          icon={Cpu}
          title="运行时间"
          value={formatUptime(status.uptime)}
          description="自页面加载以来累计时长"
        />
        <MetricCard
          icon={Database}
          title="内存"
          value={formatBytes(status.memory.used)}
          description={status.memory.total > 0 ? `${formatBytes(status.memory.used)} / ${formatBytes(status.memory.total)}` : "当前为本地模拟数据"}
          ratio={status.memory.total > 0 ? Math.min((status.memory.used / status.memory.total) * 100, 100) : undefined}
          ratioLabel={status.memory.total > 0 ? "内存占用" : undefined}
        />
        <MetricCard
          icon={HardDrive}
          title="存储"
          value={status.storage.total > 0 ? formatBytes(status.storage.used) : "待接入"}
          description={status.storage.total > 0 ? `${formatBytes(status.storage.used)} / ${formatBytes(status.storage.total)}` : "磁盘统计后续接入"}
          ratio={status.storage.total > 0 ? Math.min((status.storage.used / status.storage.total) * 100, 100) : undefined}
          ratioLabel={status.storage.total > 0 ? "存储占用" : undefined}
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
}: {
  icon: typeof Activity;
  title: string;
  value: string;
  description: string;
  ratio?: number;
  ratioLabel?: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          {title}
        </CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {ratio !== undefined && (
          <div className="space-y-1.5">
            <div className="h-2 rounded-full bg-muted/80">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(ratio, 100))}%` }} />
            </div>
            {ratioLabel && <p className="text-xs text-muted-foreground">{ratioLabel}</p>}
          </div>
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
  const index = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, index)).toFixed(2)} ${sizes[index]}`;
}
