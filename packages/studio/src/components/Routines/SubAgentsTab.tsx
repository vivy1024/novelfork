/**
 * Sub-agents Tab - 自定义子代理管理
 */

import { useState } from "react";
import { Plus, Trash2, Edit2, Save, X, Bot } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/simple-select";
import { ConfirmDialog } from "../ConfirmDialog";
import type { SubAgent, ToolPermission } from "../../types/routines";

interface SubAgentsTabProps {
  subAgents: SubAgent[];
  onChange: (subAgents: SubAgent[]) => void;
}

const PERMISSION_LABELS: Record<ToolPermission["permission"], string> = {
  allow: "直接允许",
  ask: "需确认",
  deny: "拒绝",
};

const SUB_AGENT_TYPE_LABELS: Record<SubAgent["type"], string> = {
  "general-purpose": "通用代理",
  specialized: "专用代理",
};

function formatToolPermission(permission: ToolPermission): string {
  return `${permission.tool}：${PERMISSION_LABELS[permission.permission]}${permission.pattern ? ` · 规则 ${permission.pattern}` : ""}`;
}

function subAgentTypeLabel(type: SubAgent["type"]): string {
  return SUB_AGENT_TYPE_LABELS[type];
}

export function SubAgentsTab({ subAgents, onChange }: SubAgentsTabProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SubAgent>>({});
  const [deleteTarget, setDeleteTarget] = useState<SubAgent | null>(null);

  const handleAdd = () => {
    const newAgent: SubAgent = {
      id: `agent_${Date.now()}`,
      name: "新代理",
      description: "",
      type: "general-purpose",
      systemPrompt: "",
      enabled: true,
      toolPermissions: [],
    };
    setEditing(newAgent.id);
    setEditForm(newAgent);
    onChange([...subAgents, newAgent]);
  };

  const handleEdit = (agent: SubAgent) => {
    setEditing(agent.id);
    setEditForm(agent);
  };

  const handleSave = () => {
    if (!editing || !editForm.name?.trim()) return;

    onChange(
      subAgents.map((agent) =>
        agent.id === editing
          ? { ...agent, ...editForm, name: editForm.name!.trim() }
          : agent
      )
    );
    setEditing(null);
    setEditForm({});
  };

  const handleCancel = () => {
    if (editing && !subAgents.find((a) => a.id === editing)?.name) {
      onChange(subAgents.filter((a) => a.id !== editing));
    }
    setEditing(null);
    setEditForm({});
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    onChange(subAgents.filter((agent) => agent.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const handleToggle = (id: string) => {
    onChange(
      subAgents.map((agent) =>
        agent.id === id ? { ...agent, enabled: !agent.enabled } : agent
      )
    );
  };

  const updateToolPermissions = (value: string) => {
    try {
      const parsed = JSON.parse(value) as ToolPermission[];
      if (Array.isArray(parsed)) {
        setEditForm({ ...editForm, toolPermissions: parsed });
      }
    } catch {
      // Keep the previous valid value while the user is typing invalid JSON.
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          定义带有专用系统提示词和行为边界的自定义子代理
        </p>
        <Button variant="outline" size="sm" onClick={handleAdd}>
          <Plus size={14} />
          添加子代理
        </Button>
      </div>

      <div className="space-y-2">
        {subAgents.map((agent) => (
          <div key={agent.id} className="border rounded-lg p-3 bg-card">
            {editing === agent.id ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1">名称</label>
                  <Input
                    className="mt-1 w-full"
                    value={editForm.name ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="代理名称"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">描述</label>
                  <Input
                    className="mt-1 w-full"
                    value={editForm.description ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="这个代理做什么？"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">类型</label>
                  <SimpleSelect
                    className="mt-1 w-full"
                    value={editForm.type ?? "general-purpose"}
                    onValueChange={(val) => setEditForm({ ...editForm, type: val as SubAgent["type"] })}
                    options={[
                      { value: "general-purpose", label: "通用代理" },
                      { value: "specialized", label: "专用代理" },
                    ]}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">系统提示词</label>
                  <Textarea
                    className="mt-1 w-full"
                    value={editForm.systemPrompt ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, systemPrompt: e.target.value })}
                    rows={8}
                    placeholder="这个代理的系统提示词..."
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">工具权限规则</label>
                  <Textarea
                    className="mt-1 w-full"
                    value={JSON.stringify(editForm.toolPermissions ?? [], null, 2)}
                    onChange={(e) => updateToolPermissions(e.target.value)}
                    rows={4}
                    placeholder='[{"tool":"Bash","permission":"ask","pattern":"pnpm *","source":"project"}]'
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave}>
                    <Save size={12} />
                    保存
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCancel}>
                    <X size={12} />
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Bot size={16} className="text-primary" />
                    <span className="text-sm font-medium">{agent.name}</span>
                    <span className="text-xs text-muted-foreground">（{subAgentTypeLabel(agent.type)}）</span>
                    {!agent.enabled && (
                      <span className="text-xs text-muted-foreground">（已停用）</span>
                    )}
                  </div>
                  {agent.description && (
                    <p className="text-xs text-muted-foreground mb-2">{agent.description}</p>
                  )}
                  {agent.systemPrompt && (
                    <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto max-h-20">
                      {agent.systemPrompt.slice(0, 200)}
                      {agent.systemPrompt.length > 200 && "..."}
                    </pre>
                  )}
                  <div className="mt-2 rounded border bg-muted/30 p-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">工具权限规则</div>
                    {agent.toolPermissions?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {agent.toolPermissions.map((permission, index) => (
                          <code key={`${permission.tool}-${index}`} className="rounded bg-background px-1.5 py-0.5">
                            {formatToolPermission(permission)}
                          </code>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1">未配置专属工具权限，沿用当前 scope 默认规则。</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={agent.enabled}
                    onCheckedChange={() => handleToggle(agent.id)}
                  />
                  <Button variant="outline" size="sm" onClick={() => handleEdit(agent)} aria-label={`编辑子代理 ${agent.name}`}>
                    <Edit2 size={14} />
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(agent)} aria-label={`删除子代理 ${agent.name}`}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}

        {subAgents.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            还没有自定义子代理
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除子代理"
        message={deleteTarget ? `确定删除 ${deleteTarget.name}？此操作不可撤销。` : "确定删除这个子代理？此操作不可撤销。"}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
