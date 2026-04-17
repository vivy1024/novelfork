/**
 * Prompts Tab - 全局/系统提示词管理
 */

import { useState } from "react";
import { Plus, Trash2, Edit2, Save, X, FileText, Settings } from "lucide-react";
import type { Prompt } from "../../types/routines";

interface PromptsTabProps {
  globalPrompts: Prompt[];
  systemPrompts: Prompt[];
  onGlobalChange: (prompts: Prompt[]) => void;
  onSystemChange: (prompts: Prompt[]) => void;
}

export function PromptsTab({
  globalPrompts,
  systemPrompts,
  onGlobalChange,
  onSystemChange,
}: PromptsTabProps) {
  const [activeTab, setActiveTab] = useState<"global" | "system">("global");
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Prompt>>({});

  const prompts = activeTab === "global" ? globalPrompts : systemPrompts;
  const onChange = activeTab === "global" ? onGlobalChange : onSystemChange;

  const handleAdd = () => {
    const newPrompt: Prompt = {
      id: `prompt_${Date.now()}`,
      name: "New Prompt",
      content: "",
      enabled: true,
    };
    setEditing(newPrompt.id);
    setEditForm(newPrompt);
    onChange([...prompts, newPrompt]);
  };

  const handleEdit = (prompt: Prompt) => {
    setEditing(prompt.id);
    setEditForm(prompt);
  };

  const handleSave = () => {
    if (!editing || !editForm.name?.trim()) return;

    onChange(
      prompts.map((prompt) =>
        prompt.id === editing
          ? { ...prompt, ...editForm, name: editForm.name!.trim() }
          : prompt
      )
    );
    setEditing(null);
    setEditForm({});
  };

  const handleCancel = () => {
    if (editing && !prompts.find((p) => p.id === editing)?.name) {
      onChange(prompts.filter((p) => p.id !== editing));
    }
    setEditing(null);
    setEditForm({});
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this prompt?")) return;
    onChange(prompts.filter((prompt) => prompt.id !== id));
  };

  const handleToggle = (id: string) => {
    onChange(
      prompts.map((prompt) =>
        prompt.id === id ? { ...prompt, enabled: !prompt.enabled } : prompt
      )
    );
  };

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b">
        <button
          onClick={() => setActiveTab("global")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "global"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText size={14} />
          Global Prompts ({globalPrompts.length})
        </button>
        <button
          onClick={() => setActiveTab("system")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "system"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings size={14} />
          System Prompts ({systemPrompts.length})
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {activeTab === "global"
            ? "Prompts injected into all conversations"
            : "System-level prompts that define AI behavior"}
        </p>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm rounded border hover:bg-accent flex items-center gap-2"
        >
          <Plus size={14} />
          Add Prompt
        </button>
      </div>

      <div className="space-y-2">
        {prompts.map((prompt) => (
          <div key={prompt.id} className="border rounded-lg p-3 bg-card">
            {editing === prompt.id ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1">Name</label>
                  <input
                    type="text"
                    value={editForm.name ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="prompt-name"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Content</label>
                  <textarea
                    value={editForm.content ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background font-mono"
                    rows={10}
                    placeholder="Prompt content..."
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
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium">{prompt.name}</span>
                    {!prompt.enabled && (
                      <span className="text-xs text-muted-foreground">(disabled)</span>
                    )}
                  </div>
                  {prompt.content && (
                    <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto max-h-32">
                      {prompt.content.slice(0, 300)}
                      {prompt.content.length > 300 && "..."}
                    </pre>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prompt.enabled}
                      onChange={() => handleToggle(prompt.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                  <button
                    onClick={() => handleEdit(prompt)}
                    className="p-1 hover:bg-accent rounded"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(prompt.id)}
                    className="p-1 hover:bg-accent rounded text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {prompts.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No {activeTab} prompts defined
          </div>
        )}
      </div>
    </div>
  );
}
