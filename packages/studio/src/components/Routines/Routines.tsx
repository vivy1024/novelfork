/**
 * Routines 套路系统主组件
 * 9 个标签页：Commands, Optional Tools, Tool Permissions, Global Skills, Project Skills,
 * Custom Sub-agents, Global Prompts, System Prompts, MCP Tools
 */

import { useEffect, useState } from "react";
import { CheckCircle, RotateCcw, Save } from "lucide-react";
import { CommandsTab } from "./CommandsTab";
import { PermissionsTab } from "./PermissionsTab";
import { SkillsTab } from "./SkillsTab";
import { ToolsTab } from "./ToolsTab";
import { SubAgentsTab } from "./SubAgentsTab";
import { PromptsTab } from "./PromptsTab";
import { MCPToolsTab } from "./MCPToolsTab";
import type { Routines as RoutinesConfig } from "../../types/routines";
import { DEFAULT_ROUTINES } from "../../types/routines";
import { useNovelFork } from "../../providers/novelfork-context";
import {
  fetchRoutines,
  resetRoutines,
  saveRoutines,
  type EditableRoutinesScope,
  type RoutinesScope,
} from "./routines-api";

interface RoutinesPanelProps {
  onBack?: () => void;
  projectRoot?: string;
  defaultScope?: RoutinesScope;
}

const TABS = [
  { id: "commands", label: "Commands" },
  { id: "tools", label: "Optional Tools" },
  { id: "permissions", label: "Tool Permissions" },
  { id: "skills", label: "Skills" },
  { id: "subagents", label: "Sub-agents" },
  { id: "prompts", label: "Prompts" },
  { id: "mcp", label: "MCP Tools" },
] as const;

const SCOPE_META: Record<RoutinesScope, { label: string; description: string }> = {
  merged: {
    label: "生效视图",
    description: "默认读取 merged 视图；项目配置覆盖全局配置，只读展示当前实际生效结果。",
  },
  global: {
    label: "全局",
    description: "编辑 ~/.inkos/routines.json，作为所有项目的默认基线。",
  },
  project: {
    label: "项目",
    description: "编辑 <workspace>/.inkos/routines.json，只影响当前工作区。",
  },
};

type TabId = typeof TABS[number]["id"];

function cloneDefaultRoutines(): RoutinesConfig {
  return {
    commands: [...DEFAULT_ROUTINES.commands],
    tools: [...DEFAULT_ROUTINES.tools],
    permissions: [...DEFAULT_ROUTINES.permissions],
    globalSkills: [...DEFAULT_ROUTINES.globalSkills],
    projectSkills: [...DEFAULT_ROUTINES.projectSkills],
    subAgents: [...DEFAULT_ROUTINES.subAgents],
    globalPrompts: [...DEFAULT_ROUTINES.globalPrompts],
    systemPrompts: [...DEFAULT_ROUTINES.systemPrompts],
    mcpTools: [...DEFAULT_ROUTINES.mcpTools],
  };
}

