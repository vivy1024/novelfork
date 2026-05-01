import { useState } from "react";

import { CommandsTab } from "../../components/Routines/CommandsTab";
import { MCPToolsTab } from "../../components/Routines/MCPToolsTab";
import { PermissionsTab } from "../../components/Routines/PermissionsTab";
import { PromptsTab } from "../../components/Routines/PromptsTab";
import { SkillsTab } from "../../components/Routines/SkillsTab";
import { SubAgentsTab } from "../../components/Routines/SubAgentsTab";
import { ToolsTab } from "../../components/Routines/ToolsTab";
import { ROUTINES_SCOPE_META, useRoutinesEditor } from "../../components/Routines/use-routines-editor";
import { MCPServerPanel } from "./MCPServerPanel";
import type { RoutineHook, RoutineHookKind, Routines as RoutinesConfig } from "../../types/routines";
import { InlineError } from "../components/feedback";

interface RoutinesNextPageProps {
  readonly projectRoot?: string;
}

type RoutineSectionId =
  | "commands"
  | "tools"
  | "permissions"
  | "globalSkills"
  | "projectSkills"
  | "subAgents"
  | "globalPrompts"
  | "systemPrompts"
  | "mcpTools"
  | "hooks";

interface RoutineSectionDefinition {
  readonly id: RoutineSectionId;
  readonly label: string;
  readonly description: string;
  readonly reuse: string;
  readonly getCount: (routines: RoutinesConfig) => number;
  readonly status?: string;
}

const ROUTINE_SECTIONS: readonly RoutineSectionDefinition[] = [
  {
    id: "commands",
    label: "命令",
    description: "用户级斜杠命令、空态和添加命令入口。",
    reuse: "复用 CommandsTab / commands 数据",
    getCount: (routines) => routines.commands.length,
  },
  {
    id: "tools",
    label: "可选工具",
    description: "工具名称、说明、启用状态与 /LOAD 等价入口。",
    reuse: "复用 ToolsTab / tools 数据",
    getCount: (routines) => routines.tools.length,
  },
  {
    id: "permissions",
    label: "工具权限",
    description: "内置工具、MCP 工具权限、Bash 命令允许/拒绝规则来源。",
    reuse: "复用 PermissionsTab / permissions 数据",
    getCount: (routines) => routines.permissions.length,
  },
  {
    id: "globalSkills",
    label: "全局技能",
    description: "全局技能扫描、刷新和创建入口。",
    reuse: "拆分 SkillsTab globalSkills",
    getCount: (routines) => routines.globalSkills.length,
  },
  {
    id: "projectSkills",
    label: "项目技能",
    description: "当前项目技能列表和项目级创建入口。",
    reuse: "拆分 SkillsTab projectSkills",
    getCount: (routines) => routines.projectSkills.length,
  },
  {
    id: "subAgents",
    label: "自定义子代理",
    description: "专用提示词、类型、工具权限和创建入口。",
    reuse: "复用 SubAgentsTab / subAgents 数据",
    getCount: (routines) => routines.subAgents.length,
  },
  {
    id: "globalPrompts",
    label: "全局提示词",
    description: "全局提示词资产和编辑入口。",
    reuse: "拆分 PromptsTab globalPrompts",
    getCount: (routines) => routines.globalPrompts.length,
  },
  {
    id: "systemPrompts",
    label: "系统提示词",
    description: "系统提示词资产和编辑入口。",
    reuse: "拆分 PromptsTab systemPrompts",
    getCount: (routines) => routines.systemPrompts.length,
  },
  {
    id: "mcpTools",
    label: "MCP 工具",
    description: "服务器级管理入口：导入 JSON、添加服务器、连接状态、工具数量。",
    reuse: "迁移 MCPToolsTab 数据，后续升级服务器级管理",
    getCount: (routines) => routines.mcpTools.length,
  },
  {
    id: "hooks",
    label: "钩子",
    description: "Shell / Webhook / LLM 生命周期钩子入口。",
    reuse: "复用 Routines hooks 数据并直接编辑生命周期钩子",
    getCount: (routines) => routines.hooks.length,
  },
];

function readStoredProjectRoot(): string | undefined {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") return undefined;
  try {
    return window.localStorage.getItem("novelfork-workspace") ?? undefined;
  } catch {
    return undefined;
  }
}

