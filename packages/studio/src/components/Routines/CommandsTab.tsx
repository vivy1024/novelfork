/**
 * Commands Tab - 自定义命令管理
 */

import { useState } from "react";
import { Plus, Trash2, Edit2, Save, X } from "lucide-react";

import { ConfirmDialog } from "../ConfirmDialog";
import type { Command } from "../../types/routines";

interface CommandsTabProps {
  commands: Command[];
  onChange: (commands: Command[]) => void;
}

export function CommandsTab({ commands, onChange }: CommandsTabProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Command>>({});
  const [deleteTarget, setDeleteTarget] = useState<Command | null>(null);

  const handleAdd = () => {
    const newCommand: Command = {
      id: `cmd_${Date.now()}`,
      name: "新命令",
      description: "",
      prompt: "",
      enabled: true,
    };
    setEditing(newCommand.id);
    setEditForm(newCommand);
    onChange([...commands, newCommand]);
  };

  const handleEdit = (cmd: Command) => {
    setEditing(cmd.id);
    setEditForm(cmd);
  };

  const handleSave = () => {
    if (!editing || !editForm.name?.trim()) return;

    onChange(
      commands.map((cmd) =>
        cmd.id === editing
          ? { ...cmd, ...editForm, name: editForm.name!.trim() }
          : cmd
      )
    );
    setEditing(null);
    setEditForm({});
  };

  const handleCancel = () => {
    if (editing && !commands.find((c) => c.id === editing)?.name) {
      onChange(commands.filter((c) => c.id !== editing));
    }
    setEditing(null);
    setEditForm({});
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    onChange(commands.filter((cmd) => cmd.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const handleToggle = (id: string) => {
    onChange(
      commands.map((cmd) =>
        cmd.id === id ? { ...cmd, enabled: !cmd.enabled } : cmd
      )
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          定义可通过斜杠语法调用的自定义命令
        </p>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm rounded border hover:bg-accent flex items-center gap-2"
        >
          <Plus size={14} />
          添加命令
        </button>
      </div>

      <div className="space-y-2">
        {commands.map((cmd) => (
          <div
            key={cmd.id}
            className="border rounded-lg p-3 bg-card"
          >
            {editing === cmd.id ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1">名称</label>
                  <input
                    type="text"
                    value={editForm.name ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="命令名称"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">描述</label>
                  <input
                    type="text"
                    value={editForm.description ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="这个命令做什么？"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">提示词</label>
                  <textarea
                    value={editForm.prompt ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, prompt: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background font-mono"
                    rows={4}
                    placeholder="给 AI 的执行说明..."
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1"
                  >
                    <Save size={12} />
                    保存
                  </button>
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1 text-sm rounded border hover:bg-accent flex items-center gap-1"
                  >
                    <X size={12} />
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-mono">/{cmd.name}</code>
                    {!cmd.enabled && (
                      <span className="text-xs text-muted-foreground">（已停用）</span>
                    )}
                  </div>
                  {cmd.description && (
                    <p className="text-xs text-muted-foreground">{cmd.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cmd.enabled}
                      onChange={() => handleToggle(cmd.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                  <button
                    onClick={() => handleEdit(cmd)}
                    className="p-1 hover:bg-accent rounded"
                    aria-label={`编辑命令 ${cmd.name}`}
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(cmd)}
                    className="p-1 hover:bg-accent rounded text-red-600"
                    aria-label={`删除命令 ${cmd.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {commands.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            还没有自定义命令
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除命令"
        message={deleteTarget ? `确定删除 /${deleteTarget.name}？此操作不可撤销。` : "确定删除这个命令？此操作不可撤销。"}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
