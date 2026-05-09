import { CheckCircle, Circle, Loader2, XCircle, Clock, Pause } from "lucide-react";

export type WorkflowStepStatus = "pending" | "running" | "success" | "skipped" | "failed" | "approval-pending";

export interface WorkflowStepView {
  id: string;
  label: string;
  status: WorkflowStepStatus;
  summary?: string;
  durationMs?: number;
}

export interface WorkflowProgressCardProps {
  title: string;
  steps: readonly WorkflowStepView[];
  status: "completed" | "stopped" | "approval-pending" | "failed" | "running";
  completedCount: number;
  totalCount: number;
}

function StepIcon({ status }: { status: WorkflowStepStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle className="size-4 text-green-500" />;
    case "running":
      return <Loader2 className="size-4 text-blue-500 animate-spin" />;
    case "failed":
      return <XCircle className="size-4 text-red-500" />;
    case "skipped":
      return <Circle className="size-4 text-muted-foreground/40" />;
    case "approval-pending":
      return <Pause className="size-4 text-yellow-500" />;
    case "pending":
    default:
      return <Clock className="size-4 text-muted-foreground/40" />;
  }
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const statusLabels: Record<WorkflowProgressCardProps["status"], string> = {
  completed: "已完成",
  stopped: "已停止",
  "approval-pending": "等待确认",
  failed: "失败",
  running: "执行中",
};

const statusColors: Record<WorkflowProgressCardProps["status"], string> = {
  completed: "text-green-600",
  stopped: "text-muted-foreground",
  "approval-pending": "text-yellow-600",
  failed: "text-red-600",
  running: "text-blue-600",
};

export function WorkflowProgressCard({ title, steps, status, completedCount, totalCount }: WorkflowProgressCardProps) {
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <section data-testid="workflow-progress-card" className="rounded-lg border border-border p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className={`text-[10px] font-medium ${statusColors[status]}`}>
          {statusLabels[status]} · {completedCount}/{totalCount}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${status === "failed" ? "bg-red-500" : status === "running" ? "bg-blue-500" : "bg-green-500"}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-1.5">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-2">
            <StepIcon status={step.status} />
            <span className={`text-xs flex-1 ${step.status === "pending" || step.status === "skipped" ? "text-muted-foreground" : ""}`}>
              {step.label}
            </span>
            {step.summary && <span className="text-[10px] text-muted-foreground truncate max-w-32">{step.summary}</span>}
            {step.durationMs != null && step.status !== "pending" && (
              <span className="text-[10px] text-muted-foreground shrink-0">{formatDuration(step.durationMs)}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// WorkflowProgressRenderer — ToolResultRenderer 适配
// ---------------------------------------------------------------------------

import { asRecord, getToolResultData, type ToolResultRendererContext } from "./types";

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function WorkflowProgressRenderer({ result }: ToolResultRendererContext) {
  const data = asRecord(getToolResultData(result));
  if (!data) return null;

  const title = typeof data.title === "string" ? data.title : typeof data.recipeId === "string" ? data.recipeId : "写作管线";
  const rawSteps = Array.isArray(data.steps) ? data.steps : [];
  const steps: WorkflowStepView[] = rawSteps.map((s, i) => {
    const step = asRecord(s);
    return {
      id: typeof step?.stepId === "string" ? step.stepId : `step-${i}`,
      label: typeof step?.label === "string" ? step.label : typeof step?.kind === "string" ? step.kind : `步骤 ${i + 1}`,
      status: (typeof step?.status === "string" ? step.status : "pending") as WorkflowStepStatus,
      summary: typeof step?.summary === "string" ? step.summary : undefined,
      durationMs: typeof step?.durationMs === "number" ? step.durationMs : undefined,
    };
  });

  const status = (typeof data.status === "string" ? data.status : "running") as WorkflowProgressCardProps["status"];
  const completedCount = typeof data.completedStepCount === "number" ? data.completedStepCount : steps.filter((s) => s.status === "success").length;
  const totalCount = typeof data.totalStepCount === "number" ? data.totalStepCount : steps.length;

  return <WorkflowProgressCard title={title} steps={steps} status={status} completedCount={completedCount} totalCount={totalCount} />;
}
