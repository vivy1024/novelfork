/**
 * 平台集成面板组件
 * Kiro、Codex、Cline 平台集成配置和状态显示
 */

import { useState, useEffect } from "react";
import { Wifi, WifiOff, Settings, RefreshCw, ExternalLink } from "lucide-react";

interface PlatformConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  websocketUrl?: string;
  status: "online" | "offline" | "unknown";
  lastChecked?: number;
}

interface PlatformIntegrationPanelProps {
  onBack?: () => void;
}

export function PlatformIntegrationPanel({ onBack }: PlatformIntegrationPanelProps) {
  const [platforms, setPlatforms] = useState<{
    kiro: PlatformConfig;
    codex: PlatformConfig;
    cline: PlatformConfig;
  }>({
    kiro: { enabled: false, status: "unknown" },
    codex: { enabled: false, status: "unknown" },
    cline: { enabled: false, status: "unknown" },
  });

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    loadPlatformConfigs();
  }, []);

  const loadPlatformConfigs = async () => {
    // TODO: 从后端加载平台配置
    // 这里使用模拟数据
    setTimeout(() => {
      setPlatforms({
        kiro: {
          enabled: true,
          endpoint: "https://api.kiro.ai",
          status: "online",
          lastChecked: Date.now(),
        },
        codex: {
          enabled: true,
          websocketUrl: "wss://codex.anthropic.com",
          status: "online",
          lastChecked: Date.now(),
        },
        cline: {
          enabled: false,
          endpoint: "http://localhost:3000",
          status: "offline",
          lastChecked: Date.now(),
        },
      });
      setLoading(false);
    }, 500);
  };

  const testConnection = async (platform: string) => {
    setTesting(platform);
    // TODO: 实际测试连接
    setTimeout(() => {
      setPlatforms((prev) => ({
        ...prev,
        [platform]: {
          ...prev[platform as keyof typeof prev],
          status: Math.random() > 0.3 ? "online" : "offline",
          lastChecked: Date.now(),
        },
      }));
      setTesting(null);
    }, 1500);
  };

  const togglePlatform = (platform: string, enabled: boolean) => {
    setPlatforms((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform as keyof typeof prev],
        enabled,
      },
    }));
  };

  const renderPlatformCard = (
    name: string,
    displayName: string,
    config: PlatformConfig,
    description: string,
    docsUrl?: string
  ) => {
    const statusColor =
      config.status === "online"
        ? "text-green-600 bg-green-500/10 border-green-500/20"
        : config.status === "offline"
          ? "text-red-600 bg-red-500/10 border-red-500/20"
          : "text-gray-600 bg-gray-500/10 border-gray-500/20";

    return (
      <div className={`border rounded-lg p-4 ${config.enabled ? "bg-card" : "bg-muted/30"}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="font-medium text-sm">{displayName}</h3>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Status */}
            <div className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${statusColor}`}>
              {config.status === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
              {config.status === "online" ? "Online" : config.status === "offline" ? "Offline" : "Unknown"}
            </div>

            {/* Enable Toggle */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => togglePlatform(name, e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>

        {/* Details */}
        {config.enabled && (
          <div className="space-y-3 pt-3 border-t">
            {/* Endpoint */}
            {config.endpoint && (
              <div className="text-xs">
                <span className="text-muted-foreground">Endpoint: </span>
                <span className="font-mono">{config.endpoint}</span>
              </div>
            )}

            {/* WebSocket URL */}
            {config.websocketUrl && (
              <div className="text-xs">
                <span className="text-muted-foreground">WebSocket: </span>
                <span className="font-mono">{config.websocketUrl}</span>
              </div>
            )}

            {/* Last Checked */}
            {config.lastChecked && (
              <div className="text-xs text-muted-foreground">
                Last checked: {new Date(config.lastChecked).toLocaleTimeString()}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => testConnection(name)}
                disabled={testing === name}
                className="px-3 py-1.5 text-xs rounded border hover:bg-accent disabled:opacity-50 flex items-center gap-1"
              >
                <RefreshCw size={12} className={testing === name ? "animate-spin" : ""} />
                {testing === name ? "Testing..." : "Test Connection"}
              </button>

              <button className="px-3 py-1.5 text-xs rounded border hover:bg-accent flex items-center gap-1">
                <Settings size={12} />
                Configure
              </button>

              {docsUrl && (
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-xs rounded border hover:bg-accent flex items-center gap-1"
                >
                  <ExternalLink size={12} />
                  Docs
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div>
          {onBack && (
            <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground mb-2">
              ← Back
            </button>
          )}
          <h1 className="text-2xl font-serif">Platform Integrations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect to external AI platforms and services
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {renderPlatformCard(
          "kiro",
          "Kiro Platform",
          platforms.kiro,
          "Kiro AI platform integration for enhanced model routing",
          "https://docs.kiro.ai"
        )}

        {renderPlatformCard(
          "codex",
          "Codex Platform",
          platforms.codex,
          "Anthropic Codex WebSocket integration for real-time streaming",
          "https://docs.anthropic.com/codex"
        )}

        {renderPlatformCard(
          "cline",
          "Cline Compatibility",
          platforms.cline,
          "Cline-compatible API endpoints for third-party integrations",
          "https://github.com/cline/cline"
        )}

        {/* Info Box */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <h3 className="text-sm font-medium mb-2">About Platform Integrations</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Platform integrations allow InkOS Studio to connect with external AI services and tools.
            Each platform provides different capabilities:
          </p>
          <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc list-inside">
            <li><strong>Kiro</strong>: Advanced model routing and load balancing</li>
            <li><strong>Codex</strong>: Real-time WebSocket streaming for faster responses</li>
            <li><strong>Cline</strong>: Compatibility layer for Cline-based tools and extensions</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
