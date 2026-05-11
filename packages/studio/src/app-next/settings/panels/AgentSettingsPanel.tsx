import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { fetchJson, putApi } from "@/hooks/use-api";
import { USER_SETTINGS_API_PATH } from "@/app-next/backend-contract";
import type { RuntimeControlSettings, UserConfig } from "@/types/settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubagentDefinition {
  id: string;
  name: string;
  type: "explore" | "plan" | "general" | "review";
  modelId: string;
  systemPrompt: string;
  maxSteps: number;
  enabled: boolean;
}

/** Fields persisted via backend runtimeControls */
interface PersistedFields {
  relaxedPlanning: boolean;
  yoloSkipReadonlyConfirmation: boolean;
  expandReasoning: boolean;
  maxRetryAttempts: number;
  maxRetryDelayMs: number;
  maxTurnSteps: number;
}

/** Fields that don't have backend support yet */
interface LocalOnlyFields {
  defaultPlanMode: boolean;
  autoApprovePlan: boolean;
  dangerReflection: boolean;
  firstTokenTimeout: number;
}

interface RetryRule {
  id: string;
  enabled: boolean;
  httpStatus: string;
  contentKeyword: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUBAGENT_TYPE_OPTIONS = [
  { value: "explore", label: "Explore（探索）" },
  { value: "plan", label: "Plan（规划）" },
  { value: "general", label: "General（通用）" },
  { value: "review", label: "Review（审查）" },
];

const DEFAULT_PERSISTED: PersistedFields = {
  relaxedPlanning: true,
  yoloSkipReadonlyConfirmation: false,
  expandReasoning: false,
  maxRetryAttempts: 10,
  maxRetryDelayMs: 20000,
  maxTurnSteps: 200,
};

const DEFAULT_LOCAL: LocalOnlyFields = {
  defaultPlanMode: false,
  autoApprovePlan: false,
  dangerReflection: true,
  firstTokenTimeout: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function createEmptyAgent(): SubagentDefinition {
  return {
    id: generateId(),
    name: "",
    type: "general",
    modelId: "",
    systemPrompt: "",
    maxSteps: 25,
    enabled: true,
  };
}

function createEmptyRetryRule(): RetryRule {
  return {
    id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    enabled: true,
    httpStatus: "",
    contentKeyword: "",
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseNumInput(raw: string, fallback: number, min: number, max: number) {
  if (raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clampNumber(n, min, max) : fallback;
}

/** Extract persisted fields from a UserConfig response */
function extractPersistedFields(rc: RuntimeControlSettings): PersistedFields {
  return {
    relaxedPlanning: rc.relaxedPlanning ?? DEFAULT_PERSISTED.relaxedPlanning,
    yoloSkipReadonlyConfirmation: rc.yoloSkipReadonlyConfirmation ?? DEFAULT_PERSISTED.yoloSkipReadonlyConfirmation,
    expandReasoning: rc.expandReasoning ?? DEFAULT_PERSISTED.expandReasoning,
    maxRetryAttempts: rc.recovery?.maxRetryAttempts ?? DEFAULT_PERSISTED.maxRetryAttempts,
    maxRetryDelayMs: rc.recovery?.maxRetryDelayMs ?? DEFAULT_PERSISTED.maxRetryDelayMs,
    maxTurnSteps: rc.maxTurnSteps ?? DEFAULT_PERSISTED.maxTurnSteps,
  };
}

/** Compare two PersistedFields objects for equality */
function isPersistedEqual(a: PersistedFields, b: PersistedFields): boolean {
  return (
    a.relaxedPlanning === b.relaxedPlanning &&
    a.yoloSkipReadonlyConfirmation === b.yoloSkipReadonlyConfirmation &&
    a.expandReasoning === b.expandReasoning &&
    a.maxRetryAttempts === b.maxRetryAttempts &&
    a.maxRetryDelayMs === b.maxRetryDelayMs &&
    a.maxTurnSteps === b.maxTurnSteps
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-4">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {description && <p className="mb-3 text-xs text-muted-foreground">{description}</p>}
      {!description && <div className="mb-3" />}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FieldRow({ label, description, badge, children }: { label: string; description?: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <span className="text-sm text-muted-foreground">
          {label}
          {badge && <span className="ml-1.5 text-[10px] text-muted-foreground/60">({badge})</span>}
        </span>
        {description && <p className="text-xs text-muted-foreground/70">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubagentForm
// ---------------------------------------------------------------------------

function SubagentForm({
  agent,
  onChange,
  onDelete,
  onCancel,
}: {
  agent: SubagentDefinition;
  onChange: (agent: SubagentDefinition) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted-foreground">名称</span>
          <Input
            className="mt-1"
            value={agent.name}
            onChange={(e) => onChange({ ...agent, name: e.target.value })}
            placeholder="例如：大纲规划师"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">类型</span>
          <div className="mt-1">
            <SimpleSelect
              value={agent.type}
              onValueChange={(val) => onChange({ ...agent, type: val as SubagentDefinition["type"] })}
              options={SUBAGENT_TYPE_OPTIONS}
              className="w-full"
              aria-label="子代理类型"
            />
          </div>
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-muted-foreground">模型 ID</span>
        <Input
          className="mt-1"
          value={agent.modelId}
          onChange={(e) => onChange({ ...agent, modelId: e.target.value })}
          placeholder="例如：claude-sonnet-4-20250514"
        />
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground">系统提示词</span>
        <Textarea
          className="mt-1"
          rows={4}
          value={agent.systemPrompt}
          onChange={(e) => onChange({ ...agent, systemPrompt: e.target.value })}
          placeholder="为该子代理定义角色和行为..."
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted-foreground">最大步数</span>
          <Input
            className="mt-1"
            type="number"
            min={1}
            max={200}
            value={agent.maxSteps}
            onChange={(e) => onChange({ ...agent, maxSteps: Math.max(1, Math.min(200, Number(e.target.value) || 25)) })}
          />
        </label>
        <div className="flex items-end">
          <FieldRow label="启用">
            <Switch checked={agent.enabled} onCheckedChange={(v) => onChange({ ...agent, enabled: v })} />
          </FieldRow>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
        )}
        {onDelete && (
          <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
            删除
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AgentSettingsPanel() {
  // --- Subagent definitions (local-only) ---
  const [agents, setAgents] = useState<SubagentDefinition[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // --- Persisted fields (backed by API) ---
  const [persisted, setPersisted] = useState<PersistedFields>(DEFAULT_PERSISTED);
  const savedRef = useRef<PersistedFields>(DEFAULT_PERSISTED);

  // --- Local-only fields (no backend yet) ---
  const [local, setLocal] = useState<LocalOnlyFields>(DEFAULT_LOCAL);

  // --- Retry rules (local-only) ---
  const [retryRules, setRetryRules] = useState<RetryRule[]>([]);

  // --- Loading / saving state ---
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Dirty detection ---
  const isDirty = !isPersistedEqual(persisted, savedRef.current);

  // --- Load from backend on mount ---
  useEffect(() => {
    let cancelled = false;

    fetchJson<UserConfig>(USER_SETTINGS_API_PATH)
      .then((data) => {
        if (cancelled) return;
        if (data?.runtimeControls) {
          const fields = extractPersistedFields(data.runtimeControls);
          setPersisted(fields);
          savedRef.current = fields;
        }
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // --- Save handler ---
  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const patch = {
        runtimeControls: {
          relaxedPlanning: persisted.relaxedPlanning,
          yoloSkipReadonlyConfirmation: persisted.yoloSkipReadonlyConfirmation,
          expandReasoning: persisted.expandReasoning,
          maxTurnSteps: persisted.maxTurnSteps,
          recovery: {
            maxRetryAttempts: persisted.maxRetryAttempts,
            maxRetryDelayMs: persisted.maxRetryDelayMs,
          },
        },
      };
      const updated = await putApi<UserConfig>(USER_SETTINGS_API_PATH, patch);
      if (updated?.runtimeControls) {
        const fields = extractPersistedFields(updated.runtimeControls);
        setPersisted(fields);
        savedRef.current = fields;
      } else {
        // If backend doesn't return full config, just mark current as saved
        savedRef.current = { ...persisted };
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // --- Reset handler ---
  function handleReset() {
    setPersisted(savedRef.current);
  }

  // --- Subagent handlers ---
  const handleAdd = () => {
    const newAgent = createEmptyAgent();
    setAgents((prev) => [...prev, newAgent]);
    setEditingId(newAgent.id);
  };

  const handleUpdate = (updated: SubagentDefinition) => {
    setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  const handleDelete = (id: string) => {
    setAgents((prev) => prev.filter((a) => a.id !== id));
    if (editingId === id) setEditingId(null);
  };

  // --- Retry rule handlers ---
  const handleAddRetryRule = () => {
    setRetryRules((prev) => [...prev, createEmptyRetryRule()]);
  };

  const handleUpdateRetryRule = (id: string, patch: Partial<RetryRule>) => {
    setRetryRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleDeleteRetryRule = (id: string) => {
    setRetryRules((prev) => prev.filter((r) => r.id !== id));
  };

  // --- Loading state ---
  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">正在读取 Agent 配置…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* ---- 子代理定义 ---- */}
      <Section title="子代理定义">
        {agents.length === 0 && !editingId && (
          <p className="text-sm text-muted-foreground">暂无自定义子代理。点击下方按钮添加。</p>
        )}
        {agents.map((agent) =>
          editingId === agent.id ? (
            <SubagentForm
              key={agent.id}
              agent={agent}
              onChange={handleUpdate}
              onDelete={() => handleDelete(agent.id)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div
              key={agent.id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{agent.name || "未命名"}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{agent.type}</span>
                  {!agent.enabled && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">已禁用</span>}
                </div>
                {agent.modelId && <p className="mt-0.5 text-xs text-muted-foreground font-mono truncate">{agent.modelId}</p>}
              </div>
              <Button type="button" variant="ghost" size="xs" onClick={() => setEditingId(agent.id)}>
                编辑
              </Button>
            </div>
          ),
        )}
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          添加子代理
        </Button>
      </Section>

      <Separator />

      {/* ---- 计划与审批 ---- */}
      <Section title="计划与审批">
        <FieldRow label="默认进入计划模式" badge="即将上线" description="新建叙述者默认启用计划模式。">
          <Switch
            checked={local.defaultPlanMode}
            onCheckedChange={(v) => setLocal((c) => ({ ...c, defaultPlanMode: v }))}
          />
        </FieldRow>
        <FieldRow label="默认宽松规划" description="启用后，规划时工具仍然可用，不会被禁用。">
          <Switch
            checked={persisted.relaxedPlanning}
            onCheckedChange={(v) => setPersisted((c) => ({ ...c, relaxedPlanning: v }))}
          />
        </FieldRow>
        <FieldRow label="全局默认自动批准计划" badge="即将上线" description="ExitPlanMode 计划反思确认后跳过人工审批。">
          <Switch
            checked={local.autoApprovePlan}
            onCheckedChange={(v) => setLocal((c) => ({ ...c, autoApprovePlan: v }))}
          />
        </FieldRow>
      </Section>

      {/* ---- 安全防护 ---- */}
      <Section title="安全防护">
        <FieldRow label="全局默认启用危险反思" badge="即将上线" description="全部允许模式下对高风险操作进行二次反思确认。">
          <Switch
            checked={local.dangerReflection}
            onCheckedChange={(v) => setLocal((c) => ({ ...c, dangerReflection: v }))}
          />
        </FieldRow>
        <FieldRow label="跳过只读危险反思确认" description="已确认只读的操作不再触发额外安全暂停。">
          <Switch
            checked={persisted.yoloSkipReadonlyConfirmation}
            onCheckedChange={(v) => setPersisted((c) => ({ ...c, yoloSkipReadonlyConfirmation: v }))}
          />
        </FieldRow>
      </Section>

      {/* ---- 重试与超时 ---- */}
      <Section title="重试与超时">
        <FieldRow label="可恢复错误最大重试次数" description="遇到临时性 API 错误时的最大重试次数。">
          <Input
            type="number"
            className="w-20"
            min={0}
            max={20}
            value={persisted.maxRetryAttempts}
            onChange={(e) => setPersisted((c) => ({ ...c, maxRetryAttempts: parseNumInput(e.target.value, c.maxRetryAttempts, 0, 20) }))}
          />
        </FieldRow>
        <FieldRow label="沉默工具调用阈值" description="连续执行这么多次工具调用但没有输出文本时，要求 AI 说明进度。">
          <Input
            type="number"
            className="w-20"
            min={1}
            max={1000}
            value={persisted.maxTurnSteps}
            onChange={(e) => setPersisted((c) => ({ ...c, maxTurnSteps: parseNumInput(e.target.value, c.maxTurnSteps, 1, 1000) }))}
          />
        </FieldRow>
        <FieldRow label="重试退避时间上限（秒）" description="指数退避的最大等待时间。">
          <Input
            type="number"
            className="w-20"
            min={1}
            max={120}
            value={Math.round(persisted.maxRetryDelayMs / 1000)}
            onChange={(e) => setPersisted((c) => ({ ...c, maxRetryDelayMs: parseNumInput(e.target.value, Math.round(c.maxRetryDelayMs / 1000), 1, 120) * 1000 }))}
          />
        </FieldRow>
        <FieldRow label="首 token 超时时间（秒）" badge="即将上线" description="API 请求发起后若在此秒数内没有收到实质事件则中断重试。0 表示禁用。">
          <Input
            type="number"
            className="w-20"
            min={0}
            value={local.firstTokenTimeout}
            onChange={(e) => setLocal((c) => ({ ...c, firstTokenTimeout: Math.max(0, Number(e.target.value) || 0) }))}
          />
        </FieldRow>
      </Section>

      {/* ---- 显示偏好 ---- */}
      <Section title="显示偏好">
        <FieldRow label="默认展开推理内容" description="自动展开消息中的推理/思考块，而不是默认折叠。">
          <Switch
            checked={persisted.expandReasoning}
            onCheckedChange={(v) => setPersisted((c) => ({ ...c, expandReasoning: v }))}
          />
        </FieldRow>
      </Section>

      {/* ---- 自定义可重试错误规则 ---- */}
      <Section
        title="自定义可重试错误规则"
        description="定义自定义规则，将特定 API 错误标记为可重试。匹配的错误将自动重试而非直接失败。(即将上线)"
      >
        {retryRules.length === 0 && (
          <p className="text-sm text-muted-foreground">暂无自定义规则。点击下方按钮添加。</p>
        )}
        {retryRules.map((rule) => (
          <div key={rule.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <Switch
              checked={rule.enabled}
              onCheckedChange={(v) => handleUpdateRetryRule(rule.id, { enabled: v })}
              aria-label="启用规则"
            />
            <Input
              type="number"
              className="w-20"
              placeholder="状态码"
              value={rule.httpStatus}
              onChange={(e) => handleUpdateRetryRule(rule.id, { httpStatus: e.target.value })}
              aria-label="HTTP 状态码"
            />
            <Input
              className="flex-1"
              placeholder="内容关键词匹配"
              value={rule.contentKeyword}
              onChange={(e) => handleUpdateRetryRule(rule.id, { contentKeyword: e.target.value })}
              aria-label="内容关键词"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => handleDeleteRetryRule(rule.id)}
              aria-label="删除规则"
            >
              删除
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={handleAddRetryRule}>
          添加规则
        </Button>
      </Section>

      {/* ---- Error display ---- */}
      {error && (
        <p className="text-sm text-destructive">加载/保存失败：{error}</p>
      )}

      {/* ---- Sticky dirty bar ---- */}
      {isDirty && (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background px-4 py-3">
          <Button variant="outline" size="sm" onClick={handleReset}>取消变更</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存变更"}
          </Button>
        </div>
      )}
    </div>
  );
}
