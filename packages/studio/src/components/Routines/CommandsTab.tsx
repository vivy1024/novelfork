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
      name: "New Command",
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
          Define custom commands that can be invoked with slash syntax
        </p>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm rounded border hover:bg-accent flex items-center gap-2"
        >
          <Plus size={14} />
          Add Command
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
                  <label className="text-xs font-medium block mb-1">Name</label>
                  <input
                    type="text"
                    value={editForm.name ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="command-name"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Description</label>
                  <input
                    type="text"
                    value={editForm.description ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="What does this command do?"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Prompt</label>
                  <textarea
                    value={editForm.prompt ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, prompt: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background font-mono"
                    rows={4}
                    placeholder="Instructions for the AI..."
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
                    <code className="text-sm font-mono">/{cmd.name}</code>
                    {!cmd.enabled && (
                      <span className="text-xs text-muted-foreground">(disabled)</span>
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
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(cmd)}
                    className="p-1 hover:bg-accent rounded text-red-600"
                    aria-label={`Delete command ${cmd.name}`}
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
            No custom commands defined
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Command"
        message={deleteTarget ? `Delete /${deleteTarget.name}? This cannot be undone.` : "Delete this command? This cannot be undone."}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
