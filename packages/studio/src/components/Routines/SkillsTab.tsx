/**
 * Skills Tab - 技能管理（全局/项目）
 */

import { useState } from "react";
import { Plus, Trash2, Edit2, Save, X, Globe, Folder } from "lucide-react";

import { ConfirmDialog } from "../ConfirmDialog";
import type { Skill } from "../../types/routines";

interface SkillsTabProps {
  globalSkills: Skill[];
  projectSkills: Skill[];
  onGlobalChange: (skills: Skill[]) => void;
  onProjectChange: (skills: Skill[]) => void;
}

export function SkillsTab({
  globalSkills,
  projectSkills,
  onGlobalChange,
  onProjectChange,
}: SkillsTabProps) {
  const [activeTab, setActiveTab] = useState<"global" | "project">("global");
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Skill>>({});
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);

  const skills = activeTab === "global" ? globalSkills : projectSkills;
  const onChange = activeTab === "global" ? onGlobalChange : onProjectChange;

  const handleAdd = () => {
    const newSkill: Skill = {
      id: `skill_${Date.now()}`,
      name: "New Skill",
      description: "",
      instructions: "",
      enabled: true,
    };
    setEditing(newSkill.id);
    setEditForm(newSkill);
    onChange([...skills, newSkill]);
  };

  const handleEdit = (skill: Skill) => {
    setEditing(skill.id);
    setEditForm(skill);
  };

  const handleSave = () => {
    if (!editing || !editForm.name?.trim()) return;

    onChange(
      skills.map((skill) =>
        skill.id === editing
          ? { ...skill, ...editForm, name: editForm.name!.trim() }
          : skill
      )
    );
    setEditing(null);
    setEditForm({});
  };

  const handleCancel = () => {
    if (editing && !skills.find((s) => s.id === editing)?.name) {
      onChange(skills.filter((s) => s.id !== editing));
    }
    setEditing(null);
    setEditForm({});
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    onChange(skills.filter((skill) => skill.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const handleToggle = (id: string) => {
    onChange(
      skills.map((skill) =>
        skill.id === id ? { ...skill, enabled: !skill.enabled } : skill
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
          <Globe size={14} />
          Global Skills ({globalSkills.length})
        </button>
        <button
          onClick={() => setActiveTab("project")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "project"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Folder size={14} />
          Project Skills ({projectSkills.length})
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {activeTab === "global"
            ? "Skills available across all projects"
            : "Skills specific to this project"}
        </p>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm rounded border hover:bg-accent flex items-center gap-2"
        >
          <Plus size={14} />
          Add Skill
        </button>
      </div>

      <div className="space-y-2">
        {skills.map((skill) => (
          <div key={skill.id} className="border rounded-lg p-3 bg-card">
            {editing === skill.id ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1">Name</label>
                  <input
                    type="text"
                    value={editForm.name ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="skill-name"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Description</label>
                  <input
                    type="text"
                    value={editForm.description ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background"
                    placeholder="What does this skill do?"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Instructions</label>
                  <textarea
                    value={editForm.instructions ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, instructions: e.target.value })}
                    className="w-full px-2 py-1 text-sm border rounded bg-background font-mono"
                    rows={6}
                    placeholder="Step-by-step instructions for this skill..."
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
                    <span className="text-sm font-medium">{skill.name}</span>
                    {!skill.enabled && (
                      <span className="text-xs text-muted-foreground">(disabled)</span>
                    )}
                  </div>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground mb-2">{skill.description}</p>
                  )}
                  {skill.instructions && (
                    <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto max-h-20">
                      {skill.instructions.slice(0, 200)}
                      {skill.instructions.length > 200 && "..."}
                    </pre>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={() => handleToggle(skill.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                  <button
                    onClick={() => handleEdit(skill)}
                    className="p-1 hover:bg-accent rounded"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(skill)}
                    className="p-1 hover:bg-accent rounded text-red-600"
                    aria-label={`Delete skill ${skill.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {skills.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No {activeTab} skills defined
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Skill"
        message={deleteTarget ? `Delete ${deleteTarget.name}? This cannot be undone.` : "Delete this skill? This cannot be undone."}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
