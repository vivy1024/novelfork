/**
 * 画布右侧的属性面板：选中工序 / 汇合 / 终点 / 连线时编辑它，什么都没选时编辑方案本身。
 * 每次修改都换算成一条编辑指令交给父组件，与叙述者走同一套校验。
 */

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Plus, Sparkles, Trash2, X } from "lucide-react";

import type { NovelParallelSubagentConfig } from "../../../engine/workflows/novel-workflows.js";
import { getStepPromptPresetsForKind, STEP_PROMPT_PRESETS } from "../../../engine/workflows/step-prompt-presets.js";
import {
  START_NODE_ID,
  requiresAuthorDecision,
  type WorkflowGraphIssue,
  type WorkflowGraphOp,
  type WorkflowGraphRecipe,
  type WorkflowStepNode,
} from "../../../engine/workflows/workflow-graph.js";
import { NOVEL_SUBAGENT_ROSTER } from "../../../engine/agents/roster.js";
import {
  AUTHORITATIVE_WRITABLE_NOVEL_TOOLS,
  type RuntimeModelOption,
  type RuntimeSkillOption,
  type SubagentSourceKind,
  type WritableNovelToolOption,
} from "./runtime-workflow-catalog";
import { parseList, STEP_KIND_LABEL, STEP_KINDS, updateEdgeOps, type CanvasSelection } from "./workflow-canvas-model";

export interface SubagentOption {
  readonly id: string;
  readonly nameZh: string;
  readonly description?: string;
  readonly isCustom?: boolean;
  readonly source?: SubagentSourceKind;
}

export interface WorkflowInspectorProps {
  readonly recipe: WorkflowGraphRecipe;
  readonly issues: readonly WorkflowGraphIssue[];
  readonly selection: CanvasSelection;
  readonly editable: boolean;
  readonly onOps: (ops: WorkflowGraphOp[]) => void;
  readonly onSelect: (selection: CanvasSelection) => void;
  readonly customSubagents?: readonly SubagentOption[];
  readonly runtimeModels?: readonly RuntimeModelOption[];
  readonly availableSkills?: readonly RuntimeSkillOption[];
  readonly writableTools?: readonly WritableNovelToolOption[];
}

const fieldClass = "w-full rounded border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary disabled:opacity-60";
const labelClass = "flex flex-col gap-1 text-2xs text-muted-foreground";

const SOURCE_BADGE_TEXT: Record<SubagentSourceKind, string> = {
  builtin: "内置",
  "book-custom": "本书定制",
  "runtime-global": "Runtime全局",
};

