/** 子代理工坊与名册：内置只读名册 + NarraFork 全局子代理导入 + 按书复制新建/编辑自定义子代理（工具白名单受控）。 */

import { useCallback, useEffect, useId, useState } from "react";
import { Bot, CopyPlus, Download, Globe, Plus, Save, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NOVEL_SUBAGENT_ROSTER, type NovelSubagentTemplate } from "../../engine/agents/roster.js";
import { CUSTOM_SUBAGENT_ALLOWED_TOOLS, type CustomSubagentConfig } from "../../engine/agents/custom-subagents-shared.js";
import {
  fetchJsonSafe,
  parseRuntimeGlobalSubagentsResponse,
  parseRuntimeModelsResponse,
  type RuntimeGlobalSubagentItem,
  type RuntimeModelOption,
} from "../writing-workbench/workflow-canvas/runtime-workflow-catalog";
import { toolDisplayName } from "./workflow-step-list-model";

const SUBMITS = "workflow.step";
const DEFAULT_SAFE_TOOLS = ["chapter.list", "jingwei.read", "memory.read", SUBMITS] as const;

export interface WorkflowSubagentRosterProps {
  readonly bookId?: string;
}

interface SubagentDraft {
  readonly editingId: string | null;
  readonly nameZh: string;
  readonly description: string;
  readonly prompt: string;
  readonly defaultModel: string;
  readonly basedOn?: string;
  readonly tools: readonly string[];
}

