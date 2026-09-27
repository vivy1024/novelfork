/**
 * 工作流画布的自定义节点与连线。流程自上而下：入口在节点顶部，「下一步」出口在底部。
 *
 * 节点：起点 / 终点 / 汇合 / 工序。工序卡片显示类别、是否需要确认、分支结果与结构问题；
 * 运行叠加时再显示本次运行里这道工序的状态、给出的结果与尝试次数。
 * 节点宽度固定（与排版用的标称宽度一致），自动排版才能把节点中心对齐。
 * 连线：下一步（实线，分支线带结果标签）与打回（虚线，沿工序右侧绕回上游工序）。
 */

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { AlertTriangle, CheckCircle2, Circle, Clock, Flag, GitMerge, Loader2, Pause, Play, ShieldCheck, XCircle } from "lucide-react";

import {
  HANDLE_IN,
  HANDLE_NEXT,
  HANDLE_REJECT,
  HANDLE_REJECT_IN,
  STEP_KIND_LABEL,
  type CanvasRunStatus,
  type WorkflowCanvasEdge,
  type WorkflowCanvasNode,
} from "./workflow-canvas-model";

export const RUN_STATUS_LABEL: Record<CanvasRunStatus, string> = {
  pending: "未开始",
  running: "执行中",
  awaiting_approval: "等你确认",
  done: "已完成",
  skipped: "已跳过",
  bypassed: "未走到",
  failed: "受阻",
};

function RunStatusIcon({ status }: { status: CanvasRunStatus }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="size-3.5 text-emerald-500" />;
    case "running":
      return <Loader2 className="size-3.5 animate-spin text-primary" />;
    case "awaiting_approval":
      return <Pause className="size-3.5 text-amber-500" />;
    case "failed":
      return <XCircle className="size-3.5 text-destructive" />;
    case "skipped":
    case "bypassed":
      return <Circle className="size-3.5 text-muted-foreground/50" />;
    default:
      return <Clock className="size-3.5 text-muted-foreground/50" />;
  }
}

const RUN_BORDER: Partial<Record<CanvasRunStatus, string>> = {
  running: "border-primary ring-2 ring-primary/30",
  awaiting_approval: "border-amber-400 ring-2 ring-amber-300/40",
  failed: "border-destructive ring-2 ring-destructive/30",
  done: "border-emerald-400/70",
};

function frameClass(props: NodeProps<WorkflowCanvasNode>): string {
  const { issues, run } = props.data;
  if (run && RUN_BORDER[run.status]) return RUN_BORDER[run.status]!;
  if (issues.length > 0) return "border-destructive/70";
  return props.selected ? "border-primary" : "border-border";
}

const handleClass = "!size-2.5 !border-2 !border-background !bg-muted-foreground";

function IssueMark({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-0.5 text-2xs text-destructive" title={`${count} 处结构问题`}>
      <AlertTriangle className="size-3" />
      {count}
    </span>
  );
}

function StartNodeView(props: NodeProps<WorkflowCanvasNode>) {
  return (
    <div
      className={`flex w-28 items-center justify-center gap-1.5 rounded-full border-2 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 shadow-sm dark:bg-emerald-950/30 dark:text-emerald-300 ${frameClass(props)}`}
      data-testid={`workflow-node-${props.id}`}
    >
      <Play className="size-3.5 shrink-0 fill-current" />
      <span className="truncate">{props.data.node.label}</span>
      <IssueMark count={props.data.issues.length} />
      <Handle id={HANDLE_NEXT} type="source" position={Position.Bottom} className={handleClass} />
    </div>
  );
}

function EndNodeView(props: NodeProps<WorkflowCanvasNode>) {
  return (
    <div
      className={`flex w-28 items-center justify-center gap-1.5 rounded-full border-2 bg-muted px-3 py-2 text-xs font-medium shadow-sm ${frameClass(props)}`}
      data-testid={`workflow-node-${props.id}`}
    >
      <Handle id={HANDLE_IN} type="target" position={Position.Top} className={handleClass} />
      <Flag className="size-3.5 shrink-0" />
      <span className="truncate">{props.data.node.label}</span>
      <IssueMark count={props.data.issues.length} />
    </div>
  );
}

function JoinNodeView(props: NodeProps<WorkflowCanvasNode>) {
  return (
    <div
      className={`flex w-28 items-center justify-center gap-1.5 rounded-lg border-2 border-dashed bg-card px-3 py-1.5 text-xs shadow-sm ${frameClass(props)}`}
      data-testid={`workflow-node-${props.id}`}
      title="汇合：所有入线都走完（或作废）后才继续"
    >
      <Handle id={HANDLE_IN} type="target" position={Position.Top} className={handleClass} />
      <GitMerge className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{props.data.node.label}</span>
      <IssueMark count={props.data.issues.length} />
      <Handle id={HANDLE_NEXT} type="source" position={Position.Bottom} className={handleClass} />
    </div>
  );
}

