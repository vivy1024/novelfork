import { RuntimeControlPanel } from "./panels/RuntimeControlPanel";
import { useApi } from "../../hooks/use-api";
import { ProfilePanel } from "./panels/ProfilePanel";
import { AppearancePanel } from "./panels/AppearancePanel";
import { MonitoringPanel } from "./panels/MonitoringPanel";
import { DataPanel } from "./panels/DataPanel";
import { InlineError } from "../components/feedback";
import { ProjectConfigSection } from "./ProjectConfigSection";
import { Row } from "../components/shared";
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
      return <ModelsSection onSectionChange={onSectionChange} />;
    case "agents":
      return <RuntimeControlPanel />;
    case "notifications":
      return <NotificationsSection />;
    case "appearance":
      return <AppearancePanel />;
    case "server":
      return <ServerSection />;
    case "storage":
      return <DataPanel />;
    case "resources":
      return <MonitoringPanel />;
    case "history":
      return <HistorySection />;
    case "config":
      return <ProjectConfigSection />;
    case "about":
      return <AboutSection />;
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
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity" onClick={() => onSectionChange?.("providers")} type="button">
            打开 AI 供应商
          </button>
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

/* ── Notifications: not connected ── */

function NotificationsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">通知</h2>
        <p className="text-sm text-muted-foreground">此功能尚未开放。通知配置将在后续版本中提供。</p>
      </div>
    </div>
  );
}

/* ── Server ── */

function ServerSection() {
  const { data, loading, error } = useApi<Record<string, unknown>>("/settings/metrics");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">服务器与系统</h2>
        <p className="text-sm text-muted-foreground">运行时信息与启动诊断。</p>
      </div>
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {error && <InlineError message={error} />}
      {data && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          {typeof data.bunVersion === "string" && <Row label="Bun 版本" value={data.bunVersion} />}
          {typeof data.dbPath === "string" && <Row label="数据库路径" value={data.dbPath} />}
        </div>
      )}
    </div>
  );
}

/* ── History ── */

function HistorySection() {
  const { data, loading, error } = useApi<Record<string, unknown>>("/settings/metrics");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">使用历史</h2>
        <p className="text-sm text-muted-foreground">AI 请求历史与 token 用量。</p>
      </div>
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {error && <InlineError message={error} />}
      {data && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <Row label="请求历史" value="已加载" />
          <Row label="AI 请求观测" value="—" />
        </div>
      )}
    </div>
  );
}

/* ── About ── */

interface ReleaseSnapshot {
  version?: string;
  commit?: string;
  platform?: string;
  builtAt?: string;
  bunVersion?: string;
}

function AboutSection() {
  const { data, loading, error } = useApi<ReleaseSnapshot>("/settings/release");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">关于</h2>
        <p className="text-sm text-muted-foreground">版本与构建信息。</p>
      </div>
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {error && <InlineError message={error} />}
      {data && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <Row label="版本" value={data.version} />
          <Row label="Commit" value={data.commit?.slice(0, 7)} />
          <Row label="平台" value={data.platform} />
          <Row label="Bun" value={data.bunVersion} />
          <Row label="构建时间" value={data.builtAt} />
        </div>
      )}
    </div>
  );
}