export function WorkflowSubagentRoster({ bookId }: WorkflowSubagentRosterProps) {
  const modelDatalistId = useId();
  const [customList, setCustomList] = useState<readonly CustomSubagentConfig[]>([]);
  const [globalList, setGlobalList] = useState<readonly RuntimeGlobalSubagentItem[]>([]);
  const [runtimeModels, setRuntimeModels] = useState<readonly RuntimeModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SubagentDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [cloningName, setCloningName] = useState<string | null>(null);

  const loadCustom = useCallback(async () => {
    if (!bookId) {
      setCustomList([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/subagents`);
      if (!res.ok) return;
      const body = (await res.json()) as { custom?: readonly CustomSubagentConfig[] };
      setCustomList(Array.isArray(body.custom) ? body.custom : []);
    } catch {
      // 只读列表容错，不影响内置展示
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void loadCustom();
  }, [loadCustom]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJsonSafe("/api/settings"),
      fetchJsonSafe("/api/custom-subagents"),
    ]).then(([modelsBody, globalBody]) => {
      if (cancelled) return;
      setRuntimeModels(parseRuntimeModelsResponse(modelsBody));
      setGlobalList(parseRuntimeGlobalSubagentsResponse(globalBody));
    });
    return () => { cancelled = true; };
  }, []);

  const startCopyFromTemplate = (template: NovelSubagentTemplate) => {
    setError(null);
    setDraft({
      editingId: null,
      nameZh: `${template.nameZh}（定制）`,
      description: template.description,
      prompt: template.prompt,
      defaultModel: template.defaultModel ?? "",
      basedOn: template.id,
      tools: [...template.tools],
    });
  };

  const startBlank = () => {
    setError(null);
    setDraft({
      editingId: null,
      nameZh: "新定制帮手",
      description: "按特定套路辅助阅读与审查",
      prompt: "",
      defaultModel: "",
      tools: [...DEFAULT_SAFE_TOOLS],
    });
  };

  const startEditCustom = (agent: CustomSubagentConfig) => {
    setError(null);
    setDraft({
      editingId: agent.id,
      nameZh: agent.nameZh,
      description: agent.description,
      prompt: agent.prompt,
      defaultModel: agent.defaultModel ?? "",
      ...(agent.basedOn ? { basedOn: agent.basedOn } : {}),
      tools: [...agent.tools],
    });
  };

  const cloneGlobalToBook = async (agent: RuntimeGlobalSubagentItem) => {
    if (!bookId || cloningName) return;
    setCloningName(agent.name);
    setError(null);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameZh: agent.name,
          description: agent.description || "从 NarraFork 全局自定义子代理克隆导入",
          prompt: agent.prompt ?? "",
          defaultModel: agent.model ?? "",
          tools: [...DEFAULT_SAFE_TOOLS],
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? `克隆失败（HTTP ${res.status}）`);
      await loadCustom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "克隆失败");
    } finally {
      setCloningName(null);
    }
  };

  const toggleDraftTool = (tool: string) => {
    if (!draft) return;
    const has = draft.tools.includes(tool);
    setDraft({
      ...draft,
      tools: has ? draft.tools.filter((t) => t !== tool) : [...draft.tools, tool],
    });
  };

  const saveDraft = async () => {
    if (!bookId || !draft || saving) return;
    if (!draft.nameZh.trim()) {
      setError("子代理名称不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = draft.editingId
        ? `/api/books/${encodeURIComponent(bookId)}/subagents/${encodeURIComponent(draft.editingId)}`
        : `/api/books/${encodeURIComponent(bookId)}/subagents`;
      const method = draft.editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameZh: draft.nameZh.trim(),
          description: draft.description.trim(),
          prompt: draft.prompt,
          defaultModel: draft.defaultModel.trim(),
          ...(draft.basedOn ? { basedOn: draft.basedOn } : {}),
          tools: draft.tools,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? `保存失败（HTTP ${res.status}）`);
      setDraft(null);
      await loadCustom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const removeCustom = async (id: string) => {
    if (!bookId) return;
    setError(null);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/subagents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`删除失败（HTTP ${res.status}）`);
      await loadCustom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  return (
    <section className="space-y-4" aria-label="子代理一览" data-testid="workflow-subagent-roster">
      {runtimeModels.length > 0 ? (
        <datalist id={modelDatalistId}>
          {runtimeModels.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </datalist>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          工序可以委派给下面这些帮手。它们只读资料、把产物交给工作流，不会直接改正文或设定；需要你确认的工序仍会停下来等你。
        </p>
        {bookId ? (
          <Button type="button" size="xs" variant="outline" className="gap-1" onClick={startBlank} data-testid="create-custom-subagent">
            <Plus className="size-3.5" />
            新建子代理
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {draft ? (
        <div className="space-y-2.5 rounded-lg border border-primary/40 bg-card p-3 text-xs" data-testid="custom-subagent-editor">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">
              {draft.editingId ? "编辑定制子代理" : "新建定制子代理"}
            </span>
            <button type="button" onClick={() => setDraft(null)} className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
              名称
              <input
                aria-label="定制子代理名称"
                value={draft.nameZh}
                onChange={(e) => setDraft({ ...draft, nameZh: e.target.value })}
                className="h-7 rounded border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
              />
            </label>
            <div className="flex flex-col gap-1 text-2xs text-muted-foreground">
              <span>默认模型（可选）</span>
              {runtimeModels.length > 0 ? (
                <select
                  aria-label="选择定制子代理模型"
                  value={runtimeModels.some((m) => m.value === draft.defaultModel) ? draft.defaultModel : ""}
                  onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}
                  className="h-7 rounded border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                >
                  <option value="">从已启用模型快选（或下方手动输入）…</option>
                  {runtimeModels.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}（{model.value}）
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                aria-label="定制子代理模型"
                list={runtimeModels.length > 0 ? modelDatalistId : undefined}
                value={draft.defaultModel}
                placeholder="留空则跟随当前配置"
                onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}
                className="h-7 rounded border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>
          <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
            职责说明
            <input
              aria-label="定制子代理职责"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="h-7 rounded border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
            专属提示词（附加要求）
            <textarea
              aria-label="定制子代理提示词"
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              className="min-h-20 rounded border bg-background p-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
          <div className="space-y-1">
            <div className="text-2xs text-muted-foreground">允许使用的工具（仅开放安全只读与提交类工具）</div>
            <div className="flex flex-wrap gap-1.5">
              {CUSTOM_SUBAGENT_ALLOWED_TOOLS.map((tool) => {
                const selected = draft.tools.includes(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleDraftTool(tool)}
                    className={`rounded border px-2 py-0.5 text-2xs transition-colors ${
                      selected
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {toolDisplayName(tool)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="xs" variant="ghost" onClick={() => setDraft(null)}>取消</Button>
            <Button type="button" size="xs" onClick={() => void saveDraft()} disabled={saving} data-testid="save-custom-subagent">
              <Save className="mr-1 size-3" />
              保存子代理
            </Button>
          </div>
        </div>
      ) : null}

      {bookId && (customList.length > 0 || loading) ? (
        <div className="space-y-2" data-testid="custom-subagent-list">
          <div className="text-xs font-semibold text-foreground">本书定制子代理（{customList.length}）</div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {customList.map((agent) => (
              <li key={agent.id} className="space-y-1.5 rounded-lg border border-primary/25 bg-card p-3" data-testid={`custom-subagent-${agent.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Bot className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="truncate text-sm font-medium">{agent.nameZh}</span>
                    {agent.tools.includes(SUBMITS) ? <Badge variant="outline">交产物</Badge> : <Badge variant="secondary">只给建议</Badge>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => startEditCustom(agent)} className="rounded px-1.5 py-0.5 text-2xs text-primary hover:bg-primary/10">编辑</button>
                    <button type="button" onClick={() => void removeCustom(agent.id)} aria-label={`删除 ${agent.nameZh}`} className="rounded p-1 text-muted-foreground hover:text-destructive">
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{agent.description || "自定义专属帮手"}</p>
                {agent.defaultModel ? (
                  <div className="text-2xs text-muted-foreground">默认模型：{agent.defaultModel}</div>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {[...new Set(agent.tools.map(toolDisplayName))].map((name) => (
                    <span key={name} className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">{name}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {globalList.length > 0 ? (
        <div className="space-y-2" data-testid="runtime-global-subagent-list">
          <div className="text-xs font-semibold text-foreground">NarraFork 全局自定义子代理（{globalList.length}）</div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {globalList.map((agent) => (
              <li key={agent.name} className="space-y-1.5 rounded-lg border bg-card p-3" data-testid={`global-subagent-${agent.name}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Globe className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="truncate text-sm font-medium">{agent.name}</span>
                    <Badge variant="secondary">Runtime全局</Badge>
                  </div>
                  {bookId ? (
                    <button
                      type="button"
                      disabled={cloningName === agent.name}
                      onClick={() => void cloneGlobalToBook(agent)}
                      data-testid={`clone-global-subagent-${agent.name}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      <Download className="size-3" />
                      克隆到本书工坊
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{agent.description || "NarraFork 全局自定义子代理"}</p>
                {agent.model ? (
                  <div className="text-2xs text-muted-foreground">预设模型：{agent.model}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="grid gap-2 sm:grid-cols-2">
        {NOVEL_SUBAGENT_ROSTER.map((template) => (
          <li key={template.id} className="space-y-1.5 rounded-lg border bg-card p-3" data-testid={`workflow-subagent-${template.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Bot className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="truncate text-sm font-medium">{template.nameZh}</span>
                {template.tools.includes(SUBMITS) ? <Badge variant="outline">交产物</Badge> : <Badge variant="secondary">只给建议</Badge>}
              </div>
              {bookId ? (
                <button
                  type="button"
                  onClick={() => startCopyFromTemplate(template)}
                  data-testid={`copy-subagent-${template.id}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <CopyPlus className="size-3" />
                  复制新建
                </button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{template.description}</p>
            <div className="flex flex-wrap gap-1" aria-label={`${template.nameZh}可用的工具`}>
              {[...new Set(template.tools.map(toolDisplayName))].map((name) => (
                <span key={name} className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">{name}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
