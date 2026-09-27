/**
 * 画布右侧的属性面板：选中工序 / 汇合 / 终点 / 连线时编辑它，什么都没选时编辑方案本身。
 * 每次修改都换算成一条编辑指令交给父组件，与叙述者走同一套校验。
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

import {
  START_NODE_ID,
  requiresAuthorDecision,
  type WorkflowGraphIssue,
  type WorkflowGraphOp,
  type WorkflowGraphRecipe,
  type WorkflowStepNode,
} from "../../../engine/workflows/workflow-graph.js";
import { parseList, STEP_KIND_LABEL, STEP_KINDS, updateEdgeOps, type CanvasSelection } from "./workflow-canvas-model";

export interface WorkflowInspectorProps {
  readonly recipe: WorkflowGraphRecipe;
  readonly issues: readonly WorkflowGraphIssue[];
  readonly selection: CanvasSelection;
  readonly editable: boolean;
  readonly onOps: (ops: WorkflowGraphOp[]) => void;
  readonly onSelect: (selection: CanvasSelection) => void;
}

const fieldClass = "w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-60";
const labelClass = "flex flex-col gap-1 text-2xs text-muted-foreground";

/** 文本输入：失焦或回车时才提交，避免每敲一个字就生成一条指令。 */
function CommitInput({
  value,
  onCommit,
  disabled,
  multiline,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !multiline) (event.target as HTMLElement).blur();
    if (event.key === "Escape") setDraft(value);
  };
  return multiline ? (
    <textarea
      aria-label={ariaLabel}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={`${fieldClass} min-h-16`}
    />
  ) : (
    <input
      aria-label={ariaLabel}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={fieldClass}
    />
  );
}