export function RoutinesNextPage({ projectRoot: projectRootProp }: RoutinesNextPageProps) {
  const projectRoot = projectRootProp ?? readStoredProjectRoot();
  const [activeSectionId, setActiveSectionId] = useState<RoutineSectionId>("commands");
  const {
    error,
    handleReset,
    handleSave,
    hasProjectScope,
    isReadOnly,
    loading,
    routines,
    saved,
    saving,
    setRoutines,
    setViewScope,
    viewScope,
  } = useRoutinesEditor({ projectRoot });

  if (loading) {
    return <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">正在加载 Routines 配置…</div>;
  }

  return (
    <section aria-label="新套路页" className="space-y-3">
      {/* 标题行 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">套路</h2>
          <p className="text-sm text-muted-foreground">管理技能、命令和 MCP 工具。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={scopeButtonClass(viewScope === "merged")}
            disabled={!hasProjectScope}
            onClick={() => setViewScope("merged")}
            type="button"
          >
            {ROUTINES_SCOPE_META.merged.label}
          </button>
          <button className={scopeButtonClass(viewScope === "global")} onClick={() => setViewScope("global")} type="button">
            {ROUTINES_SCOPE_META.global.label}
          </button>
          <button
            className={scopeButtonClass(viewScope === "project")}
            disabled={!hasProjectScope}
            onClick={() => setViewScope("project")}
            type="button"
          >
            {ROUTINES_SCOPE_META.project.label}
          </button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            disabled={saving || isReadOnly}
            onClick={handleSave}
            type="button"
          >
            {saving ? "保存中…" : saved ? "已保存" : "保存"}
          </button>
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            disabled={saving || isReadOnly}
            onClick={handleReset}
            type="button"
          >
            重置
          </button>
        </div>
      </div>

      {error && <InlineError message={error} />}

      {/* 水平 tab */}
      <div role="tablist" aria-label="套路分区" className="flex flex-wrap gap-1 border-b border-border">
        {ROUTINE_SECTIONS.map((section) => {
          const isSelected = section.id === activeSectionId;
          return (
            <button
              key={section.id}
              role="tab"
              aria-selected={isSelected}
              className={`rounded-t-lg px-3 py-1.5 text-sm transition ${isSelected ? "border-b-2 border-primary text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setActiveSectionId(section.id)}
              type="button"
            >
              {section.label}
            </button>
          );
        })}
      </div>

      {/* tab 内容 */}
      <div role="tabpanel">
        <fieldset className={isReadOnly ? "opacity-70" : ""} disabled={isReadOnly}>
          <RoutineSectionEditor
            routines={routines}
            sectionId={activeSectionId}
            setRoutines={setRoutines}
          />
        </fieldset>
      </div>

      {isReadOnly && <p className="text-xs text-muted-foreground">只读视图，切换到全局或项目 scope 后可编辑。</p>}
    </section>
  );
}

function RoutineSectionEditor({
  routines,
  sectionId,
  setRoutines,
}: {
  readonly routines: RoutinesConfig;
  readonly sectionId: RoutineSectionId;
  readonly setRoutines: (routines: RoutinesConfig) => void;
}) {
  switch (sectionId) {
    case "commands":
      return <CommandsTab commands={routines.commands} onChange={(commands) => setRoutines({ ...routines, commands })} />;
    case "tools":
      return <ToolsTab tools={routines.tools} onChange={(tools) => setRoutines({ ...routines, tools })} />;
    case "permissions":
      return <PermissionsTab permissions={routines.permissions} onChange={(permissions) => setRoutines({ ...routines, permissions })} />;
    case "globalSkills":
    case "projectSkills": {
      const skillTab = sectionId === "globalSkills" ? "global" : "project";
      return (
        <SkillsTab
          globalSkills={routines.globalSkills}
          projectSkills={routines.projectSkills}
          defaultTab={skillTab}
          lockedTab={skillTab}
          onGlobalChange={(globalSkills) => setRoutines({ ...routines, globalSkills })}
          onProjectChange={(projectSkills) => setRoutines({ ...routines, projectSkills })}
        />
      );
    }
    case "subAgents":
      return <SubAgentsTab subAgents={routines.subAgents} onChange={(subAgents) => setRoutines({ ...routines, subAgents })} />;
    case "globalPrompts":
    case "systemPrompts": {
      const promptTab = sectionId === "globalPrompts" ? "global" : "system";
      return (
        <PromptsTab
          globalPrompts={routines.globalPrompts}
          systemPrompts={routines.systemPrompts}
          defaultTab={promptTab}
          lockedTab={promptTab}
          onGlobalChange={(globalPrompts) => setRoutines({ ...routines, globalPrompts })}
          onSystemChange={(systemPrompts) => setRoutines({ ...routines, systemPrompts })}
        />
      );
    }
    case "mcpTools":
      return (
        <div className="space-y-4">
          <MCPToolsTab mcpTools={routines.mcpTools} onChange={(mcpTools) => setRoutines({ ...routines, mcpTools })} />
          <MCPServerPanel />
        </div>
      );
    case "hooks":
      return <HooksTab hooks={routines.hooks} onChange={(hooks) => setRoutines({ ...routines, hooks })} />;
  }
}

const HOOK_KIND_LABELS: Record<RoutineHookKind, string> = {
  shell: "Shell",
  webhook: "Webhook",
  llm: "LLM 提示词",
};

const HOOK_EVENT_PRESETS = ["before-agent-run", "after-agent-run", "after-chapter-save", "after-audit", "on-error"];

function createHookDraft(): RoutineHook {
  return {
    id: `hook-${Date.now()}`,
    name: "新建钩子",
    event: "after-chapter-save",
    kind: "shell",
    target: "",
    enabled: true,
  };
}

function HooksTab({ hooks, onChange }: { readonly hooks: RoutineHook[]; readonly onChange: (hooks: RoutineHook[]) => void }) {
  const updateHook = (id: string, updates: Partial<RoutineHook>) => {
    onChange(hooks.map((hook) => (hook.id === id ? { ...hook, ...updates } : hook)));
  };

  const addHook = () => onChange([...hooks, createHookDraft()]);
  const removeHook = (id: string) => onChange(hooks.filter((hook) => hook.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/20 p-4">
        <div>
          <h4 className="font-semibold">生命周期钩子</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            为 Shell、Webhook 或 LLM 提示词配置真实生命周期触发点，保存后写入当前 Routines 作用域。
          </p>
        </div>
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={addHook} type="button">
          创建钩子
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <HookTypeCard title="Shell" description="在指定生命周期节点运行本地命令，继承当前权限模式。" />
        <HookTypeCard title="Webhook" description="向外部服务发送事件载荷，用于通知、同步或自动化。" />
        <HookTypeCard title="LLM 提示词" description="以当前上下文触发模型提示词，生成审查或整理结果。" />
      </div>

      {hooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">暂无生命周期钩子，点击“创建钩子”添加第一条。</div>
      ) : (
        <div className="space-y-3">
          {hooks.map((hook) => (
            <div key={hook.id} className="grid gap-3 rounded-xl border border-border bg-background p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="text-sm">
                钩子名称
                <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={hook.name} onChange={(event) => updateHook(hook.id, { name: event.target.value })} />
              </label>
              <label className="text-sm">
                触发节点
                <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" list="routine-hook-events" value={hook.event} onChange={(event) => updateHook(hook.id, { event: event.target.value })} />
              </label>
              <label className="text-sm">
                执行方式
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={hook.kind} onChange={(event) => updateHook(hook.id, { kind: event.target.value as RoutineHookKind })}>
                  {(Object.keys(HOOK_KIND_LABELS) as RoutineHookKind[]).map((kind) => <option key={kind} value={kind}>{HOOK_KIND_LABELS[kind]}</option>)}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted" type="button" onClick={() => updateHook(hook.id, { enabled: !hook.enabled })}>
                  {hook.enabled ? "停用" : "启用"}
                </button>
                <button className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10" type="button" onClick={() => removeHook(hook.id)}>
                  删除
                </button>
              </div>
              <label className="text-sm md:col-span-4">
                执行目标
                <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={hook.target} onChange={(event) => updateHook(hook.id, { target: event.target.value })} placeholder="命令、Webhook URL 或 LLM 提示词" />
              </label>
            </div>
          ))}
        </div>
      )}
      <datalist id="routine-hook-events">
        {HOOK_EVENT_PRESETS.map((event) => <option key={event} value={event} />)}
      </datalist>
    </div>
  );
}

function HookTypeCard({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="font-semibold">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function scopeButtonClass(active: boolean, base = "rounded-lg border border-border px-3 py-1.5 text-sm transition") {
  return `${base} ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;
}