function StepNodeView(props: NodeProps<WorkflowCanvasNode>) {
  const { node, issues, run, canReject } = props.data;
  if (node.type !== "step") return null;
  const needsDecision = node.kind === "approval-gate" || node.requiresApproval === true;
  const dimmed = !node.enabled || run?.status === "bypassed" || run?.status === "skipped";
  return (
    <div
      className={`w-52 rounded-lg border-2 bg-card text-xs shadow-sm ${frameClass(props)} ${dimmed ? "opacity-55" : ""}`}
      data-testid={`workflow-node-${props.id}`}
    >
      <Handle id={HANDLE_IN} type="target" position={Position.Top} className={handleClass} />
      {/* 打回线的落点：任何工序都可能被下游打回到这里。 */}
      <Handle id={HANDLE_REJECT_IN} type="target" position={Position.Right} style={{ top: "30%" }} className="!size-1.5 !border-0 !opacity-0" />
      <div className="flex items-start justify-between gap-1 px-2.5 pt-2">
        <span className={`font-medium leading-snug ${node.enabled ? "" : "line-through"}`}>{node.label}</span>
        <span className="flex shrink-0 items-center gap-1">
          {needsDecision ? <ShieldCheck className="size-3.5 text-amber-500" aria-label="需要作者确认" /> : null}
          <IssueMark count={issues.length} />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2 pt-1 text-2xs text-muted-foreground">
        <span>{STEP_KIND_LABEL[node.kind] ?? node.kind}</span>
        {node.executionMode === "subagent" && node.agentId ? <span>· 子代理 {node.agentId}</span> : null}
        {!node.enabled ? <span>· 已停用</span> : null}
        {node.outcomes?.length ? (
          <span className="flex flex-wrap gap-0.5">
            {node.outcomes.map((outcome) => (
              <span key={outcome} className="rounded bg-muted px-1">{outcome}</span>
            ))}
          </span>
        ) : null}
      </div>
      {run ? (
        <div className="flex items-center gap-1 border-t px-2.5 py-1 text-2xs" data-testid={`workflow-node-run-${props.id}`}>
          <RunStatusIcon status={run.status} />
          <span>{RUN_STATUS_LABEL[run.status]}</span>
          {run.outcome ? <span className="rounded bg-primary/10 px-1 text-primary">结果：{run.outcome}</span> : null}
          {run.attempt > 1 ? <span className="ml-auto text-muted-foreground">第 {run.attempt} 次</span> : null}
        </div>
      ) : null}
      <Handle id={HANDLE_NEXT} type="source" position={Position.Bottom} className={handleClass} />
      {canReject ? (
        <Handle
          id={HANDLE_REJECT}
          type="source"
          position={Position.Right}
          style={{ top: "70%" }}
          className="!size-2.5 !border-2 !border-background !bg-amber-500"
          title="从这里拖到要重做的上游工序：作者打回时回到那里"
        />
      ) : null}
    </div>
  );
}

export const workflowNodeTypes = {
  start: memo(StartNodeView),
  end: memo(EndNodeView),
  join: memo(JoinNodeView),
  step: memo(StepNodeView),
};

function WorkflowEdgeView(props: EdgeProps<WorkflowCanvasEdge>) {
  const edge = props.data?.edge;
  const isReject = edge?.kind === "reject";
  const [path, labelX, labelY] = isReject
    ? getBezierPath({ ...props, curvature: 0.8 })
    : getSmoothStepPath({ ...props, borderRadius: 10 });
  const hasIssue = (props.data?.issues.length ?? 0) > 0;
  const runState = props.data?.runState;
  const stroke = hasIssue
    ? "var(--destructive, #dc2626)"
    : isReject
      ? "#f59e0b"
      : runState === "taken"
        ? "#10b981"
        : "var(--muted-foreground, #94a3b8)";
  const label = isReject ? "打回" : edge?.outcome;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{
          stroke,
          strokeWidth: props.selected ? 2.5 : 1.5,
          strokeDasharray: isReject ? "6 4" : undefined,
          opacity: runState === "dead" ? 0.3 : 1,
        }}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-auto absolute rounded border px-1.5 py-0.5 text-2xs ${isReject ? "border-amber-400/70 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-card text-foreground"}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const workflowEdgeTypes = { workflow: memo(WorkflowEdgeView) };
