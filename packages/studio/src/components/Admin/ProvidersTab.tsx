import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, EyeOff, PlugZap, Server, Unplug } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "../../hooks/use-api";

interface ProviderModel {
  id?: string;
  name?: string;
}

interface Provider {
  id: string;
  name: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
  models: Array<string | ProviderModel>;
  enabled: boolean;
  priority: number;
}

interface ConnectionFeedback {
  tone: "success" | "error";
  message: string;
}

export function ProvidersTab() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ConnectionFeedback | null>(null);

  useEffect(() => {
    void loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      const data = await fetchJson<{ providers: Provider[] }>("/api/admin/providers");
      setProviders(data.providers);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "加载供应商失败",
      });
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    const enabledCount = providers.filter((provider) => provider.enabled).length;
    const modelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);
    return {
      providerCount: providers.length,
      enabledCount,
      modelCount,
    };
  }, [providers]);

  const toggleProvider = async (id: string, enabled: boolean) => {
    setBusyProviderId(id);
    try {
      await fetchJson(`/api/providers/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      setFeedback({
        tone: "success",
        message: enabled ? "供应商已启用" : "供应商已禁用",
      });
      await loadProviders();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "切换供应商失败",
      });
    } finally {
      setBusyProviderId(null);
    }
  };

  const testConnection = async (id: string) => {
    setBusyProviderId(id);
    try {
      const result = await fetchJson<{ success: boolean; latency?: number; error?: string }>(
        `/api/providers/${id}/test`,
        { method: "POST" },
      );
      setFeedback(
        result.success
          ? {
              tone: "success",
              message: `连接成功，延迟 ${result.latency ?? "--"}ms`,
            }
          : {
              tone: "error",
              message: `连接失败：${result.error ?? "未知错误"}`,
            },
      );
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "连接测试失败",
      });
    } finally {
      setBusyProviderId(null);
    }
  };

  const maskApiKey = (key?: string) => {
    if (!key) return "未配置";
    if (key.length <= 8) return "***";
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  };

  const getModelLabel = (model: string | ProviderModel) => {
    if (typeof model === "string") return model;
    return model.name || model.id || "未命名模型";
  };

  const getModelKey = (model: string | ProviderModel, index: number) => {
    if (typeof model === "string") return model;
    return model.id || model.name || `model-${index}`;
  };

  if (loading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">正在加载供应商状态…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">供应商总览</h2>
          <p className="text-sm text-muted-foreground">统一查看模型资源池、启用状态、验证情况与连接反馈。</p>
        </div>
        <Button variant="outline" onClick={() => void loadProviders()}>
          刷新供应商
        </Button>
      </div>

      {feedback && (
        <Card className={feedback.tone === "success" ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}>
          <CardContent className="py-4 text-sm">
            {feedback.message}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="供应商总数" value={String(summary.providerCount)} description="已接入的模型供应来源" />
        <SummaryCard title="启用中" value={String(summary.enabledCount)} description="当前参与调度的供应商数量" />
        <SummaryCard title="模型总数" value={String(summary.modelCount)} description="已注册到资源池的模型数量" />
      </div>

      {providers.length === 0 ? (
        <PageEmptyState title="暂无 API 供应商" description="接入供应商后，这里会展示状态、模型数量和连接检查结果。" />
      ) : (
        <div className="grid gap-4">
          {providers.map((provider) => {
            const isBusy = busyProviderId === provider.id;
            return (
              <Card key={provider.id}>
                <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-lg">{provider.name}</CardTitle>
                      <Badge variant="outline">{provider.type}</Badge>
                      <Badge variant={provider.enabled ? "secondary" : "outline"}>
                        {provider.enabled ? "已启用" : "未启用"}
                      </Badge>
                    </div>
                    <CardDescription>
                      优先级 {provider.priority}
                      {provider.baseUrl ? ` · ${provider.baseUrl}` : " · 使用默认网关地址"}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={provider.enabled ? "outline" : "default"}
                      disabled={isBusy}
                      onClick={() => void toggleProvider(provider.id, !provider.enabled)}
                    >
                      {provider.enabled ? <Unplug className="size-4" /> : <PlugZap className="size-4" />}
                      {provider.enabled ? "禁用" : "启用"}
                    </Button>
                    <Button variant="secondary" disabled={isBusy} onClick={() => void testConnection(provider.id)}>
                      <CheckCircle2 className="size-4" />
                      测试连接
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">API Key</div>
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <span className="font-mono">{showKeys[provider.id] ? provider.apiKey || "未配置" : maskApiKey(provider.apiKey)}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowKeys((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                        >
                          {showKeys[provider.id] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/70 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">模型资源池</div>
                      <div className="flex flex-wrap gap-2">
                        {provider.models.length > 0 ? (
                          provider.models.map((model, index) => (
                            <Badge key={getModelKey(model, index)} variant="secondary">{getModelLabel(model)}</Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">暂无模型</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                    <div className="mb-3 flex items-center gap-2 text-foreground">
                      <Server className="size-4 text-primary" />
                      连接摘要
                    </div>
                    <ul className="space-y-2">
                      <li>启用状态：{provider.enabled ? "已参与调度" : "当前未参与"}</li>
                      <li>模型数量：{provider.models.length}</li>
                      <li>接入方式：{provider.type}</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
