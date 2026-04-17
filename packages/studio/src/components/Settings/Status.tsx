import { useEffect, useState } from "react";
import { Activity, Database, Cpu, HardDrive } from "lucide-react";

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
    // 模拟状态数据（实际应从 API 获取）
    const timer = setInterval(() => {
      setStatus((prev) => ({
        ...prev,
        uptime: prev.uptime + 1,
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-xl font-semibold mb-4 text-foreground">系统状态</h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* 版本信息 */}
        <div className="p-4 rounded-lg border border-border bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">版本</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{status.version}</p>
        </div>

        {/* 运行时间 */}
        <div className="p-4 rounded-lg border border-border bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">运行时间</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatUptime(status.uptime)}</p>
        </div>

        {/* 内存使用 */}
        <div className="p-4 rounded-lg border border-border bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">内存</span>
          </div>
          <p className="text-lg font-bold text-foreground">
            {status.memory.used} MB / {status.memory.total} MB
          </p>
        </div>

        {/* 存储空间 */}
        <div className="p-4 rounded-lg border border-border bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">存储</span>
          </div>
          <p className="text-lg font-bold text-foreground">
            {status.storage.used} GB / {status.storage.total} GB
          </p>
        </div>
      </div>
    </div>
  );
}
