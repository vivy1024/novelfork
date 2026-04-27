import { RuntimeControlPanel } from "./panels/RuntimeControlPanel";
import { useApi } from "../../hooks/use-api";
import { ProfilePanel } from "./panels/ProfilePanel";
import { AppearancePanel } from "./panels/AppearancePanel";
import { MonitoringPanel } from "./panels/MonitoringPanel";
import { DataPanel } from "./panels/DataPanel";
import { InlineError } from "../components/feedback";
import { ProjectConfigSection } from "./ProjectConfigSection";

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
    subagentModelPool?: string[];
  };
  runtimeControls?: {
    defaultReasoningEffort?: string;
  };
}

function ModelsSection({ onSectionChange }: { onSectionChange?: (id: string) => void }) {
  const { data, loading, error } = useApi<UserConfig>("/settings/user");
  const md = data?.modelDefaults;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">模型</h2>
        <p className="text-sm text-muted-foreground">默认模型、摘要模型、子代理偏好和推理强度。模型启用与测试在 AI 供应商中管理。</p>
      </div>
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {error && <InlineError message={error} />}
      <div className="space-y-3 rounded-lg border border-border p-4">
        <Row label="默认模型" value={md?.defaultSessionModel} />
        <Row label="摘要模型" value={md?.summaryModel} />
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-semibold mb-2 text-foreground">子代理模型池</h3>
          <Row label="Explore 子代理模型" value={md?.subagentModelPool?.[0]} />
          <Row label="Plan 子代理模型" value={md?.subagentModelPool?.[1]} />
          <Row label="模型池限制" value={md?.subagentModelPool ? `${md.subagentModelPool.length} 个` : undefined} />
        </div>
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-semibold mb-2 text-foreground">推理强度</h3>
          <Row label="全局推理强度" value={data?.runtimeControls?.defaultReasoningEffort} />
          <Row label="Codex 推理强度" value={undefined} />
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

function Row({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value ?? "—"}</span>
    </div>
  );
}

/* ── Notifications: not connected ── */

function NotificationsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">通知</h2>
        <p className="text-sm text-muted-foreground">通知配置尚未接入后端。</p>
      </div>
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        未接入 · 等待通知权限与偏好 API
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
          <Row label="启动诊断" value="已加载" />
          <Row label="Bun 版本" value={typeof data.bunVersion === "string" ? String(data.bunVersion) : "—"} />
          <Row label="数据库路径" value={typeof data.dbPath === "string" ? String(data.dbPath) : "—"} />
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
          <Row label="Admin Requests" value="已加载" />
          <Row label="AI request observability" value="—" />
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
