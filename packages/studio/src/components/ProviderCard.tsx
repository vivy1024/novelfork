/**
 * AI 提供商卡片组件
 * 显示单个提供商信息（名称、状态、模型数量、启用开关、配置按钮）
 */

import { useState } from "react";
import { Power, Settings, Wifi, WifiOff, ChevronDown, ChevronRight } from "lucide-react";
import type { AIProvider } from "../shared/provider-manager-types";

interface ProviderCardProps {
  provider: AIProvider;
  onToggle: (id: string, enabled: boolean) => void;
  onConfigure: (id: string) => void;
  onTest: (id: string) => Promise<{ success: boolean; latency?: number; error?: string }>;
}

export function ProviderCard({ provider, onToggle, onConfigure, onTest }: ProviderCardProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latency?: number; error?: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(provider.id);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : "测试失败",
      });
    } finally {
      setTesting(false);
    }
  };

  const getProviderTypeLabel = (type: string) => {
    switch (type) {
      case "anthropic":
        return "Anthropic";
      case "openai":
        return "OpenAI";
      default:
        return type;
    }
  };

  return (
    <div className={`border rounded-lg p-4 ${provider.enabled ? "bg-card" : "bg-muted/30"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-accent rounded transition-colors"
            aria-label={expanded ? "收起供应商详情" : "展开供应商详情"}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <div>
            <h3 className="font-medium text-sm">{provider.name}</h3>
            <p className="text-xs text-muted-foreground">{getProviderTypeLabel(provider.type)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {provider.models.length} 个模型
          </span>

          <button
            onClick={() => onToggle(provider.id, !provider.enabled)}
            className={`p-1.5 rounded transition-colors ${
              provider.enabled
                ? "bg-green-500/20 text-green-600 hover:bg-green-500/30"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title={provider.enabled ? "停用供应商" : "启用供应商"}
          >
            <Power size={14} />
          </button>

          <button
            onClick={() => onConfigure(provider.id)}
            className="p-1.5 rounded hover:bg-accent transition-colors"
            title="配置供应商"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 pt-3 border-t">
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">模型</h4>
            <div className="space-y-1">
              {provider.models.map((model) => (
                <div key={model.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/50">
                  <span>{model.name}</span>
                  <span className="text-muted-foreground">
                    上下文 {(model.contextWindow / 1000).toFixed(0)}K
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <button
              onClick={handleTest}
              disabled={testing || !provider.enabled}
              className="w-full px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? "测试中..." : "测试连接"}
            </button>

            {testResult && (
              <div className={`mt-2 p-2 rounded text-xs ${
                testResult.success
                  ? "bg-green-500/10 text-green-600 border border-green-500/20"
                  : "bg-red-500/10 text-red-600 border border-red-500/20"
              }`}>
                <div className="flex items-center gap-2">
                  {testResult.success ? <Wifi size={12} /> : <WifiOff size={12} />}
                  <span>
                    {testResult.success
                      ? `已连接（${testResult.latency}ms）`
                      : testResult.error || "连接失败"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {provider.config.endpoint && (
            <div className="text-xs">
              <span className="text-muted-foreground">端点：</span>
              <span className="font-mono">{provider.config.endpoint}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
