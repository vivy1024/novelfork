import { useState, useEffect, useCallback } from "react";
import { Lock, Wrench } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole =
  | "writer"
  | "planner"
  | "auditor"
  | "architect"
  | "explorer"
  | "hooks"
  | "chapter-hooks"
  | "outline"
  | "custom";

export interface ToolConfigBarProps {
  bookId: string;
  sessionId?: string;
  agentRole?: AgentRole;
}

interface ToolItem {
  id: string;
  label: string;
  /** 锁定工具不可切换 */
  locked?: boolean;
}

// ---------------------------------------------------------------------------
// 角色默认工具表
// ---------------------------------------------------------------------------

/** 所有角色都锁定的基础工具 */
const LOCKED_TOOLS: ToolItem[] = [
  { id: "jingwei.read", label: "经纬", locked: true },
  { id: "chapter.read", label: "章节", locked: true },
  { id: "cockpit.snapshot", label: "快照", locked: true },
];

/** 可选工具池 */
const OPTIONAL_TOOLS: ToolItem[] = [
  { id: "presets.get_rules", label: "预设" },
  { id: "beat.get_current", label: "节拍" },
  { id: "cockpit.list_open_hooks", label: "伏笔" },
  { id: "character.check_consistency", label: "角色一致性" },
  { id: "narrative.read_line", label: "叙事线" },
  { id: "presets.check_compliance", label: "合规检查" },
  { id: "hooks.manage", label: "钩子管理" },
];

/** 各角色默认启用的可选工具 ID */
const ROLE_DEFAULTS: Record<AgentRole, string[]> = {
  writer: ["presets.get_rules", "beat.get_current", "cockpit.list_open_hooks", "presets.check_compliance"],
  planner: ["beat.get_current", "cockpit.list_open_hooks", "narrative.read_line"],
  auditor: ["presets.check_compliance", "character.check_consistency", "cockpit.list_open_hooks"],
  architect: ["character.check_consistency", "narrative.read_line"],
  explorer: ["cockpit.list_open_hooks", "character.check_consistency", "narrative.read_line"],
  hooks: ["cockpit.list_open_hooks", "hooks.manage"],
  "chapter-hooks": ["cockpit.list_open_hooks", "hooks.manage", "beat.get_current"],
  outline: ["narrative.read_line", "beat.get_current", "cockpit.list_open_hooks"],
  custom: ["presets.get_rules", "beat.get_current", "cockpit.list_open_hooks"],
};

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function storageKey(sessionId: string): string {
  return `novelfork-tool-config-${sessionId}`;
}

function loadConfig(sessionId: string | undefined): Set<string> | null {
  if (!sessionId) return null;
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveConfig(sessionId: string | undefined, enabled: Set<string>): void {
  if (!sessionId) return;
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify([...enabled]));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ToolConfigBar({ bookId: _bookId, sessionId, agentRole = "writer" }: ToolConfigBarProps) {
  const defaults = ROLE_DEFAULTS[agentRole] ?? ROLE_DEFAULTS.writer;

  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => {
    const stored = loadConfig(sessionId);
    return stored ?? new Set(defaults);
  });

  // 当 sessionId 或 agentRole 变化时重新加载
  useEffect(() => {
    const stored = loadConfig(sessionId);
    setEnabledTools(stored ?? new Set(ROLE_DEFAULTS[agentRole] ?? ROLE_DEFAULTS.writer));
  }, [sessionId, agentRole]);

  // 持久化到 localStorage + 同步到后端 session toolPolicy
  useEffect(() => {
    saveConfig(sessionId, enabledTools);

    // Sync to backend: disabled tools go into deny list
    if (sessionId) {
      const allOptionalIds = OPTIONAL_TOOLS.map((t) => t.id);
      const deny = allOptionalIds.filter((id) => !enabledTools.has(id));
      void fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionConfig: { toolPolicy: { deny } } }),
      }).catch(() => { /* best-effort */ });
    }
  }, [sessionId, enabledTools]);

  const handleToggle = useCallback((toolId: string) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  }, []);

  return (
    <div
      data-testid="tool-config-bar"
      className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 text-[11px] overflow-x-auto"
    >
      {/* 锁定工具组 */}
      <span className="flex items-center gap-1 text-muted-foreground">
        <Wrench className="size-3" />
      </span>
      <span className="flex items-center gap-1">
        {LOCKED_TOOLS.map((tool) => (
          <span
            key={tool.id}
            className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-muted-foreground select-none"
            title={tool.id}
          >
            <Lock className="size-2.5" />
            {tool.label}
          </span>
        ))}
      </span>

      <span className="text-muted-foreground/50">|</span>

      {/* 可选工具组 */}
      <span className="flex items-center gap-1.5 flex-wrap">
        {OPTIONAL_TOOLS.map((tool) => {
          const checked = enabledTools.has(tool.id);
          return (
            <label
              key={tool.id}
              className="inline-flex cursor-pointer items-center gap-0.5 select-none rounded px-1 py-0.5 hover:bg-muted/60 transition-colors"
              title={tool.id}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => handleToggle(tool.id)}
                className="size-3 accent-primary"
              />
              <span className={checked ? "text-foreground" : "text-muted-foreground"}>
                {tool.label}
              </span>
            </label>
          );
        })}
      </span>
    </div>
  );
}
