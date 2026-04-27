import { useState, useEffect } from "react";
import { fetchJson } from "../../../hooks/use-api";
import { Activity, Cpu, HardDrive, MemoryStick } from "lucide-react";

interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  timestamp: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function MonitoringPanel() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMetrics() {
      try {
        const data = await fetchJson<SystemMetrics>("/settings/metrics");
        setMetrics(data);
        setLoading(false);
      } catch {
        setLoading(false);
      }
    }

    loadMetrics();
    const interval = setInterval(loadMetrics, 5000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="text-muted-foreground">加载中...</div>;
  }

  if (!metrics) {
    return <div className="text-muted-foreground">无法获取系统指标</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">系统监控</h2>
        <p className="text-sm text-muted-foreground">
          实时查看系统资源使用情况
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* CPU 使用率 */}
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Cpu className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">CPU</h3>
              <p className="text-xs text-muted-foreground">{metrics.cpu.cores} 核心</p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">使用率</span>
              <span className="font-mono text-foreground">{metrics.cpu.usage}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${metrics.cpu.usage}%` }}
              />
            </div>
          </div>
        </div>

        {/* 内存使用率 */}
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-green-500/10">
              <MemoryStick className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">内存</h3>
              <p className="text-xs text-muted-foreground">
                {formatBytes(metrics.memory.total)} 总计
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">已用</span>
              <span className="font-mono text-foreground">
                {formatBytes(metrics.memory.used)} ({metrics.memory.usagePercent}%)
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{ width: `${metrics.memory.usagePercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* 磁盘使用率 */}
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <HardDrive className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">磁盘</h3>
              <p className="text-xs text-muted-foreground">
                {formatBytes(metrics.disk.total)} 总计
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">已用</span>
              <span className="font-mono text-foreground">
                {formatBytes(metrics.disk.used)} ({metrics.disk.usagePercent}%)
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-purple-500 h-2 rounded-full transition-all"
                style={{ width: `${metrics.disk.usagePercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* 更新时间 */}
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-orange-500/10">
              <Activity className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">监控状态</h3>
              <p className="text-xs text-muted-foreground">每 5 秒更新</p>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            最后更新：{new Date(metrics.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}
