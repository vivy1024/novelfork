import { useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle, Loader, Puzzle, RefreshCw, Settings, XCircle } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { Switch } from "../components/ui/switch";
import { postApi, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface PluginMetadata {
  manifest: {
    name: string;
    displayName: string;
    version: string;
    description: string;
    author?: string;
    homepage?: string;
    tools?: string[];
    hooks?: string[];
  };
  state: "discovered" | "loaded" | "initialized" | "active" | "error" | "terminated";
  path: string;
  error?: string;
  toolsCount: number;
  hooksCount: number;
  enabled: boolean;
}

interface PluginManagerProps {
  nav: { toWorkflow?: () => void };
  theme: Theme;
  t: TFunction;
}

export function PluginManager({ nav, theme, t }: PluginManagerProps) {
  const c = useColors(theme);
  const { data: pluginsData, refetch } = useApi<{ plugins: PluginMetadata[] }>("/plugins");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const plugins = pluginsData?.plugins || [];
  const selected = plugins.find((p) => p.manifest.name === selectedPlugin);

  const handleToggle = async (pluginName: string, enabled: boolean) => {
    setLoading(pluginName);
    try {
      if (enabled) {
        await postApi("/plugins/enable", { pluginName });
      } else {
        await postApi("/plugins/disable", { pluginName });
      }
      await refetch();
    } catch (e) {
      console.error("Failed to toggle plugin:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleSaveConfig = async () => {
    if (!selectedPlugin) return;

    setLoading(selectedPlugin);
    try {
      await postApi("/plugins/config", {
        pluginName: selectedPlugin,
        config: configValues,
      });
      await refetch();
    } catch (e) {
      console.error("Failed to save config:", e);
    } finally {
      setLoading(null);
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case "active":
        return <CheckCircle className="size-4 text-green-500" />;
      case "error":
        return <XCircle className="size-4 text-red-500" />;
      case "discovered":
      case "loaded":
      case "initialized":
        return <AlertCircle className="size-4 text-yellow-500" />;
      default:
        return <Loader className="size-4 text-gray-500" />;
    }
  };

  const getStateBadge = (state: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      error: "destructive",
      discovered: "secondary",
      loaded: "secondary",
      initialized: "secondary",
      terminated: "outline",
    };
    return <Badge variant={variants[state] || "outline"}>{state}</Badge>;
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="插件管理"
        description="把扩展插件的启用、状态查看和配置保存收口到工作流配置台。"
        actions={
          <>
            {nav.toWorkflow && (
              <button onClick={() => nav.toWorkflow?.()} className="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70">
                工作流总览
              </button>
            )}
            <Button variant="outline" onClick={() => void refetch()}>
              <RefreshCw className="size-4" />
              刷新
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="space-y-4">
          {plugins.length === 0 ? (
            <PageEmptyState
              title="暂无插件"
              description="将插件放到 plugins/ 目录后，这里会自动发现并展示。"
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  <RefreshCw className="size-4" />
                  刷新
                </Button>
              }
            />
          ) : (
            plugins.map((plugin) => (
              <Card
                key={plugin.manifest.name}
                className={`cursor-pointer p-6 transition-all hover:shadow-md ${selectedPlugin === plugin.manifest.name ? "ring-2 ring-primary" : ""}`}
                onClick={() => setSelectedPlugin(plugin.manifest.name)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      {getStateIcon(plugin.state)}
                      <h3 className="text-lg font-semibold text-foreground">{plugin.manifest.displayName}</h3>
                      {getStateBadge(plugin.state)}
                    </div>
                    <p className="mb-3 text-sm text-muted-foreground">{plugin.manifest.description}</p>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span>v{plugin.manifest.version}</span>
                      {plugin.manifest.author && <span>by {plugin.manifest.author}</span>}
                      <span>{plugin.toolsCount} tools</span>
                      <span>{plugin.hooksCount} hooks</span>
                    </div>
                    {plugin.error && <div className="mt-3 rounded bg-destructive/10 p-2 text-xs text-destructive">{plugin.error}</div>}
                  </div>
                  <Switch
                    checked={plugin.enabled}
                    onCheckedChange={(checked) => handleToggle(plugin.manifest.name, checked)}
                    disabled={loading === plugin.manifest.name}
                  />
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          {selected ? (
            <>
              <Card className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Settings className="size-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">{t("plugins.details") || "插件详情"}</h3>
                </div>
                <Separator className="mb-4" />
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <span className="ml-2 font-mono text-foreground">{selected.manifest.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Version:</span>
                    <span className="ml-2 text-foreground">{selected.manifest.version}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">State:</span>
                    <span className="ml-2">{getStateBadge(selected.state)}</span>
                  </div>
                  {selected.manifest.author && (
                    <div>
                      <span className="text-muted-foreground">Author:</span>
                      <span className="ml-2 text-foreground">{selected.manifest.author}</span>
                    </div>
                  )}
                  {selected.manifest.homepage && (
                    <div>
                      <span className="text-muted-foreground">Homepage:</span>
                      <a href={selected.manifest.homepage} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary hover:underline">
                        {selected.manifest.homepage}
                      </a>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Path:</span>
                    <span className="ml-2 break-all font-mono text-xs text-foreground">{selected.path}</span>
                  </div>
                </div>

                {selected.manifest.tools && selected.manifest.tools.length > 0 && (
                  <>
                    <Separator className="my-4" />
                    <div>
                      <h4 className="mb-2 text-sm font-semibold text-foreground">{t("plugins.tools") || "Tools"}</h4>
                      <div className="flex flex-wrap gap-2">
                        {selected.manifest.tools.map((tool) => (
                          <Badge key={tool} variant="secondary">
                            {tool}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {selected.manifest.hooks && selected.manifest.hooks.length > 0 && (
                  <>
                    <Separator className="my-4" />
                    <div>
                      <h4 className="mb-2 text-sm font-semibold text-foreground">{t("plugins.hooks") || "Hooks"}</h4>
                      <div className="flex flex-wrap gap-2">
                        {selected.manifest.hooks.map((hook) => (
                          <Badge key={hook} variant="outline">
                            {hook}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </Card>

              <Card className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Settings className="size-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">{t("plugins.config") || "配置"}</h3>
                </div>
                <Separator className="mb-4" />
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="backupDir">Backup Directory</Label>
                    <Input
                      id="backupDir"
                      value={(configValues.backupDir as string) || "./backups"}
                      onChange={(e) => setConfigValues({ ...configValues, backupDir: e.target.value })}
                      placeholder="./backups"
                    />
                  </div>
                  <div>
                    <Label htmlFor="maxBackups">Max Backups</Label>
                    <Input
                      id="maxBackups"
                      type="number"
                      value={(configValues.maxBackups as number) || 5}
                      onChange={(e) => setConfigValues({ ...configValues, maxBackups: parseInt(e.target.value) })}
                      placeholder="5"
                    />
                  </div>
                  <Button onClick={handleSaveConfig} disabled={loading === selectedPlugin} className="w-full">
                    {loading === selectedPlugin ? "Saving..." : "保存配置"}
                  </Button>
                </div>
              </Card>
            </>
          ) : (
            <PageEmptyState
              title="选择一个插件"
              description="先从左侧列表选择插件，再查看详情、开关状态和扩展配置。"
              icon={Puzzle}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Workflow Workbench</p>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
