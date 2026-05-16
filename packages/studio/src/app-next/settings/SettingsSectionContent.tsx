import { RuntimeControlPanel } from "./panels/RuntimeControlPanel";
import { useState, useEffect } from "react";
import { useApi, fetchJson, putApi } from "../../hooks/use-api";
import { ProfilePanel } from "./panels/ProfilePanel";
import { AppearancePanel } from "./panels/AppearancePanel";
import { MonitoringPanel } from "./panels/MonitoringPanel";
import { DataPanel } from "./panels/DataPanel";
import { TerminalSettingsPanel } from "./panels/TerminalSettingsPanel";
import { NotificationSettingsPanel } from "./panels/NotificationSettingsPanel";
import { UsagePanel } from "./panels/UsagePanel";
import { RuntimeEnvironmentPanel } from "./panels/RuntimeEnvironmentPanel";
import { AgentSettingsPanel } from "./panels/AgentSettingsPanel";
import { WritingSettingsPanel } from "./panels/WritingSettingsPanel";
import { StorageDiagnosticsPanel } from "./panels/StorageDiagnosticsPanel";
import { ProxySettingsPanel } from "./panels/ProxySettingsPanel";
import { AboutPanel } from "./panels/AboutPanel";
import { InlineError } from "../components/feedback";
import { Row } from "../components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Save, AlertTriangle } from "lucide-react";
import type { ServerSettings } from "../../types/settings";
import {
  deriveModelSettingsFacts,
  settingsFactDisplayValue,
  settingsFactSourceLabel,
  settingsFactStatusLabel,
  type SettingsFact,
} from "./SettingsTruthModel";

interface SettingsSectionContentProps {
  readonly sectionId: string;
  readonly onSectionChange?: (sectionId: string) => void;
}

export function SettingsSectionContent({ sectionId, onSectionChange }: SettingsSectionContentProps) {
  switch (sectionId) {
    case "profile":
      return <ProfilePanel />;
    case "models":
      return <RuntimeControlPanel />;
    case "agents":
      return <AgentSettingsPanel />;
    case "writing":
      return <WritingSettingsPanel />;
    case "notifications":
      return <NotificationSettingsPanel />;
    case "appearance":
      return <AppearancePanel />;
    case "proxy":
      return <ProxySettingsPanel />;
    case "terminals":
      return <TerminalSettingsPanel />;
    case "server":
      return <ServerSection />;
    case "storage":
      return <StorageDiagnosticsPanel />;
    case "data":
      return <DataPanel />;
    case "usage":
      return <UsagePanel />;
    case "runtime":
      return <RuntimeEnvironmentPanel />;
    case "resources":
      return <MonitoringPanel />;
    case "history":
    case "config":
      return <ModelsSection onSectionChange={onSectionChange} />;
    case "about":
      return <AboutPanel />;
    default:
      return <ModelsSection onSectionChange={onSectionChange} />;
  }
}

/* ── Models: read-only display + link to providers ── */

interface UserConfig {
  modelDefaults?: {
    defaultSessionModel?: string;
    summaryModel?: string;
    exploreSubagentModel?: string;
    planSubagentModel?: string;
    subagentModelPool?: string[];
    codexReasoningEffort?: string;
  };
  runtimeControls?: {
    defaultReasoningEffort?: string;
  };
}

function ModelsSection({ onSectionChange }: { onSectionChange?: (id: string) => void }) {
  const { data, loading, error } = useApi<UserConfig>("/settings/user");
  const facts = deriveModelSettingsFacts(data);
  const modelFacts = facts.filter((fact) => fact.id === "model.defaultSessionModel" || fact.id === "model.summaryModel");
  const subagentFacts = facts.filter((fact) => fact.id.startsWith("model.") && fact.id !== "model.defaultSessionModel" && fact.id !== "model.summaryModel" && fact.id !== "model.codexReasoningEffort");
  const reasoningFacts = facts.filter((fact) => fact.id.startsWith("runtime.") || fact.id === "model.codexReasoningEffort");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2 text-foreground">模型</h2>
        <p className="text-sm text-muted-foreground">默认模型、摘要模型、子代理偏好和推理强度。模型启用与测试在 AI 供应商中管理。</p>
      </div>
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {error && <InlineError message={error} />}
      <div className="space-y-3 rounded-lg border border-border p-4">
        {modelFacts.map((fact) => <FactRow key={fact.id} fact={fact} />)}
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-semibold mb-2 text-foreground">子代理模型池</h3>
          {subagentFacts.map((fact) => <FactRow key={fact.id} fact={fact} />)}
        </div>
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-semibold mb-2 text-foreground">推理强度</h3>
          {reasoningFacts.map((fact) => <FactRow key={fact.id} fact={fact} />)}
        </div>
        <div className="pt-3">
          <Button onClick={() => onSectionChange?.("providers")} type="button">
            打开 AI 供应商
          </Button>
        </div>
      </div>
    </div>
  );
}

function FactRow({ fact }: { readonly fact: SettingsFact<unknown> }) {
  return (
    <div className="space-y-1 py-1.5 text-sm" data-setting-fact-id={fact.id}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{fact.label}</span>
        <span className="font-mono text-foreground">{settingsFactDisplayValue(fact)}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>来源：{settingsFactSourceLabel(fact.source)}</span>
        <span>状态：{settingsFactStatusLabel(fact.status)}</span>
        {fact.readApi && <span>读取：{fact.readApi}</span>}
        {fact.writeApi && <span>写入：{fact.writeApi}</span>}
        {fact.reason && <span>原因：{fact.reason}</span>}
      </div>
    </div>
  );
}

/* ── Server ── */

