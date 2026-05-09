import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";

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

interface AgentBehaviorConfig {
  defaultPlanMode: boolean;
  autoCompact: boolean;
  autoTitle: boolean;
  streamToolOutput: boolean;
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

const DEFAULT_BEHAVIOR: AgentBehaviorConfig = {
  defaultPlanMode: false,
  autoCompact: true,
  autoTitle: true,
  streamToolOutput: true,
};

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

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
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
  const [agents, setAgents] = useState<SubagentDefinition[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [behavior, setBehavior] = useState<AgentBehaviorConfig>(DEFAULT_BEHAVIOR);

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

      {/* ---- Agent 行为配置 ---- */}
      <Section title="Agent 行为">
        <FieldRow label="默认进入计划模式">
          <Switch checked={behavior.defaultPlanMode} onCheckedChange={(v) => setBehavior((b) => ({ ...b, defaultPlanMode: v }))} />
        </FieldRow>
        <FieldRow label="自动 Compact（上下文压缩）">
          <Switch checked={behavior.autoCompact} onCheckedChange={(v) => setBehavior((b) => ({ ...b, autoCompact: v }))} />
        </FieldRow>
        <FieldRow label="自动生成会话标题">
          <Switch checked={behavior.autoTitle} onCheckedChange={(v) => setBehavior((b) => ({ ...b, autoTitle: v }))} />
        </FieldRow>
        <FieldRow label="流式输出工具结果">
          <Switch checked={behavior.streamToolOutput} onCheckedChange={(v) => setBehavior((b) => ({ ...b, streamToolOutput: v }))} />
        </FieldRow>
      </Section>
    </div>
  );
}
