import { useState } from "react";

import { useApi } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";
import { SectionLayout } from "../components/layouts";
import { cn } from "@/lib/utils";
import { workflowStatusLabel } from "../lib/display-labels";

const TABS = [
  { id: "agents", label: "Agent 状态" },
  { id: "runs", label: "管线运行" },
  { id: "scheduler", label: "调度配置" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface AgentInfo {
  readonly name: string;
  readonly status: string;
  readonly model?: string;
}

interface RunInfo {
  readonly id: string;
  readonly status: string;
  readonly startedAt?: string;
  readonly bookId?: string;
}

interface SchedulerInfo {
  readonly enabled?: boolean;
  readonly interval?: number;
  readonly strategy?: string;
}

function NotConnected() {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      暂无数据
    </div>
  );
}

function AgentsTab() {
  const { data, loading, error, refetch } = useApi<AgentInfo[] | null>("/agents");

  if (loading) return <p className="text-muted-foreground text-sm">加载中...</p>;
  if (error) return <NotConnected />;
  if (!data || !Array.isArray(data) || data.length === 0) {
    return <NotConnected />;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted" onClick={refetch}>刷新</button>
      </div>
      {data.map((agent) => (
        <div key={agent.name} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={cn("inline-block h-2 w-2 rounded-full", agent.status === "running" ? "bg-green-500" : "bg-gray-400")} />
            <span className="font-medium text-foreground">{agent.name}</span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            {agent.model && <span className="font-mono text-xs">{agent.model}</span>}
            <span className="text-xs">{workflowStatusLabel(agent.status)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RunsTab() {
  const { data, loading, error, refetch } = useApi<RunInfo[] | null>("/runs");

  if (loading) return <p className="text-muted-foreground text-sm">加载中...</p>;
  if (error) return <NotConnected />;
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
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{run.startedAt ?? "—"}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", run.status === "running" ? "bg-green-500/10 text-green-600" : run.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{workflowStatusLabel(run.status)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SchedulerTab() {
  const { data, loading, error, refetch } = useApi<SchedulerInfo | null>("/scheduler");

  if (loading) return <p className="text-muted-foreground text-sm">加载中...</p>;
  if (error) return <NotConnected />;
  if (!data) return <NotConnected />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted" onClick={refetch}>刷新</button>
      </div>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">启用状态</span>
          <span className="font-mono text-foreground">{data.enabled ? "已启用" : "未启用"}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">调度间隔</span>
          <span className="font-mono text-foreground">{data.interval ? `${data.interval}s` : "—"}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">调度策略</span>
          <span className="font-mono text-foreground">{data.strategy ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}

export function WorkflowPage() {
  const [activeTab, setActiveTab] = useState<TabId>("agents");

  return (
    <SectionLayout title="工作流" description="Agent 状态、管线运行与调度配置。">
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
