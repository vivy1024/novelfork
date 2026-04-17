/**
 * Routines 套路系统主组件
 * 9 个标签页：Commands, Optional Tools, Tool Permissions, Global Skills, Project Skills,
 * Custom Sub-agents, Global Prompts, System Prompts, MCP Tools
 */

import { useState, useEffect } from "react";
import { Save, RotateCcw, CheckCircle } from "lucide-react";
import { CommandsTab } from "./CommandsTab";
import { PermissionsTab } from "./PermissionsTab";
import { SkillsTab } from "./SkillsTab";
import { ToolsTab } from "./ToolsTab";
import { SubAgentsTab } from "./SubAgentsTab";
import { PromptsTab } from "./PromptsTab";
import { MCPToolsTab } from "./MCPToolsTab";
import type { Routines } from "../../types/routines";
import { DEFAULT_ROUTINES } from "../../types/routines";

interface RoutinesPanelProps {
  onBack?: () => void;
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

type TabId = typeof TABS[number]["id"];

export function Routines({ onBack }: RoutinesPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("commands");
  const [routines, setRoutines] = useState<Routines>(DEFAULT_ROUTINES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadRoutines();
  }, []);

  const loadRoutines = async () => {
    try {
      // 从 IndexedDB 加载配置
      const db = await openDB();
      const stored = await getFromDB(db, "routines");
      if (stored) {
        setRoutines(stored);
      }
    } catch (error) {
      console.error("Failed to load routines:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const db = await openDB();
      await saveToDB(db, "routines", routines);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save routines");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset all routines to default values?")) return;
    setRoutines(DEFAULT_ROUTINES);
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
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
              className="px-3 py-2 text-sm rounded border hover:bg-accent flex items-center gap-2"
            >
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {saved ? <CheckCircle size={14} /> : <Save size={14} />}
              {saving ? "Saving..." : saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
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
      </div>
    </div>
  );
}

// IndexedDB helpers
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("inkos-routines", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config");
      }
    };
  });
}

function getFromDB(db: IDBDatabase, key: string): Promise<Routines | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("config", "readonly");
    const store = tx.objectStore("config");
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ?? null);
  });
}

function saveToDB(db: IDBDatabase, key: string, value: Routines): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("config", "readwrite");
    const store = tx.objectStore("config");
    const request = store.put(value, key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
