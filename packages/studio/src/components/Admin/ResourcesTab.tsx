/**
 * 资源监控标签页（WebSocket 实时监控）
 */

import { useState, useEffect, useRef } from "react";
import { Cpu, HardDrive, Network, Activity } from "lucide-react";

interface ResourceStats {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number };
  disk: { used: number; total: number };
  network: { sent: number; received: number };
}

export function ResourcesTab() {
  const [stats, setStats] = useState<ResourceStats | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [history, setHistory] = useState<{ time: number; cpu: number; memory: number }[]>([]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const connectWebSocket = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/admin/resources/ws`);

    ws.onopen = () => {
      console.log("WebSocket connected");
      setConnected(true);
    };

    ws.onmessage = (event) => {
      const data: ResourceStats = JSON.parse(event.data);
      setStats(data);

      // 更新历史数据（保留最近 60 个数据点）
      setHistory((prev) => {
        const newHistory = [
          ...prev,
          {
            time: Date.now(),
            cpu: data.cpu.usage,
            memory: (data.memory.used / data.memory.total) * 100,
          },
        ];
        return newHistory.slice(-60);
      });
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setConnected(false);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      setConnected(false);
      // 5 秒后重连
      setTimeout(connectWebSocket, 5000);
    };

    wsRef.current = ws;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const getUsageColor = (usage: number) => {
    if (usage < 50) return "text-green-600 dark:text-green-400";
    if (usage < 80) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getUsageBgColor = (usage: number) => {
    if (usage < 50) return "bg-green-500";
    if (usage < 80) return "bg-yellow-500";
    return "bg-red-500";
  };

  if (!stats) {
    return (
      <div className="text-center py-8">
        <Activity size={48} className="mx-auto mb-4 text-gray-400 animate-pulse" />
        <p className="text-gray-600 dark:text-gray-400">
          {connected ? "等待数据..." : "连接中..."}
        </p>
      </div>
    );
  }

  const memoryUsagePercent = (stats.memory.used / stats.memory.total) * 100;

  return (
    <div className="space-y-6" data-testid="resource-metrics">
      {/* Connection Status */}
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {connected ? "实时监控中" : "连接断开"}
        </span>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded">
              <Cpu size={24} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">CPU 使用率</div>
              <div className={`text-2xl font-bold ${getUsageColor(stats.cpu.usage)}`}>
                {stats.cpu.usage.toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${getUsageBgColor(stats.cpu.usage)}`}
              style={{ width: `${Math.min(stats.cpu.usage, 100)}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{stats.cpu.cores} 核心</div>
        </div>

        {/* Memory */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded">
              <Activity size={24} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">内存使用</div>
              <div className={`text-2xl font-bold ${getUsageColor(memoryUsagePercent)}`}>
                {memoryUsagePercent.toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${getUsageBgColor(memoryUsagePercent)}`}
              style={{ width: `${Math.min(memoryUsagePercent, 100)}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
          </div>
        </div>

        {/* Disk */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-green-100 dark:bg-green-900 rounded">
              <HardDrive size={24} className="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">磁盘使用</div>
              <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">N/A</div>
            </div>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div className="h-2 rounded-full bg-gray-400" style={{ width: "0%" }} />
          </div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">需要额外库支持</div>
        </div>

        {/* Network */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded">
              <Network size={24} className="text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">网络流量</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {formatBytes(stats.network.sent + stats.network.received)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            <div>↑ {formatBytes(stats.network.sent)}</div>
            <div>↓ {formatBytes(stats.network.received)}</div>
          </div>
        </div>
      </div>

      {/* Simple Chart */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">历史趋势（最近 60 秒）</h3>
        <div className="h-48 flex items-end gap-1">
          {history.map((point, i) => (
            <div key={i} className="flex-1 flex flex-col gap-1">
              <div
                className="bg-blue-500 rounded-t"
                style={{ height: `${point.cpu}%` }}
                title={`CPU: ${point.cpu.toFixed(1)}%`}
              />
              <div
                className="bg-purple-500 rounded-t"
                style={{ height: `${point.memory}%` }}
                title={`Memory: ${point.memory.toFixed(1)}%`}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded" />
            <span className="text-gray-600 dark:text-gray-400">CPU</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-purple-500 rounded" />
            <span className="text-gray-600 dark:text-gray-400">内存</span>
          </div>
        </div>
      </div>
    </div>
  );
}