export function Routines({ onBack, projectRoot: projectRootProp, defaultScope }: RoutinesPanelProps) {
  const { workspace } = useNovelFork();
  const projectRoot = projectRootProp ?? workspace ?? undefined;
  const hasProjectScope = Boolean(projectRoot);
  const [activeTab, setActiveTab] = useState<TabId>("commands");
  const [viewScope, setViewScope] = useState<RoutinesScope>(defaultScope ?? (hasProjectScope ? "merged" : "global"));
  const [routines, setRoutines] = useState<RoutinesConfig>(cloneDefaultRoutines());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasProjectScope && viewScope !== "global") {
      setViewScope("global");
    }
  }, [hasProjectScope, viewScope]);

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentScope() {
      setLoading(true);
      setError(null);
      setSaved(false);
      try {
        const next = await fetchRoutines(viewScope, projectRoot);
        if (!cancelled) {
          setRoutines(next);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load routines");
          setRoutines(cloneDefaultRoutines());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCurrentScope();

    return () => {
      cancelled = true;
    };
  }, [projectRoot, viewScope]);

  const isReadOnly = viewScope === "merged";
  const scopeMeta = SCOPE_META[viewScope];

  const handleSave = async () => {
    if (isReadOnly) {
      return;
    }

    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveRoutines(viewScope as EditableRoutinesScope, routines, projectRoot);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save routines");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (isReadOnly) {
      return;
    }
    if (!confirm("Reset current routines scope to default values?")) return;

    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await resetRoutines(viewScope as EditableRoutinesScope, projectRoot);
      setRoutines(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Failed to reset routines");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col" data-testid="routine-panel">
      <div className="border-b p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            {onBack && (
              <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground mb-2">
                ← Back
              </button>
            )}
            <h1 className="text-2xl font-serif">Routines</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure commands, tools, permissions, skills, and prompts
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={saving || isReadOnly}
              className="px-3 py-2 text-sm rounded border hover:bg-accent disabled:opacity-50 flex items-center gap-2"
            >
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving || isReadOnly}
              className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {saved ? <CheckCircle size={14} /> : <Save size={14} />}
              {saving ? "Saving..." : saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid="routine-scope-summary">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setViewScope("merged")}
              disabled={!hasProjectScope}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                viewScope === "merged"
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-accent"
              } disabled:opacity-50`}
            >
              {SCOPE_META.merged.label}
            </button>
            <button
              type="button"
              onClick={() => setViewScope("global")}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                viewScope === "global"
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-accent"
              }`}
            >
              {SCOPE_META.global.label}
            </button>
            <button
              type="button"
              onClick={() => setViewScope("project")}
              disabled={!hasProjectScope}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                viewScope === "project"
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-accent"
              } disabled:opacity-50`}
            >
              {SCOPE_META.project.label}
            </button>
          </div>
          <p className="text-sm text-muted-foreground">{scopeMeta.description}</p>
          {!hasProjectScope && (
            <p className="text-xs text-muted-foreground">
              当前未检测到工作区，project / merged 视图不可用，已回退到全局口径。
            </p>
          )}
          {isReadOnly && hasProjectScope && (
            <p className="text-xs text-muted-foreground">
              生效视图仅用于查看最终结果；需要修改时请切换到全局或项目视图后保存。
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="border-b overflow-x-auto">
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4" data-testid="routine-list">
        <fieldset disabled={isReadOnly} className={isReadOnly ? "opacity-70" : undefined}>
          {activeTab === "commands" && (
            <CommandsTab
              commands={routines.commands}
              onChange={(commands) => setRoutines({ ...routines, commands })}
            />
          )}

          {activeTab === "tools" && (
            <ToolsTab
              tools={routines.tools}
              onChange={(tools) => setRoutines({ ...routines, tools })}
            />
          )}

          {activeTab === "permissions" && (
            <PermissionsTab
              permissions={routines.permissions}
              onChange={(permissions) => setRoutines({ ...routines, permissions })}
            />
          )}

          {activeTab === "skills" && (
            <SkillsTab
              globalSkills={routines.globalSkills}
              projectSkills={routines.projectSkills}
              onGlobalChange={(globalSkills) => setRoutines({ ...routines, globalSkills })}
              onProjectChange={(projectSkills) => setRoutines({ ...routines, projectSkills })}
            />
          )}

          {activeTab === "subagents" && (
            <SubAgentsTab
              subAgents={routines.subAgents}
              onChange={(subAgents) => setRoutines({ ...routines, subAgents })}
            />
          )}

          {activeTab === "prompts" && (
            <PromptsTab
              globalPrompts={routines.globalPrompts}
              systemPrompts={routines.systemPrompts}
              onGlobalChange={(globalPrompts) => setRoutines({ ...routines, globalPrompts })}
              onSystemChange={(systemPrompts) => setRoutines({ ...routines, systemPrompts })}
            />
          )}

          {activeTab === "mcp" && (
            <MCPToolsTab
              mcpTools={routines.mcpTools}
              onChange={(mcpTools) => setRoutines({ ...routines, mcpTools })}
            />
          )}
        </fieldset>
      </div>
    </div>
  );
}
