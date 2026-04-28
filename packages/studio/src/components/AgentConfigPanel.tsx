/**
 * Agent 配置面板组件
 * 工作区限制、容器限制、端口范围配置、实时资源使用显示
 */

import { useState, useEffect } from "react";
import { Save, RotateCcw, AlertTriangle, CheckCircle } from "lucide-react";
import { fetchJson } from "../hooks/use-api";
import { notify } from "@/lib/notify";
import type { AgentConfig, AgentResourceUsage } from "../shared/agent-config-types";

interface AgentConfigPanelProps {
  onBack?: () => void;
}

export function AgentConfigPanel({ onBack }: AgentConfigPanelProps) {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [usage, setUsage] = useState<AgentResourceUsage | null>(null);
  const [stats, setStats] = useState<{
    workspaceUsagePercent: number | null;
    containerUsagePercent: number | null;
    portUsagePercent: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadConfig();
    loadUsage();
    // 每 5 秒刷新资源使用情况
    const interval = setInterval(loadUsage, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadConfig = async () => {
    try {
      const data = await fetchJson<{ config: AgentConfig }>("/api/agent/config");
      setConfig(data.config);
    } catch (error) {
      console.error("Failed to load agent config:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadUsage = async () => {
    try {
      const data = await fetchJson<{
        usage: AgentResourceUsage;
        stats: { workspaceUsagePercent: number | null; containerUsagePercent: number | null; portUsagePercent: number };
      }>("/api/agent/config/usage");
      setUsage(data.usage);
      setStats(data.stats);
    } catch (error) {
      console.error("Failed to load resource usage:", error);
    }
  };

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    setSaved(false);
    try {
      await fetchJson("/api/agent/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      notify.error("配置保存失败", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset all settings to default values?")) return;

    try {
      const data = await fetchJson<{ config: AgentConfig }>("/api/agent/config/reset", {
        method: "POST",
      });
      setConfig(data.config);
    } catch (error) {
      notify.error("配置重置失败", { description: error instanceof Error ? error.message : undefined });
    }
  };

  const getUsageColor = (percent: number | null) => {
    if (percent === null) return "text-muted-foreground";
    if (percent >= 90) return "text-red-600";
    if (percent >= 70) return "text-yellow-600";
    return "text-green-600";
  };

  const formatUsageValue = (value: number | null) => value === null ? "未知" : String(value);
  const formatUsagePercent = (value: number | null) => value === null ? "未接入真实运行时" : `${value}% used`;

  if (loading || !config) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            {onBack && (
              <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground mb-2">
                ← Back
              </button>
            )}
            <h1 className="text-2xl font-serif">Agent Configuration</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Control Agent resource usage and runtime behavior
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-2 text-sm rounded border hover:bg-accent flex items-center gap-2"
            >
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {saved ? <CheckCircle size={14} /> : <Save size={14} />}
              {saving ? "Saving..." : saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Resource Usage Overview */}
        {usage && stats && (
          <div className="border rounded-lg p-4 bg-card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Current Resource Usage</h2>
              {usage.source === "unknown" && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">
                  资源事实源未接入
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Workspaces</div>
                <div className={`text-2xl font-bold ${getUsageColor(stats.workspaceUsagePercent)}`}>
                  {formatUsageValue(usage.activeWorkspaces)} / {config.maxActiveWorkspaces}
                </div>
                <div className="text-xs text-muted-foreground">{formatUsagePercent(stats.workspaceUsagePercent)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Containers</div>
                <div className={`text-2xl font-bold ${getUsageColor(stats.containerUsagePercent)}`}>
                  {formatUsageValue(usage.activeContainers)} / {config.maxActiveContainers}
                </div>
                <div className="text-xs text-muted-foreground">{formatUsagePercent(stats.containerUsagePercent)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Workspace Size</div>
                <div className="text-2xl font-bold">
                  {usage.totalWorkspaceSize === null ? "未知" : `${usage.totalWorkspaceSize.toFixed(0)} MB`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {usage.totalWorkspaceSize === null ? "未接入真实运行时" : usage.totalWorkspaceSize >= config.workspaceSizeWarning && (
                    <span className="text-yellow-600 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      Above threshold
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Workspace Settings */}
        <div className="border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-medium mb-3">Workspace Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-2">
                Max Active Workspaces
                <span className="text-xs text-muted-foreground ml-2">(1-100)</span>
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={config.maxActiveWorkspaces}
                onChange={(e) => setConfig({ ...config, maxActiveWorkspaces: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-2">
                Workspace Size Warning (MB)
                <span className="text-xs text-muted-foreground ml-2">(10-10000)</span>
              </label>
              <input
                type="number"
                min={10}
                max={10000}
                step={10}
                value={config.workspaceSizeWarning}
                onChange={(e) => setConfig({ ...config, workspaceSizeWarning: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Show warning when workspace size exceeds this threshold
              </p>
            </div>
          </div>
        </div>

        {/* Container Settings */}
        <div className="border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-medium mb-3">Container Settings</h2>
          <div>
            <label className="text-sm font-medium block mb-2">
              Max Active Containers
              <span className="text-xs text-muted-foreground ml-2">(1-50)</span>
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={config.maxActiveContainers}
              onChange={(e) => setConfig({ ...config, maxActiveContainers: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Port Range Settings */}
        <div className="border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-medium mb-3">Port Range</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-2">Start Port</label>
              <input
                type="number"
                min={1024}
                max={65535}
                value={config.portRangeStart}
                onChange={(e) => setConfig({ ...config, portRangeStart: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">End Port</label>
              <input
                type="number"
                min={1024}
                max={65535}
                value={config.portRangeEnd}
                onChange={(e) => setConfig({ ...config, portRangeEnd: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Available ports: {usage?.availablePorts ?? config.portRangeEnd - config.portRangeStart + 1}
            {config.portRangeEnd - config.portRangeStart < 100 && (
              <span className="text-yellow-600 ml-2">⚠ Minimum 100 ports recommended</span>
            )}
          </p>
        </div>

        {/* Behavior Settings */}
        <div className="border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-medium mb-3">Behavior</h2>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.autoSaveOnSleep}
              onChange={(e) => setConfig({ ...config, autoSaveOnSleep: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span className="text-sm">Auto-save on sleep</span>
          </label>
          <p className="text-xs text-muted-foreground mt-1 ml-6">
            Automatically save workspace state when Agent goes to sleep
          </p>
        </div>
      </div>
    </div>
  );
}