/** 文本输入：失焦或回车时才提交，避免每敲一个字就生成一条指令。 */
function CommitInput({
  value,
  onCommit,
  disabled,
  multiline,
  placeholder,
  ariaLabel,
  listId,
}: {
  value: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel: string;
  listId?: string;
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
      list={listId}
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
              className="w-full space-y-0.5 rounded border border-destructive/40 bg-destructive/5 p-1.5 text-left text-xs text-destructive enabled:hover:bg-destructive/10"
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

function ParallelSubagentsEditor({
  items,
  editable,
  subagentOptions,
  runtimeModels,
  modelDatalistId,
  onChange,
}: {
  items: readonly NovelParallelSubagentConfig[];
  editable: boolean;
  subagentOptions: readonly SubagentOption[];
  runtimeModels: readonly RuntimeModelOption[];
  modelDatalistId: string;
  onChange: (next: readonly NovelParallelSubagentConfig[] | null) => void;
}) {
  const commitItems = (next: readonly NovelParallelSubagentConfig[]) => {
    onChange(next.length > 0 ? next : null);
  };

  const addParallel = () => {
    const usedNames = new Set(items.map((item) => item.name));
    let index = items.length + 1;
    while (usedNames.has(`并行帮手-${index}`)) index++;
    commitItems([...items, { name: `并行帮手-${index}` }]);
  };

  const updateAt = (index: number, patch: Partial<NovelParallelSubagentConfig>) => {
    const next = items.map((item, i) => {
      if (i !== index) return item;
      const mergedName = patch.name !== undefined ? patch.name.trim() : item.name;
      if (!mergedName) return item;
      const roleLabel = patch.roleLabel !== undefined ? patch.roleLabel.trim() : item.roleLabel;
      const model = patch.model !== undefined ? patch.model.trim() : item.model;
      const prompt = patch.prompt !== undefined ? patch.prompt : item.prompt;
      return {
        name: mergedName,
        ...(roleLabel ? { roleLabel } : {}),
        ...(model ? { model } : {}),
        ...(item.tools?.length ? { tools: item.tools } : {}),
        ...(prompt?.trim() ? { prompt } : {}),
      } satisfies NovelParallelSubagentConfig;
    });
    commitItems(next);
  };

  const removeAt = (index: number) => {
    commitItems(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1.5 rounded border border-border bg-muted/30 p-2" data-testid="parallel-subagents-editor">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-medium text-foreground">
          并行多子代理编排{items.length > 0 ? `（${items.length}）` : ""}
        </span>
        <button
          type="button"
          aria-label="添加并行子代理"
          disabled={!editable}
          onClick={addParallel}
          className="inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-2xs text-foreground hover:bg-muted disabled:opacity-50"
        >
          <Plus className="size-3" />
          添加并行角色
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-2xs text-muted-foreground">
          未配置时由上方单个子代理独立完成；添加多个角色可在同一工序内并行派发并汇总。
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, idx) => (
            <li key={`${idx}-${item.name}`} className="space-y-1.5 rounded border border-border bg-card p-2">
              <div className="flex items-center justify-between gap-1.5">
                <select
                  aria-label={`选择第 ${idx + 1} 个并行子代理模板`}
                  value={subagentOptions.some((opt) => opt.id === item.name) ? item.name : ""}
                  disabled={!editable}
                  onChange={(event) => {
                    const picked = subagentOptions.find((opt) => opt.id === event.target.value);
                    if (picked) {
                      updateAt(idx, { name: picked.id, roleLabel: picked.nameZh });
                    }
                  }}
                  className={fieldClass}
                >
                  <option value="">从名册快选填入…</option>
                  {subagentOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.nameZh}（{SOURCE_BADGE_TEXT[opt.source ?? "builtin"]}）
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`删除第 ${idx + 1} 个并行子代理`}
                  disabled={!editable}
                  onClick={() => removeAt(idx)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <CommitInput
                  ariaLabel={`第 ${idx + 1} 个并行子代理名称`}
                  value={item.name}
                  disabled={!editable}
                  placeholder="角色标识或名称"
                  onCommit={(text) => {
                    if (text.trim()) updateAt(idx, { name: text });
                  }}
                />
                <CommitInput
                  ariaLabel={`第 ${idx + 1} 个并行子代理分工`}
                  value={item.roleLabel ?? ""}
                  disabled={!editable}
                  placeholder="分工标签（如：打斗专精）"
                  onCommit={(text) => updateAt(idx, { roleLabel: text })}
                />
              </div>
              {runtimeModels.length > 0 ? (
                <select
                  aria-label={`选择第 ${idx + 1} 个并行子代理模型`}
                  value={runtimeModels.some((m) => m.value === item.model) ? (item.model ?? "") : ""}
                  disabled={!editable}
                  onChange={(event) => updateAt(idx, { model: event.target.value })}
                  className={fieldClass}
                >
                  <option value="">模型快选（留空跟随工序）</option>
                  {runtimeModels.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <CommitInput
                ariaLabel={`第 ${idx + 1} 个并行子代理模型`}
                listId={runtimeModels.length > 0 ? modelDatalistId : undefined}
                value={item.model ?? ""}
                disabled={!editable}
                placeholder="独立模型覆盖（可选）"
                onCommit={(text) => updateAt(idx, { model: text })}
              />
              <CommitInput
                ariaLabel={`第 ${idx + 1} 个并行子代理要求`}
                value={item.prompt ?? ""}
                disabled={!editable}
                placeholder="该角色的专属视角或检查重点（可选）"
                onCommit={(text) => updateAt(idx, { prompt: text })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepFields({
  step,
  editable,
  onOps,
  customSubagents = [],
  runtimeModels = [],
  availableSkills = [],
  writableTools = AUTHORITATIVE_WRITABLE_NOVEL_TOOLS,
}: {
  step: WorkflowStepNode;
  editable: boolean;
  onOps: (ops: WorkflowGraphOp[]) => void;
  customSubagents?: readonly SubagentOption[];
  runtimeModels?: readonly RuntimeModelOption[];
  availableSkills?: readonly RuntimeSkillOption[];
  writableTools?: readonly WritableNovelToolOption[];
}) {
  const modelDatalistId = useId();
  const [showAllTools, setShowAllTools] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");

  const update = (patch: Record<string, unknown>) => onOps([{ op: "update_node", id: step.id, patch }]);
  const listPatch = (key: "tools" | "skills" | "outcomes", text: string) => {
    const items = parseList(text);
    update({ [key]: items.length > 0 ? items : null });
  };

  const builtinOptions: SubagentOption[] = useMemo(
    () =>
      NOVEL_SUBAGENT_ROSTER.map((item) => ({
        id: item.id,
        nameZh: item.nameZh,
        description: item.description,
        source: "builtin" as const,
      })),
    [],
  );

  const normalizedExtras: SubagentOption[] = useMemo(() => {
    const seen = new Set(builtinOptions.map((item) => item.id));
    const list: SubagentOption[] = [];
    for (const item of customSubagents) {
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      list.push({
        ...item,
        source: item.source ?? (item.isCustom ? "book-custom" : "runtime-global"),
      });
    }
    return list;
  }, [builtinOptions, customSubagents]);

  const bookCustomOptions = normalizedExtras.filter((opt) => opt.source === "book-custom");
  const runtimeGlobalOptions = normalizedExtras.filter((opt) => opt.source === "runtime-global");
  const allSubagentOptions = useMemo(
    () => [...builtinOptions, ...bookCustomOptions, ...runtimeGlobalOptions],
    [builtinOptions, bookCustomOptions, runtimeGlobalOptions],
  );
  const currentAgentKnown = !step.agentId || allSubagentOptions.some((opt) => opt.id === step.agentId);

  const selectedTools = step.tools ?? [];
  const selectedToolSet = new Set(selectedTools);
  const visibleWritableTools = showAllTools
    ? writableTools
    : writableTools.filter((tool) => tool.common || selectedToolSet.has(tool.name));

  const toggleTool = (toolName: string) => {
    const next = selectedToolSet.has(toolName)
      ? selectedTools.filter((item) => item !== toolName)
      : [...selectedTools, toolName];
    update({ tools: next.length > 0 ? next : null });
  };

  const selectedSkills = step.skills ?? [];
  const selectedSkillSet = new Set(selectedSkills);
  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    return availableSkills
      .filter((skill) => {
        if (!q) return true;
        return (
          skill.name.toLowerCase().includes(q) ||
          skill.description.toLowerCase().includes(q) ||
          (skill.kind?.toLowerCase().includes(q) ?? false)
        );
      })
      .slice(0, 14);
  }, [availableSkills, skillQuery]);

  const toggleSkill = (skillName: string) => {
    const next = selectedSkillSet.has(skillName)
      ? selectedSkills.filter((item) => item !== skillName)
      : [...selectedSkills, skillName];
    update({ skills: next.length > 0 ? next : null });
  };

  const { recommended: recommendedPresets, others: otherPresets } = useMemo(
    () => getStepPromptPresetsForKind(step.kind),
    [step.kind],
  );

  const canConfigureModel = step.executionMode !== "tool-only";

  return (
    <>
      {runtimeModels.length > 0 ? (
        <datalist id={modelDatalistId}>
          {runtimeModels.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </datalist>
      ) : null}

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
        <>
          <label className={labelClass}>
            子代理
            <select
              aria-label="子代理"
              value={step.agentId ?? ""}
              disabled={!editable}
              onChange={(event) => update({ agentId: event.target.value.trim() || null })}
              className={fieldClass}
            >
              <option value="">自动匹配（按工序类型）</option>
              <optgroup label="小说内置子代理">
                {builtinOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.nameZh}（内置）
                  </option>
                ))}
              </optgroup>
              {bookCustomOptions.length > 0 ? (
                <optgroup label="本书定制子代理">
                  {bookCustomOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.nameZh}（本书定制）
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {runtimeGlobalOptions.length > 0 ? (
                <optgroup label="NarraFork Runtime 全局子代理">
                  {runtimeGlobalOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.nameZh}（Runtime全局）
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {!currentAgentKnown && step.agentId ? (
                <option value={step.agentId}>{step.agentId}（自定义标识）</option>
              ) : null}
            </select>
          </label>
          <ParallelSubagentsEditor
            items={step.parallelSubagents ?? []}
            editable={editable}
            subagentOptions={allSubagentOptions}
            runtimeModels={runtimeModels}
            modelDatalistId={modelDatalistId}
            onChange={(next) => update({ parallelSubagents: next })}
          />
        </>
      ) : null}

      {canConfigureModel ? (
        <div className="space-y-1">
          <label className={labelClass}>
            指定模型覆盖（可选）
            {runtimeModels.length > 0 ? (
              <select
                aria-label="从 Runtime 模型快选"
                value={runtimeModels.some((m) => m.value === step.modelOverride) ? (step.modelOverride ?? "") : ""}
                disabled={!editable}
                onChange={(event) => update({ modelOverride: event.target.value || null })}
                className={fieldClass}
              >
                <option value="">跟随默认模型（从已启用模型快选…）</option>
                {runtimeModels.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}（{model.value}）
                  </option>
                ))}
              </select>
            ) : null}
            <CommitInput
              ariaLabel="指定模型覆盖"
              listId={runtimeModels.length > 0 ? modelDatalistId : undefined}
              value={step.modelOverride ?? ""}
              disabled={!editable}
              placeholder="留空跟随默认，或填 provider:model"
              onCommit={(text) => update({ modelOverride: text.trim() || null })}
            />
          </label>
        </div>
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

      <div className="space-y-1.5" data-testid="writable-tools-picker">
        <label className={labelClass}>
          可用的写入工具（逗号分隔；读类工具恒可用）
          <CommitInput ariaLabel="可用的写入工具" value={selectedTools.join("，")} disabled={!editable} onCommit={(text) => listPatch("tools", text)} />
        </label>
        {writableTools.length > 0 ? (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1">
              {visibleWritableTools.map((tool) => {
                const active = selectedToolSet.has(tool.name);
                return (
                  <button
                    key={tool.name}
                    type="button"
                    aria-pressed={active}
                    disabled={!editable}
                    title={`${tool.name}：${tool.descriptionZh}`}
                    onClick={() => toggleTool(tool.name)}
                    className={`rounded border px-1.5 py-0.5 text-2xs transition-colors disabled:opacity-50 ${
                      active
                        ? "border-primary/40 bg-primary/10 font-medium text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {tool.nameZh} · {tool.name}
                  </button>
                );
              })}
            </div>
            {writableTools.length > visibleWritableTools.length || showAllTools ? (
              <button
                type="button"
                data-testid="toggle-all-writable-tools"
                onClick={() => setShowAllTools((prev) => !prev)}
                className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground hover:text-foreground"
              >
                {showAllTools ? (
                  <>
                    <ChevronUp className="size-3" />
                    收起低频写入工具
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3" />
                    展开全部 {writableTools.length} 个可授权写入工具
                  </>
                )}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5" data-testid="skills-picker">
        <label className={labelClass}>
          技能（逗号分隔）
          <CommitInput ariaLabel="技能" value={selectedSkills.join("，")} disabled={!editable} onCommit={(text) => listPatch("skills", text)} />
        </label>
        {selectedSkills.length > 0 ? (
          <div className="flex flex-wrap gap-1" data-testid="mounted-skills-badges">
            {selectedSkills.map((skillName) => (
              <span
                key={skillName}
                className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-2xs text-primary"
              >
                <span>{skillName}</span>
                {editable ? (
                  <button
                    type="button"
                    aria-label={`移除技能 ${skillName}`}
                    onClick={() => toggleSkill(skillName)}
                    className="rounded hover:bg-primary/20"
                  >
                    <X className="size-2.5" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        {availableSkills.length > 0 ? (
          <div className="space-y-1 rounded border border-border bg-muted/20 p-1.5" data-testid="available-skills-panel">
            <input
              aria-label="搜索可用技能"
              value={skillQuery}
              disabled={!editable}
              placeholder={`搜索 ${availableSkills.length} 个可用技能点选挂载…`}
              onChange={(event) => setSkillQuery(event.target.value)}
              className={fieldClass}
            />
            {filteredSkills.length === 0 ? (
              <p className="px-1 py-0.5 text-2xs text-muted-foreground">没有匹配的技能，可在上方输入框直接填写精确技能名。</p>
            ) : (
              <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto pt-0.5">
                {filteredSkills.map((skill) => {
                  const mounted = selectedSkillSet.has(skill.name);
                  return (
                    <button
                      key={skill.name}
                      type="button"
                      aria-pressed={mounted}
                      disabled={!editable}
                      title={skill.description ? `${skill.name}：${skill.description}` : skill.name}
                      onClick={() => toggleSkill(skill.name)}
                      className={`rounded border px-1.5 py-0.5 text-2xs transition-colors disabled:opacity-50 ${
                        mounted
                          ? "border-primary/40 bg-primary/10 font-medium text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {skill.name}
                      {skill.kind ? ` · ${skill.kind}` : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <label className={labelClass}>
        失败时
        <select aria-label="失败时" value={step.onFailure ?? "stop"} disabled={!editable} onChange={(event) => update({ onFailure: event.target.value })} className={fieldClass}>
          {Object.entries(FAILURE_LABEL).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </label>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="text-2xs text-muted-foreground">附加要求（进入这道工序的简报）</span>
          <div className="inline-flex items-center gap-1">
            <Sparkles className="size-3 text-primary" aria-hidden />
            <select
              aria-label="套用提示词预设"
              value=""
              disabled={!editable}
              onChange={(event) => {
                const picked = STEP_PROMPT_PRESETS.find((item) => item.id === event.target.value);
                if (picked) update({ customPrompt: picked.prompt });
              }}
              className="max-w-[168px] rounded border border-border bg-background px-1.5 py-0.5 text-2xs text-foreground outline-none focus:border-primary disabled:opacity-50"
            >
              <option value="">套用预设模板 ▾</option>
              {recommendedPresets.length > 0 ? (
                <optgroup label="当前工序推荐模板">
                  {recommendedPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {otherPresets.length > 0 ? (
                <optgroup label="其他工序预设模板">
                  {otherPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      [{preset.categoryLabel}] {preset.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
        </div>
        <CommitInput
          ariaLabel="附加要求"
          multiline
          value={step.customPrompt ?? ""}
          disabled={!editable}
          onCommit={(text) => update({ customPrompt: text.trim() ? text : null })}
        />
      </div>
    </>
  );
}

export function WorkflowInspector({
  recipe,
  issues,
  selection,
  editable,
  onOps,
  onSelect,
  customSubagents,
  runtimeModels,
  availableSkills,
  writableTools,
}: WorkflowInspectorProps) {
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
        {node.type === "step" ? (
          <StepFields
            step={node}
            editable={editable}
            onOps={onOps}
            customSubagents={customSubagents}
            runtimeModels={runtimeModels}
            availableSkills={availableSkills}
            writableTools={writableTools}
          />
        ) : null}
        {node.type === "join" ? <p className="text-xs text-muted-foreground">汇合节点等所有入线都走完（或因分支未选中而作废）后才继续。</p> : null}
        {node.type === "step" && requiresAuthorDecision(node) ? (
          <p className="text-xs text-muted-foreground">从卡片右侧的橙色连接点拖一条线到上游工序，作者打回时就回到那里重做；不连则打回本工序重做。</p>
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
          <div className="text-xs font-medium text-destructive">结构问题（{issues.length}）——修好后才能发布</div>
          <IssueList issues={issues} onSelect={onSelect} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">结构完整。点选节点或连线可以编辑它；从节点底部的连接点拖线可以连接下一步。</p>
      )}
    </div>
  );
}