function IssueList({ issues, onSelect }: { issues: readonly WorkflowGraphIssue[]; onSelect?: (selection: CanvasSelection) => void }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1.5" data-testid="workflow-inspector-issues">
      {issues.map((issue, index) => {
        const target: CanvasSelection = issue.nodeId ? { kind: "node", id: issue.nodeId } : issue.edgeId ? { kind: "edge", id: issue.edgeId } : null;
        return (
          <li key={`${issue.code}-${index}`}>
            <button
              type="button"
              disabled={!target || !onSelect}
              onClick={() => onSelect?.(target)}
              className="w-full space-y-0.5 rounded border border-destructive/40 bg-destructive/5 p-1.5 text-left text-2xs text-destructive enabled:hover:bg-destructive/10"
            >
              <div className="flex items-start gap-1 font-medium">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {issue.explanation.what}
              </div>
              <div>原因：{issue.explanation.why}</div>
              <div>建议：{issue.explanation.action}</div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const EXECUTION_MODE_LABEL = {
  "": "叙述者本人",
  subagent: "委派子代理",
  autonomous: "自主执行",
  "tool-only": "只调用工具",
} as const;

const FAILURE_LABEL = { stop: "停下等作者处理", retry: "自动重试", skip: "跳过继续" } as const;

const RESULT_STRATEGY_LABEL = {
  "formal-chapter": "写入正式章节",
  "version-result": "存为版本候选",
  "direct-write": "直接写入",
} as const;

function StepFields({ step, editable, onOps }: { step: WorkflowStepNode; editable: boolean; onOps: (ops: WorkflowGraphOp[]) => void }) {
  const update = (patch: Record<string, unknown>) => onOps([{ op: "update_node", id: step.id, patch }]);
  const listPatch = (key: "tools" | "skills" | "outcomes", text: string) => {
    const items = parseList(text);
    update({ [key]: items.length > 0 ? items : null });
  };
  return (
    <>
      <label className={labelClass}>
        工序类别
        <select aria-label="工序类别" value={step.kind} disabled={!editable} onChange={(event) => update({ kind: event.target.value })} className={fieldClass}>
          {STEP_KINDS.map((kind) => (
            <option key={kind} value={kind}>{STEP_KIND_LABEL[kind]}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" aria-label="启用" checked={step.enabled} disabled={!editable} onChange={(event) => update({ enabled: event.target.checked })} />
          启用
        </label>
        <label className="flex items-center gap-1" title="需要确认的工序提交后会停下来等作者批准或打回">
          <input
            type="checkbox"
            aria-label="需要作者确认"
            checked={step.kind === "approval-gate" || step.requiresApproval === true}
            disabled={!editable || step.kind === "approval-gate"}
            onChange={(event) => update({ requiresApproval: event.target.checked ? true : null })}
          />
          需要作者确认
        </label>
      </div>
      <label className={labelClass}>
        由谁执行
        <select
          aria-label="由谁执行"
          value={step.executionMode ?? ""}
          disabled={!editable}
          onChange={(event) => update({ executionMode: event.target.value || null })}
          className={fieldClass}
        >
          {Object.entries(EXECUTION_MODE_LABEL).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </label>
      {step.executionMode === "subagent" ? (
        <label className={labelClass}>
          子代理
          <CommitInput ariaLabel="子代理" value={step.agentId ?? ""} disabled={!editable} placeholder="子代理 id" onCommit={(text) => update({ agentId: text.trim() || null })} />
        </label>
      ) : null}
      <label className={labelClass}>
        按结果分支（逗号分隔；留空表示不分支）
        <CommitInput
          ariaLabel="分支结果"
          value={(step.outcomes ?? []).join("，")}
          disabled={!editable}
          placeholder="例如：通过，不通过"
          onCommit={(text) => listPatch("outcomes", text)}
        />
      </label>
      <label className={labelClass}>
        可用的写入工具（逗号分隔；读类工具恒可用）
        <CommitInput ariaLabel="可用的写入工具" value={(step.tools ?? []).join("，")} disabled={!editable} onCommit={(text) => listPatch("tools", text)} />
      </label>
      <label className={labelClass}>
        技能（逗号分隔）
        <CommitInput ariaLabel="技能" value={(step.skills ?? []).join("，")} disabled={!editable} onCommit={(text) => listPatch("skills", text)} />
      </label>
      <label className={labelClass}>
        失败时
        <select aria-label="失败时" value={step.onFailure ?? "stop"} disabled={!editable} onChange={(event) => update({ onFailure: event.target.value })} className={fieldClass}>
          {Object.entries(FAILURE_LABEL).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        附加要求（进入这道工序的简报）
        <CommitInput ariaLabel="附加要求" multiline value={step.customPrompt ?? ""} disabled={!editable} onCommit={(text) => update({ customPrompt: text.trim() ? text : null })} />
      </label>
    </>
  );
}

export function WorkflowInspector({ recipe, issues, selection, editable, onOps, onSelect }: WorkflowInspectorProps) {
  const node = selection?.kind === "node" ? recipe.nodes.find((candidate) => candidate.id === selection.id) : undefined;
  const edge = selection?.kind === "edge" ? recipe.edges.find((candidate) => candidate.id === selection.id) : undefined;
  const labelOf = (id: string) => recipe.nodes.find((candidate) => candidate.id === id)?.label ?? id;

  if (node) {
    const nodeIssues = issues.filter((issue) => issue.nodeId === node.id);
    const typeLabel = node.type === "step" ? "工序" : node.type === "join" ? "汇合" : node.type === "end" ? "终点" : "起点";
    return (
      <div className="space-y-3" data-testid="workflow-inspector">
        <div className="flex items-center justify-between text-xs font-semibold">
          {typeLabel}
          {editable && node.id !== START_NODE_ID ? (
            <button
              type="button"
              onClick={() => {
                onOps([{ op: "remove_node", id: node.id }]);
                onSelect(null);
              }}
              className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-normal text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3" />
              删除
            </button>
          ) : null}
        </div>
        <label className={labelClass}>
          名称
          <CommitInput ariaLabel="节点名称" value={node.label} disabled={!editable} onCommit={(text) => onOps([{ op: "update_node", id: node.id, patch: { label: text } }])} />
        </label>
        {node.type === "step" ? <StepFields step={node} editable={editable} onOps={onOps} /> : null}
        {node.type === "join" ? <p className="text-2xs text-muted-foreground">汇合节点等所有入线都走完（或因分支未选中而作废）后才继续。</p> : null}
        {node.type === "step" && requiresAuthorDecision(node) ? (
          <p className="text-2xs text-muted-foreground">从卡片右侧的橙色连接点拖一条线到上游工序，作者打回时就回到那里重做；不连则打回本工序重做。</p>
        ) : null}
        <IssueList issues={nodeIssues} />
      </div>
    );
  }

  if (edge) {
    const source = recipe.nodes.find((candidate) => candidate.id === edge.source);
    const outcomes = source?.type === "step" ? source.outcomes ?? [] : [];
    const edgeIssues = issues.filter((issue) => issue.edgeId === edge.id);
    return (
      <div className="space-y-3" data-testid="workflow-inspector">
        <div className="flex items-center justify-between text-xs font-semibold">
          连线
          {editable ? (
            <button
              type="button"
              onClick={() => {
                onOps([{ op: "disconnect", id: edge.id }]);
                onSelect(null);
              }}
              className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-normal text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3" />
              删除
            </button>
          ) : null}
        </div>
        <div className="text-xs">{labelOf(edge.source)} → {labelOf(edge.target)}</div>
        <label className={labelClass}>
          类型
          <select
            aria-label="连线类型"
            value={edge.kind}
            disabled={!editable}
            onChange={(event) => onOps(updateEdgeOps(edge, { kind: event.target.value as "next" | "reject" }))}
            className={fieldClass}
          >
            <option value="next">下一步</option>
            <option value="reject">打回（作者打回时回到目标工序）</option>
          </select>
        </label>
        {edge.kind === "next" && (outcomes.length > 0 || edge.outcome !== undefined) ? (
          <label className={labelClass}>
            走这条线的条件
            <select
              aria-label="分支条件"
              value={edge.outcome ?? ""}
              disabled={!editable}
              onChange={(event) => onOps(updateEdgeOps(edge, { outcome: event.target.value || null }))}
              className={fieldClass}
            >
              <option value="">默认（其余结果都走这条）</option>
              {[...new Set([...outcomes, ...(edge.outcome !== undefined ? [edge.outcome] : [])])].map((outcome) => (
                <option key={outcome} value={outcome}>提交结果为「{outcome}」</option>
              ))}
            </select>
          </label>
        ) : null}
        <IssueList issues={edgeIssues} />
      </div>
    );
  }

  const setMeta = (patch: Record<string, unknown>) => onOps([{ op: "set_meta", patch }]);
  return (
    <div className="space-y-3" data-testid="workflow-inspector">
      <div className="text-xs font-semibold">方案</div>
      <label className={labelClass}>
        名称
        <CommitInput ariaLabel="方案名称" value={recipe.name} disabled={!editable} onCommit={(text) => setMeta({ name: text })} />
      </label>
      <label className={labelClass}>
        说明
        <CommitInput ariaLabel="方案说明" multiline value={recipe.description} disabled={!editable} onCommit={(text) => setMeta({ description: text })} />
      </label>
      <label className={labelClass}>
        正文落到哪里
        <select
          aria-label="结果策略"
          value={recipe.resultStrategy}
          disabled={!editable}
          onChange={(event) => setMeta({ resultStrategy: event.target.value })}
          className={fieldClass}
        >
          {Object.entries(RESULT_STRATEGY_LABEL).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        每道工序最多自动重试
        <input
          aria-label="最多重试次数"
          type="number"
          min={0}
          max={10}
          value={recipe.maxRetries}
          disabled={!editable}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isInteger(next)) setMeta({ maxRetries: next });
          }}
          className={fieldClass}
        />
      </label>
      {issues.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-2xs font-medium text-destructive">结构问题（{issues.length}）——修好后才能发布</div>
          <IssueList issues={issues} onSelect={onSelect} />
        </div>
      ) : (
        <p className="text-2xs text-muted-foreground">结构完整。点选节点或连线可以编辑它；从节点底部的连接点拖线可以连接下一步。</p>
      )}
    </div>
  );
}