function ServerSection() {
  const { data: metricsData, loading: metricsLoading, error: metricsError } = useApi<Record<string, unknown>>("/settings/metrics");
  const [server, setServer] = useState<ServerSettings>({
    port: 4567,
    host: "127.0.0.1",
    defaultProjectDir: "",
    browserOpenMode: "app",
    tlsEnabled: false,
    tlsCertPath: "",
    tlsKeyPath: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ server?: ServerSettings }>("/settings/user")
      .then((data) => {
        if (data.server) setServer(data.server);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await putApi("/settings/user", { server });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1 text-foreground">服务器与系统</h2>
        <p className="text-sm text-muted-foreground">运行时信息、系统依赖与服务器配置。</p>
      </div>

      {/* 服务器配置表单 */}
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {error && <InlineError message={error} />}

      {!loading && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">服务器配置</h3>

          <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>修改端口、监听地址或 TLS 设置后需要重启生效</span>
          </div>

          {/* 端口 */}
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">服务器端口</label>
            <Input
              type="number"
              min={1}
              max={65535}
              value={server.port}
              onChange={(e) => setServer((s) => ({ ...s, port: parseInt(e.target.value, 10) || 4567 }))}
              className="w-32 text-sm font-mono"
            />
          </div>

          {/* 监听地址 */}
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">监听地址</label>
            <SimpleSelect
              value={server.host}
              onValueChange={(v) => setServer((s) => ({ ...s, host: v }))}
              options={[
                { value: "127.0.0.1", label: "127.0.0.1（仅本机）" },
                { value: "0.0.0.0", label: "0.0.0.0（允许局域网）" },
              ]}
              className="w-56"
            />
          </div>

          {/* 默认项目目录 */}
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">默认项目目录</label>
            <Input
              placeholder="留空则使用 exe 所在目录"
              value={server.defaultProjectDir}
              onChange={(e) => setServer((s) => ({ ...s, defaultProjectDir: e.target.value }))}
              className="text-sm font-mono"
            />
          </div>

          {/* 浏览器打开方式 */}
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">启动时打开浏览器</label>
            <SimpleSelect
              value={server.browserOpenMode}
              onValueChange={(v) => setServer((s) => ({ ...s, browserOpenMode: v as ServerSettings["browserOpenMode"] }))}
              options={[
                { value: "app", label: "应用窗口（推荐）" },
                { value: "browser", label: "浏览器标签页" },
                { value: "none", label: "不打开" },
              ]}
              className="w-56"
            />
          </div>

          {/* TLS */}
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">启用 TLS/HTTPS</span>
                <p className="text-xs text-muted-foreground">启用后通过 HTTPS 访问工作台</p>
              </div>
              <Switch
                checked={server.tlsEnabled}
                onCheckedChange={(checked) => setServer((s) => ({ ...s, tlsEnabled: checked }))}
              />
            </div>
            {server.tlsEnabled && (
              <div className="space-y-2 pl-1">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">证书路径</label>
                  <Input
                    placeholder="/path/to/cert.pem"
                    value={server.tlsCertPath}
                    onChange={(e) => setServer((s) => ({ ...s, tlsCertPath: e.target.value }))}
                    className="text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">密钥路径</label>
                  <Input
                    placeholder="/path/to/key.pem"
                    value={server.tlsKeyPath}
                    onChange={(e) => setServer((s) => ({ ...s, tlsKeyPath: e.target.value }))}
                    className="text-xs font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 保存按钮 */}
          <div className="pt-2">
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              <Save className="size-3.5" />
              {saving ? "保存中..." : saved ? "已保存" : "保存配置"}
            </Button>
          </div>
        </div>
      )}

      {/* 运行时信息（只读） */}
      {metricsLoading && <p className="text-muted-foreground">加载中...</p>}
      {metricsError && <InlineError message={metricsError} />}

      {metricsData && (
        <>
          {/* 服务器信息 */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">运行时信息</h3>
            {typeof metricsData.bunVersion === "string" && <Row label="Bun 版本" value={metricsData.bunVersion} />}
            {typeof metricsData.port === "number" && <Row label="当前端口" value={String(metricsData.port)} />}
            {typeof metricsData.host === "string" && <Row label="当前监听地址" value={metricsData.host} />}
            {typeof metricsData.dbPath === "string" && <Row label="数据库路径" value={metricsData.dbPath} />}
            {typeof metricsData.platform === "string" && <Row label="平台" value={metricsData.platform} />}
            {typeof metricsData.uptime === "number" && <Row label="运行时间" value={formatUptime(metricsData.uptime as number)} />}
          </div>

          {/* 系统依赖 */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">系统依赖</h3>
            <SystemDependencyRow name="git" description="版本控制（核心功能）" required version={typeof metricsData.gitVersion === "string" ? metricsData.gitVersion : undefined} />
            <SystemDependencyRow name="rg" description="AI 工具快速代码搜索" version={typeof metricsData.rgVersion === "string" ? metricsData.rgVersion : undefined} />
            <SystemDependencyRow name="node" description="Node.js 运行时" version={typeof metricsData.nodeVersion === "string" ? metricsData.nodeVersion : undefined} />
          </div>
        </>
      )}
    </div>
  );
}

function SystemDependencyRow({ name, description, required, version }: {
  name: string;
  description: string;
  required?: boolean;
  version?: string;
}) {
  const installed = Boolean(version);
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] ${installed ? "bg-emerald-500/20 text-emerald-600" : "bg-destructive/20 text-destructive"}`}>
          {installed ? "✓" : "×"}
        </span>
        <div>
          <span className="text-sm font-mono">{name}</span>
          {version && <span className="text-xs text-muted-foreground ml-2">{version}</span>}
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <span className={`text-[10px] rounded px-1.5 py-0.5 ${required ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
        {required ? "必需" : "可选"}
      </span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}小时${mins}分钟`;
}



