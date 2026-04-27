import { useMemo, useState } from "react";

import { CommandsTab } from "../../components/Routines/CommandsTab";
import { MCPToolsTab } from "../../components/Routines/MCPToolsTab";
import { PermissionsTab } from "../../components/Routines/PermissionsTab";
import { PromptsTab } from "../../components/Routines/PromptsTab";
import { SkillsTab } from "../../components/Routines/SkillsTab";
import { SubAgentsTab } from "../../components/Routines/SubAgentsTab";
import { ToolsTab } from "../../components/Routines/ToolsTab";
import { ROUTINES_SCOPE_META, useRoutinesEditor } from "../../components/Routines/use-routines-editor";
import { MCPServerManager } from "../../pages/MCPServerManager";
import type { Routines as RoutinesConfig } from "../../types/routines";
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
    description: "内置工具、MCP 工具权限、Bash allowlist/blocklist 规则来源。",
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
    description: "全局 prompt 资产和编辑入口。",
    reuse: "拆分 PromptsTab globalPrompts",
    getCount: (routines) => routines.globalPrompts.length,
  },
  {
    id: "systemPrompts",
    label: "系统提示词",
    description: "系统 prompt 资产和编辑入口。",
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
    reuse: "旧 Routines 缺口，后续复用 Workbench hooks 能力",
    getCount: () => 0,
    status: "未接入",
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
    scopeMeta,
    setRoutines,
    setViewScope,
    viewScope,
  } = useRoutinesEditor({ projectRoot });

  const activeSection = ROUTINE_SECTIONS.find((section) => section.id === activeSectionId) ?? ROUTINE_SECTIONS[0];
  const totals = useMemo(() => {
    const editableCount = routines.commands.length
      + routines.tools.length
      + routines.permissions.length
      + routines.globalSkills.length
      + routines.projectSkills.length
      + routines.subAgents.length
      + routines.globalPrompts.length
      + routines.systemPrompts.length
      + routines.mcpTools.length;

    return {
      sections: ROUTINE_SECTIONS.length,
      editableCount,
      mcpServers: new Set(routines.mcpTools.map((tool) => tool.serverName)).size,
    };
  }, [routines]);

  if (loading) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">正在加载 Routines 配置…</div>;
  }

  return (
    <section aria-label="新套路页" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <h2 className="text-xl font-semibold">套路</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            global / project / merged 三种 scope 复用旧 Routines API；新布局固定 NarraFork 10 个专业分区。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="固定分区" value={`${totals.sections}`} description="NarraFork Routines 对标分区" />
        <MetricCard title="当前资产" value={`${totals.editableCount}`} description={scopeMeta.description} />
        <MetricCard title="MCP 服务器" value={`${totals.mcpServers}`} description="从旧 mcpTools 数据聚合" />
        <MetricCard title="当前 scope" value={scopeMeta.label} description={isReadOnly ? "只读生效视图" : "可编辑并保存"} />
      </div>

      {error && <InlineError message={error} />}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          disabled={saving || isReadOnly}
          onClick={handleSave}
          type="button"
        >
          {saving ? "保存中…" : saved ? "已保存" : "保存套路"}
        </button>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          disabled={saving || isReadOnly}
          onClick={handleReset}
          type="button"
        >
          重置当前 scope
        </button>
        <span className="text-sm text-muted-foreground">
          {isReadOnly ? "生效视图为只读；切换到全局或项目后才能保存。" : "保存会写回旧 /api/routines 读写链。"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label="套路分区" className="rounded-2xl border border-border bg-card p-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">分区导航</div>
          <div className="space-y-1">
            {ROUTINE_SECTIONS.map((section) => (
              <button
                key={section.id}
                aria-current={section.id === activeSectionId ? "page" : undefined}
                className={scopeButtonClass(section.id === activeSectionId, "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition")}
                onClick={() => setActiveSectionId(section.id)}
                type="button"
              >
                <span>{section.label}</span>
                <span className="text-xs opacity-80">{section.status ?? `${section.getCount(routines)} 项`}</span>
              </button>
            ))}
          </div>
        </nav>

        <article className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{activeSection.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{activeSection.description}</p>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{activeSection.reuse}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <MetricCard title="当前数量" value={`${activeSection.getCount(routines)}`} description={activeSection.status ?? "来自旧 routines 数据模型"} />
            <MetricCard title="数据 scope" value={scopeMeta.label} description={isReadOnly ? "只读预览" : "可编辑保存"} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" type="button">
              打开{activeSection.label}
            </button>
            {activeSection.id === "commands" && <span className="rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground">添加命令入口沿用旧表单逻辑</span>}
            {activeSection.id === "tools" && <span className="rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground">/LOAD 等价入口待接入</span>}
            {activeSection.id === "permissions" && <span className="rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground">Bash allowlist/blocklist 待细化</span>}
            {activeSection.id === "subAgents" && <span className="rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground">工具权限字段待补齐</span>}
            {activeSection.id === "mcpTools" && <span className="rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground">导入 JSON / 添加 MCP 服务器在后续任务升级</span>}
            {activeSection.id === "hooks" && <span className="rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground">钩子创建入口待接入</span>}
          </div>
          <fieldset className={`mt-5 rounded-xl border border-border bg-background p-3 ${isReadOnly ? "opacity-70" : ""}`} disabled={isReadOnly}>
            <RoutineSectionEditor
              routines={routines}
              sectionId={activeSection.id}
              setRoutines={setRoutines}
            />
          </fieldset>
        </article>
      </div>
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
          <MCPServerManager nav={{}} theme="light" t={(key: string) => key} />
        </div>
      );
    case "hooks":
      return <HooksSection />;
  }
}

function HooksSection() {
  const [draftOpen, setDraftOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold">生命周期节点</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              钩子分区固定承接 Shell / Webhook / LLM 提示词三类执行方式；后续接入真实 hooks API 时沿用此入口。
            </p>
          </div>
          <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setDraftOpen(true)} type="button">
            创建钩子
          </button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <HookTypeCard title="Shell" description="在指定生命周期节点运行本地命令，继承当前权限模式。" />
        <HookTypeCard title="Webhook" description="向外部服务发送事件载荷，用于通知、同步或自动化。" />
        <HookTypeCard title="LLM 提示词" description="以当前上下文触发模型提示词，生成审查或整理结果。" />
      </div>
      {draftOpen && (
        <div className="rounded-xl border border-dashed border-border bg-background p-4">
          <h4 className="font-semibold">新建钩子草稿</h4>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              生命周期节点
              <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" defaultValue="before_run">
                <option value="before_run">before_run</option>
                <option value="after_run">after_run</option>
                <option value="on_error">on_error</option>
              </select>
            </label>
            <label className="text-sm">
              类型
              <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" defaultValue="shell">
                <option value="shell">Shell</option>
                <option value="webhook">Webhook</option>
                <option value="llm">LLM 提示词</option>
              </select>
            </label>
          </div>
        </div>
      )}
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

function MetricCard({ title, value, description }: { readonly title: string; readonly value: string; readonly description: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function scopeButtonClass(active: boolean, base = "rounded-lg border border-border px-3 py-1.5 text-sm transition") {
  return `${base} ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;
}
