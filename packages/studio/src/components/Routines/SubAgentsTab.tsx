/**
 * Sub-agents Tab - 自定义子代理管理
 */

import { useState } from "react";
import { Plus, Trash2, Edit2, Save, X, Bot } from "lucide-react";

import { ConfirmDialog } from "../ConfirmDialog";
import type { SubAgent, ToolPermission } from "../../types/routines";

interface SubAgentsTabProps {
  subAgents: SubAgent[];
  onChange: (subAgents: SubAgent[]) => void;
}

function formatToolPermission(permission: ToolPermission): string {
  return `${permission.tool}: ${permission.permission}${permission.pattern ? ` ${permission.pattern}` : ""}`;
}

export function SubAgentsTab({ subAgents, onChange }: SubAgentsTabProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SubAgent>>({});
  const [deleteTarget, setDeleteTarget] = useState<SubAgent | null>(null);

  const handleAdd = () => {
    const newAgent: SubAgent = {
      id: `agent_${Date.now()}`,
      name: "New Agent",
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
          Define custom sub-agents with specialized system prompts and behaviors
        </p>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm rounded border hover:bg-accent flex items-center gap-2"
        >
          <Plus size={14} />
          Add Sub-agent
        </button>
      </div>

      <div className="space-y-2">
        {subAgents.map((agent) => (
          <div key={agent.id} className="border rounded-lg p-3 bg-card">
            {editing === agent.id ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1">Name</label>
                  <input
                    type="text"
                    value={editForm.name ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="agent-name"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Description</label>
                  <input
                    type="text"
                    value={editForm.description ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="What does this agent do?"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Type</label>
                  <select
                    value={editForm.type ?? "general-purpose"}
                    onChange={(e) => setEditForm({ ...editForm, type: e.target.value as SubAgent["type"] })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                  >
                    <option value="general-purpose">General Purpose</option>
                    <option value="specialized">Specialized</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">System Prompt</label>
                  <textarea
                    value={editForm.systemPrompt ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, systemPrompt: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background font-mono"
                    rows={8}
                    placeholder="System prompt for this agent..."
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">工具权限字段</label>
                  <textarea
                    value={JSON.stringify(editForm.toolPermissions ?? [], null, 2)}
                    onChange={(e) => updateToolPermissions(e.target.value)}
                    className="w-full px-2 py-1 text-sm border rounded bg-background font-mono"
                    rows={4}
                    placeholder='[{"tool":"Bash","permission":"ask","pattern":"pnpm *","source":"project"}]'
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1"
                  >
                    <Save size={12} />
                    Save
                  </button>
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1 text-sm rounded border hover:bg-accent flex items-center gap-1"
                  >
                    <X size={12} />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Bot size={16} className="text-primary" />
                    <span className="text-sm font-medium">{agent.name}</span>
                    <span className="text-xs text-muted-foreground">({agent.type})</span>
                    {!agent.enabled && (
                      <span className="text-xs text-muted-foreground">(disabled)</span>
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
                    <div className="font-medium text-foreground">工具权限字段</div>
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
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agent.enabled}
                      onChange={() => handleToggle(agent.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                  <button
                    onClick={() => handleEdit(agent)}
                    className="p-1 hover:bg-accent rounded"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(agent)}
                    className="p-1 hover:bg-accent rounded text-red-600"
                    aria-label={`Delete sub-agent ${agent.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {subAgents.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No custom sub-agents defined
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Sub-agent"
        message={deleteTarget ? `Delete ${deleteTarget.name}? This cannot be undone.` : "Delete this sub-agent? This cannot be undone."}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
