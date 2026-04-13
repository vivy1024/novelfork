import { useState, useEffect } from "react";
import { useApi, postApi } from "../hooks/use-api";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { Puzzle, Settings, CheckCircle, XCircle, AlertCircle, Loader } from "lucide-react";
import type { TFunction } from "../hooks/use-i18n";

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
  nav: any;
  theme: any;
  t: TFunction;
}

export function PluginManager({ nav, theme, t }: PluginManagerProps) {
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
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "error":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "discovered":
      case "loaded":
      case "initialized":
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <Loader className="w-4 h-4 text-gray-500" />;
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
      <div className="flex items-center gap-3">
        <Puzzle className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            {t("plugins.title") || "Plugin Manager"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("plugins.subtitle") || "Manage InkOS plugins and extensions"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Plugin List */}
        <div className="lg:col-span-2 space-y-4">
          {plugins.length === 0 ? (
            <Card className="p-8 text-center">
              <Puzzle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {t("plugins.empty") || "No plugins found"}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {t("plugins.emptyHint") || "Place plugins in the plugins/ directory"}
              </p>
            </Card>
          ) : (
            plugins.map((plugin) => (
              <Card
                key={plugin.manifest.name}
                className={`p-6 cursor-pointer transition-all hover:shadow-md ${
                  selectedPlugin === plugin.manifest.name
                    ? "ring-2 ring-primary"
                    : ""
                }`}
                onClick={() => setSelectedPlugin(plugin.manifest.name)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {getStateIcon(plugin.state)}
                      <h3 className="text-lg font-semibold text-foreground">
                        {plugin.manifest.displayName}
                      </h3>
                      {getStateBadge(plugin.state)}
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {plugin.manifest.description}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>v{plugin.manifest.version}</span>
                      {plugin.manifest.author && <span>by {plugin.manifest.author}</span>}
                      <span>{plugin.toolsCount} tools</span>
                      <span>{plugin.hooksCount} hooks</span>
                    </div>
                    {plugin.error && (
                      <div className="mt-3 p-2 bg-destructive/10 rounded text-xs text-destructive">
                        {plugin.error}
                      </div>
                    )}
                  </div>
                  <div className="ml-4">
                    <Switch
                      checked={plugin.enabled}
                      onCheckedChange={(checked) =>
                        handleToggle(plugin.manifest.name, checked)
                      }
                      disabled={loading === plugin.manifest.name}
                    />
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Plugin Details */}
        <div className="space-y-4">
          {selected ? (
            <>
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Settings className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">
                    {t("plugins.details") || "Plugin Details"}
                  </h3>
                </div>
                <Separator className="mb-4" />
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <span className="ml-2 text-foreground font-mono">
                      {selected.manifest.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Version:</span>
                    <span className="ml-2 text-foreground">
                      {selected.manifest.version}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">State:</span>
                    <span className="ml-2">{getStateBadge(selected.state)}</span>
                  </div>
                  {selected.manifest.author && (
                    <div>
                      <span className="text-muted-foreground">Author:</span>
                      <span className="ml-2 text-foreground">
                        {selected.manifest.author}
                      </span>
                    </div>
                  )}
                  {selected.manifest.homepage && (
                    <div>
                      <span className="text-muted-foreground">Homepage:</span>
                      <a
                        href={selected.manifest.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-primary hover:underline"
                      >
                        {selected.manifest.homepage}
                      </a>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Path:</span>
                    <span className="ml-2 text-foreground font-mono text-xs break-all">
                      {selected.path}
                    </span>
                  </div>
                </div>

                {selected.manifest.tools && selected.manifest.tools.length > 0 && (
                  <>
                    <Separator className="my-4" />
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">
                        {t("plugins.tools") || "Tools"}
                      </h4>
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
                      <h4 className="text-sm font-semibold text-foreground mb-2">
                        {t("plugins.hooks") || "Hooks"}
                      </h4>
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
                <div className="flex items-center gap-2 mb-4">
                  <Settings className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">
                    {t("plugins.config") || "Configuration"}
                  </h3>
                </div>
                <Separator className="mb-4" />
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="backupDir">Backup Directory</Label>
                    <Input
                      id="backupDir"
                      value={(configValues.backupDir as string) || "./backups"}
                      onChange={(e) =>
                        setConfigValues({ ...configValues, backupDir: e.target.value })
                      }
                      placeholder="./backups"
                    />
                  </div>
                  <div>
                    <Label htmlFor="maxBackups">Max Backups</Label>
                    <Input
                      id="maxBackups"
                      type="number"
                      value={(configValues.maxBackups as number) || 5}
                      onChange={(e) =>
                        setConfigValues({
                          ...configValues,
                          maxBackups: parseInt(e.target.value),
                        })
                      }
                      placeholder="5"
                    />
                  </div>
                  <Button
                    onClick={handleSaveConfig}
                    disabled={loading === selectedPlugin}
                    className="w-full"
                  >
                    {loading === selectedPlugin ? "Saving..." : "Save Configuration"}
                  </Button>
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-8 text-center">
              <Puzzle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {t("plugins.selectHint") || "Select a plugin to view details"}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
