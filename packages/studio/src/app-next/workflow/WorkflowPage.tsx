import { useState } from "react";

import { useApi } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";
import { SectionLayout } from "../components/layouts";
import { cn } from "@/lib/utils";
import { workflowStatusLabel } from "../lib/display-labels";

const TABS = [
  { id: "agents", label: "Agent 配置" },
  { id: "runs", label: "管线运行" },
  { id: "scheduler", label: "调度状态" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface AgentConfigResponse {
  readonly config?: {
    readonly maxActiveWorkspaces: number;
    readonly maxActiveContainers: number;
    readonly workspaceSizeWarning: number;
    readonly autoSaveOnSleep: boolean;
    readonly portRangeStart: number;
    readonly portRangeEnd: number;
  };
}

interface RunInfo {
  readonly id: string;
  readonly status: string;
  readonly stage?: string;
  readonly action?: string;
  readonly createdAt?: string;
  readonly startedAt?: string | null;
  readonly bookId?: string;
}

interface DaemonInfo {
  readonly running: boolean;
}

function NotConnected() {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      暂无数据
    </div>
  );
}

function AgentsTab() {
  const { data, loading, error, refetch } = useApi<AgentConfigResponse>("/agent/config");
  const config = data?.config;

  if (loading) return <p className="text-muted-foreground text-sm">加载中...</p>;
  if (error) return <InlineError message={error} />;
  if (!config) return <NotConnected />;

  const rows = [
    ["最大活动工作区", String(config.maxActiveWorkspaces)],
    ["最大活动容器", String(config.maxActiveContainers)],
    ["工作区大小警戒", `${config.workspaceSizeWarning} MB`],
    ["休眠自动保存", config.autoSaveOnSleep ? "已启用" : "未启用"],
    ["端口范围", `${config.portRangeStart}–${config.portRangeEnd}`],
  ] as const;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted" onClick={refetch}>刷新</button>
      </div>
      <div className="rounded-lg border border-border p-4 space-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-1.5">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunsTab() {
  const { data, loading, error, refetch } = useApi<RunInfo[] | null>("/runs");

  if (loading) return <p className="text-muted-foreground text-sm">加载中...</p>;
  if (error) return <InlineError message={error} />;
  if (!data || !Array.isArray(data) || data.length === 0) {
    return <NotConnected />;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted" onClick={refetch}>刷新</button>
      </div>
      {data.map((run) => (
        <div key={run.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-foreground">{run.id.slice(0, 8)}</span>
            {run.bookId && <span className="text-xs text-muted-foreground">书籍: {run.bookId}</span>}
            {run.action && <span className="text-xs text-muted-foreground">动作: {run.action}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{run.startedAt ?? run.createdAt ?? "—"}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", run.status === "running" ? "bg-green-500/10 text-green-600" : run.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{workflowStatusLabel(run.status)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SchedulerTab() {
  const { data, loading, error, refetch } = useApi<DaemonInfo | null>("/daemon");

  if (loading) return <p className="text-muted-foreground text-sm">加载中...</p>;
  if (error) return <InlineError message={error} />;
  if (!data) return <NotConnected />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted" onClick={refetch}>刷新</button>
      </div>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">守护进程</span>
          <span className={cn("rounded px-2 py-0.5 text-xs font-medium", data.running ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground")}>
            {data.running ? "运行中" : "未运行"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function WorkflowPage() {
  const [activeTab, setActiveTab] = useState<TabId>("agents");

  return (
    <SectionLayout title="工作流" description="Agent 配置、管线运行与调度状态。">
      <nav aria-label="工作流 Tab" className="flex gap-1 rounded-lg border border-border bg-card p-0.5 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={activeTab === tab.id ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="mt-3">
        {activeTab === "agents" && <AgentsTab />}
        {activeTab === "runs" && <RunsTab />}
        {activeTab === "scheduler" && <SchedulerTab />}
      </div>
    </SectionLayout>
  );
}
