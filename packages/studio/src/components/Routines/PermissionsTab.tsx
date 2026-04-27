/**
 * Permissions Tab - 工具权限管理
 */

import { useState } from "react";
import { Plus, Trash2, Shield, AlertTriangle } from "lucide-react";

import { ConfirmDialog } from "../ConfirmDialog";
import type { ToolPermission, PermissionBehavior } from "../../types/routines";

interface PermissionsTabProps {
  permissions: ToolPermission[];
  onChange: (permissions: ToolPermission[]) => void;
}

const COMMON_TOOLS = [
  "Bash", "Read", "Write", "Edit", "Grep", "Glob",
  "WebFetch", "WebSearch", "TeamCreate", "TeamDelete",
  "EnterWorktree", "ExitWorktree", "TodoWrite"
];

function PermissionSummaryCard({ title, count, description }: { title: string; count: number; description: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function PermissionsTab({ permissions, onChange }: PermissionsTabProps) {
  const [newTool, setNewTool] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newPermission, setNewPermission] = useState<PermissionBehavior>("allow");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const handleAdd = () => {
    if (!newTool.trim()) return;

    const permission: ToolPermission = {
      tool: newTool.trim(),
      permission: newPermission,
      pattern: newPattern.trim() || undefined,
      source: "user",
    };

    onChange([...permissions, permission]);
    setNewTool("");
    setNewPattern("");
    setNewPermission("allow");
  };

  const handleDelete = () => {
    if (deleteTarget === null) return;
    onChange(permissions.filter((_, i) => i !== deleteTarget));
    setDeleteTarget(null);
  };

  const handleUpdate = (index: number, updates: Partial<ToolPermission>) => {
    onChange(
      permissions.map((perm, i) =>
        i === index ? { ...perm, ...updates } : perm
      )
    );
  };

  const getPermissionColor = (permission: PermissionBehavior) => {
    switch (permission) {
      case "allow": return "text-green-600";
      case "deny": return "text-red-600";
      case "ask": return "text-yellow-600";
    }
  };

  const getPermissionIcon = (permission: PermissionBehavior) => {
    switch (permission) {
      case "allow": return <Shield size={14} className="text-green-600" />;
      case "deny": return <AlertTriangle size={14} className="text-red-600" />;
      case "ask": return <Shield size={14} className="text-yellow-600" />;
    }
  };

  const bashRules = permissions.filter((perm) => perm.tool === "Bash" || perm.pattern?.toLowerCase().includes("bash"));
  const mcpRules = permissions.filter((perm) => perm.tool.startsWith("mcp__") || perm.tool.includes("__mcp"));
  const builtInRules = permissions.filter((perm) => !bashRules.includes(perm) && !mcpRules.includes(perm));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-3">
          Control which tools can be used automatically, require approval, or are blocked
        </p>
        <div className="text-xs text-muted-foreground space-y-1 mb-4">
          <p>• <strong>Allow</strong>: Tool executes automatically without prompts</p>
          <p>• <strong>Ask</strong>: Requires user approval before execution</p>
          <p>• <strong>Deny</strong>: Tool is blocked and cannot be used</p>
          <p>• Pattern supports wildcards: <code className="bg-muted px-1 rounded">git *</code> matches all git commands</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <PermissionSummaryCard title="Bash allowlist / blocklist" count={bashRules.length} description="按 pattern 管理 Bash 命令白名单、黑名单和询问规则" />
        <PermissionSummaryCard title="MCP 工具权限" count={mcpRules.length} description="统一查看 mcp__server__tool 规则来源和权限" />
        <PermissionSummaryCard title="内置工具权限" count={builtInRules.length} description="Read / Write / Edit / Browser 等工具默认行为" />
      </div>

      {/* Add New Permission */}
      <div className="border rounded-lg p-3 bg-card">
        <h3 className="text-sm font-medium mb-3">Add Permission Rule</h3>
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-4">
            <label className="text-xs font-medium block mb-1">Tool Name</label>
            <input
              type="text"
              list="common-tools"
              value={newTool}
              onChange={(e) => setNewTool(e.target.value)}
              className="w-full px-2 py-1 text-sm border rounded bg-background"
              placeholder="Bash, Read, Write..."
            />
            <datalist id="common-tools">
              {COMMON_TOOLS.map((tool) => (
                <option key={tool} value={tool} />
              ))}
            </datalist>
          </div>
          <div className="col-span-3">
            <label className="text-xs font-medium block mb-1">Pattern (optional)</label>
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              className="w-full px-2 py-1 text-sm border rounded bg-background font-mono"
              placeholder="git *, npm *"
            />
          </div>
          <div className="col-span-3">
            <label className="text-xs font-medium block mb-1">Permission</label>
            <select
              value={newPermission}
              onChange={(e) => setNewPermission(e.target.value as PermissionBehavior)}
              className="w-full px-2 py-1 text-sm border rounded bg-background"
            >
              <option value="allow">Allow</option>
              <option value="ask">Ask</option>
              <option value="deny">Deny</option>
            </select>
          </div>
          <div className="col-span-2 flex items-end">
            <button
              onClick={handleAdd}
              disabled={!newTool.trim()}
              className="w-full px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Permissions List */}
      <div className="space-y-2">
        {permissions.map((perm, index) => (
          <div
            key={index}
            className="border rounded-lg p-3 bg-card flex items-center gap-3"
          >
            <div className="flex-shrink-0">
              {getPermissionIcon(perm.permission)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <code className="text-sm font-mono">{perm.tool}</code>
                {perm.pattern && (
                  <code className="text-xs font-mono text-muted-foreground bg-muted px-1 rounded">
                    {perm.pattern}
                  </code>
                )}
                <span className={`text-xs font-medium ${getPermissionColor(perm.permission)}`}>
                  {perm.permission}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                来源：{perm.source}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={perm.permission}
                onChange={(e) => handleUpdate(index, { permission: e.target.value as PermissionBehavior })}
                className="px-2 py-1 text-xs border rounded bg-background"
              >
                <option value="allow">Allow</option>
                <option value="ask">Ask</option>
                <option value="deny">Deny</option>
              </select>
              <button
                onClick={() => setDeleteTarget(index)}
                className="p-1 hover:bg-accent rounded text-red-600"
                aria-label={`Delete permission rule for ${perm.tool}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        {permissions.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No permission rules defined. All tools will use default behavior.
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Permission Rule"
        message={deleteTarget !== null ? `Delete the permission rule for ${permissions[deleteTarget]?.tool ?? "this tool"}? This cannot be undone.` : "Delete this permission rule? This cannot be undone."}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
