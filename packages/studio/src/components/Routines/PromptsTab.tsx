/**
 * Prompts Tab - 全局/系统提示词管理
 */

import { useEffect, useState } from "react";
import { Plus, Trash2, Edit2, Save, X, FileText, Settings } from "lucide-react";

import { ConfirmDialog } from "../ConfirmDialog";
import type { Prompt } from "../../types/routines";

interface PromptsTabProps {
  globalPrompts: Prompt[];
  systemPrompts: Prompt[];
  onGlobalChange: (prompts: Prompt[]) => void;
  onSystemChange: (prompts: Prompt[]) => void;
  defaultTab?: "global" | "system";
  lockedTab?: "global" | "system";
}

export function PromptsTab({
  globalPrompts,
  systemPrompts,
  onGlobalChange,
  onSystemChange,
  defaultTab,
  lockedTab,
}: PromptsTabProps) {
  const [selectedTab, setSelectedTab] = useState<"global" | "system">(defaultTab ?? "global");
  const activeTab = lockedTab ?? selectedTab;

  useEffect(() => {
    if (defaultTab) {
      setSelectedTab(defaultTab);
    }
  }, [defaultTab]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Prompt>>({});
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null);

  const prompts = activeTab === "global" ? globalPrompts : systemPrompts;
  const onChange = activeTab === "global" ? onGlobalChange : onSystemChange;

  const handleAdd = () => {
    const newPrompt: Prompt = {
      id: `prompt_${Date.now()}`,
      name: "新提示词",
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

  const handleDelete = () => {
    if (!deleteTarget) return;
    onChange(prompts.filter((prompt) => prompt.id !== deleteTarget.id));
    setDeleteTarget(null);
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
      <div className="flex items-center gap-2 border-b">
        <button
          onClick={() => setSelectedTab("global")}
          disabled={lockedTab === "system"}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 disabled:opacity-50 ${
            activeTab === "global"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText size={14} />
          全局提示词（{globalPrompts.length}）
        </button>
        <button
          onClick={() => setSelectedTab("system")}
          disabled={lockedTab === "global"}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 disabled:opacity-50 ${
            activeTab === "system"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings size={14} />
          系统提示词（{systemPrompts.length}）
        </button>
      </div>

      {lockedTab && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          当前分区：{lockedTab === "global" ? "全局提示词" : "系统提示词"}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {activeTab === "global"
            ? "注入到所有会话的提示词"
            : "定义 AI 行为边界的系统级提示词"}
        </p>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm rounded border hover:bg-accent flex items-center gap-2"
        >
          <Plus size={14} />
          添加提示词
        </button>
      </div>

      <div className="space-y-2">
        {prompts.map((prompt) => (
          <div key={prompt.id} className="border rounded-lg p-3 bg-card">
            {editing === prompt.id ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1">名称</label>
                  <input
                    type="text"
                    value={editForm.name ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="提示词名称"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">内容</label>
                  <textarea
                    value={editForm.content ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background font-mono"
                    rows={10}
                    placeholder="提示词内容..."
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
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium">{prompt.name}</span>
                    {!prompt.enabled && (
                      <span className="text-xs text-muted-foreground">（已停用）</span>
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
                    aria-label={`编辑提示词 ${prompt.name}`}
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(prompt)}
                    className="p-1 hover:bg-accent rounded text-red-600"
                    aria-label={`删除提示词 ${prompt.name}`}
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
            还没有{activeTab === "global" ? "全局" : "系统"}提示词
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除提示词"
        message={deleteTarget ? `确定删除 ${deleteTarget.name}？此操作不可撤销。` : "确定删除这个提示词？此操作不可撤销。"}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
