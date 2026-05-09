/**
 * Skills Tab - 技能管理（全局/项目）
 */

import { useEffect, useState } from "react";
import { Plus, Trash2, Edit2, Save, X, Globe, Folder } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "../ConfirmDialog";
import type { Skill } from "../../types/routines";

interface SkillsTabProps {
  globalSkills: Skill[];
  projectSkills: Skill[];
  onGlobalChange: (skills: Skill[]) => void;
  onProjectChange: (skills: Skill[]) => void;
  defaultTab?: "global" | "project";
  lockedTab?: "global" | "project";
}

export function SkillsTab({
  globalSkills,
  projectSkills,
  onGlobalChange,
  onProjectChange,
  defaultTab,
  lockedTab,
}: SkillsTabProps) {
  const [selectedTab, setSelectedTab] = useState<"global" | "project">(defaultTab ?? "global");
  const activeTab = lockedTab ?? selectedTab;

  useEffect(() => {
    if (defaultTab) {
      setSelectedTab(defaultTab);
    }
  }, [defaultTab]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Skill>>({});
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);

  const skills = activeTab === "global" ? globalSkills : projectSkills;
  const onChange = activeTab === "global" ? onGlobalChange : onProjectChange;

  const handleAdd = () => {
    const newSkill: Skill = {
      id: `skill_${Date.now()}`,
      name: "新技能",
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
      <div className="flex items-center gap-2 border-b">
        <button
          onClick={() => setSelectedTab("global")}
          disabled={lockedTab === "project"}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 disabled:opacity-50 ${
            activeTab === "global"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Globe size={14} />
          全局技能（{globalSkills.length}）
        </button>
        <button
          onClick={() => setSelectedTab("project")}
          disabled={lockedTab === "global"}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 disabled:opacity-50 ${
            activeTab === "project"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Folder size={14} />
          项目技能（{projectSkills.length}）
        </button>
      </div>

      {lockedTab && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          当前分区：{lockedTab === "global" ? "全局技能" : "项目技能"}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {activeTab === "global"
            ? "所有项目都可使用的技能"
            : "仅当前项目可使用的技能"}
        </p>
        <Button variant="outline" size="sm" onClick={handleAdd}>
          <Plus size={14} />
          添加技能
        </Button>
      </div>

      <div className="space-y-2">
        {skills.map((skill) => (
          <div key={skill.id} className="border rounded-lg p-3 bg-card">
            {editing === skill.id ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1">名称</label>
                  <Input
                    className="mt-1 w-full"
                    value={editForm.name ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="技能名称"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">描述</label>
                  <Input
                    className="mt-1 w-full"
                    value={editForm.description ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="这个技能做什么？"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">说明</label>
                  <Textarea
                    className="mt-1 w-full"
                    value={editForm.instructions ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, instructions: e.target.value })}
                    rows={6}
                    placeholder="这个技能的分步说明..."
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
                    <span className="text-sm font-medium">{skill.name}</span>
                    {!skill.enabled && (
                      <span className="text-xs text-muted-foreground">（已停用）</span>
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
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={() => handleToggle(skill.id)}
                  />
                  <Button variant="outline" size="sm" onClick={() => handleEdit(skill)} aria-label={`编辑技能 ${skill.name}`}>
                    <Edit2 size={14} />
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(skill)} aria-label={`删除技能 ${skill.name}`}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}

        {skills.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            还没有{activeTab === "global" ? "全局" : "项目"}技能
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除技能"
        message={deleteTarget ? `确定删除 ${deleteTarget.name}？此操作不可撤销。` : "确定删除这个技能？此操作不可撤销。"}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
