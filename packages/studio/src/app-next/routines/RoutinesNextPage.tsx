import { useState, useEffect } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import { listRuntimeCommands, type RuntimeCommandDefinition, type RuntimeCommandSource, type RuntimeCommandStatus } from "@vivy1024/novelfork-core/registry/command-registry";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { CommandsTab } from "../../components/Routines/CommandsTab";
import { MCPToolsTab } from "../../components/Routines/MCPToolsTab";
import { PermissionsTab } from "../../components/Routines/PermissionsTab";
import { PromptsTab } from "../../components/Routines/PromptsTab";
import { SkillsTab } from "../../components/Routines/SkillsTab";
import { SubAgentsTab } from "../../components/Routines/SubAgentsTab";
import { ROUTINES_SCOPE_META, useRoutinesEditor } from "../../components/Routines/use-routines-editor";
import { MCPServerPanel } from "./MCPServerPanel";
import type { RoutineHook, RoutineHookKind, Routines as RoutinesConfig } from "../../types/routines";
import { InlineError } from "../components/feedback";
import { getPluginUISections } from "../plugin-ui/register-plugins";
import { getPluginSection } from "../plugin-ui/section-registry";

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
  const [activeSectionId, setActiveSectionId] = useState<string>("commands");
  const pluginSections = getPluginUISections("routines");
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
    <section aria-label="新套路页" className="flex h-full w-full flex-col min-h-0">
      {/* 标题行 — sticky */}
      <div className="shrink-0 border-b border-border bg-background px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">套路</h2>
            <p className="text-sm text-muted-foreground">管理技能、命令和 MCP 工具。</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={viewScope === "merged" ? "default" : "outline"}
              size="sm"
              disabled={!hasProjectScope}
              onClick={() => setViewScope("merged")}
            >
              {ROUTINES_SCOPE_META.merged.label}
            </Button>
            <Button
              variant={viewScope === "global" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewScope("global")}
            >
              {ROUTINES_SCOPE_META.global.label}
            </Button>
            <Button
              variant={viewScope === "project" ? "default" : "outline"}
              size="sm"
              disabled={!hasProjectScope}
              onClick={() => setViewScope("project")}
            >
              {ROUTINES_SCOPE_META.project.label}
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="outline"
              size="sm"
              disabled={saving || isReadOnly}
              onClick={handleSave}
            >
              {saving ? "保存中…" : saved ? "已保存" : "保存"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={saving || isReadOnly}
              onClick={handleReset}
            >
              重置
            </Button>
          </div>
        </div>

        {error && <InlineError message={error} />}

        {/* 水平 tab */}
        <div role="tablist" aria-label="套路分区" className="flex flex-wrap gap-1">
        {ROUTINE_SECTIONS.map((section) => {
          const isSelected = section.id === activeSectionId;
          return (
            <Button
              key={section.id}
              role="tab"
              variant="ghost"
              size="sm"
              aria-selected={isSelected}
              className={isSelected ? "border-b-2 border-primary text-primary font-medium" : "text-muted-foreground"}
              onClick={() => setActiveSectionId(section.id)}
              type="button"
            >
              {section.label}
            </Button>
          );
        })}
        {pluginSections.map((section) => {
          const isSelected = section.id === activeSectionId;
          return (
            <Button
              key={section.id}
              role="tab"
              variant="ghost"
              size="sm"
              aria-selected={isSelected}
              className={isSelected ? "border-b-2 border-primary text-primary font-medium" : "text-muted-foreground"}
              onClick={() => setActiveSectionId(section.id)}
              type="button"
            >
              {section.label}
            </Button>
          );
        })}
      </div>
      </div>

      {/* tab 内容 — 可滚动区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4" role="tabpanel">
        {pluginSections.some((s) => s.id === activeSectionId) ? (
          <PluginSectionRenderer sectionId={activeSectionId} />
        ) : (
          <>
            <fieldset className={isReadOnly ? "opacity-70" : ""} disabled={isReadOnly}>
              <RoutineSectionEditor
                routines={routines}
                sectionId={activeSectionId as RoutineSectionId}
                setRoutines={setRoutines}
              />
            </fieldset>
            {isReadOnly && <p className="mt-3 text-xs text-muted-foreground">只读视图，切换到全局或项目 scope 后可编辑。</p>}
          </>
        )}
      </div>
    </section>
  );
}

function PluginSectionRenderer({ sectionId }: { readonly sectionId: string }) {
  const sections = getPluginUISections("routines");
  const section = sections.find((s) => s.id === sectionId);
  const [books, setBooks] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | undefined>(undefined);

  const requiresBook = section?.requiresBook ?? false;

  useEffect(() => {
    if (!requiresBook) return;
    let cancelled = false;
    void fetch("/api/books")
      .then((r) => (r.ok ? r.json() : { books: [] }))
      .then((data) => {
        if (cancelled) return;
        const list: Array<{ id: string; title: string }> = (data.books ?? []).map((b: { id: string; title?: string }) => ({ id: b.id, title: b.title ?? b.id }));
        setBooks(list);
        if (list.length > 0) setSelectedBookId((prev) => prev ?? list[0]!.id);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [requiresBook]);

  if (!section) {
    return <p className="text-sm text-muted-foreground">未找到该插件分区。</p>;
  }

  const Component = getPluginSection(section.componentKey);
  if (!Component) {
    return <p className="text-sm text-muted-foreground">插件组件未注册：{section.componentKey}</p>;
  }

  if (requiresBook) {
    if (books.length === 0) {
      return <p className="text-sm text-muted-foreground">暂无作品。请先在「作品管理」创建作品后再配置。</p>;
    }
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">作品：</span>
          <SimpleSelect
            value={selectedBookId ?? ""}
            onValueChange={(v) => setSelectedBookId(v)}
            options={books.map((b) => ({ value: b.id, label: b.title }))}
            className="w-56"
            aria-label="选择作品"
          />
        </div>
        {selectedBookId && <Component bookId={selectedBookId} />}
      </div>
    );
  }

  return <Component />;
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
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-amber-50 dark:bg-amber-950/20 p-4">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">自定义命令功能暂未开放</p>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">根据用户反馈决定是否开放自定义斜杠命令。如有需求请在 GitHub Issues 中反馈。</p>
          </div>
          <RuntimeCommandRegistryPanel
            commands={listRuntimeCommands()}
            disabledCommands={routines.disabledCommands}
            onToggleCommand={(commandId) => {
              const disabled = routines.disabledCommands.includes(commandId)
                ? routines.disabledCommands.filter((id) => id !== commandId)
                : [...routines.disabledCommands, commandId];
              setRoutines({ ...routines, disabledCommands: disabled });
            }}
          />
          <CommandsTab commands={routines.commands} onChange={(commands) => setRoutines({ ...routines, commands })} />
        </div>
      );
    case "permissions":
      return <PermissionsTab permissions={routines.permissions} onChange={(permissions) => setRoutines({ ...routines, permissions })} />;
    case "globalSkills":
    case "projectSkills": {
      const skillTab = sectionId === "globalSkills" ? "global" : "project";
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-blue-50 dark:bg-blue-950/20 p-4">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              {sectionId === "globalSkills" ? "全局技能" : "项目技能"}
            </p>
            <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
              {sectionId === "globalSkills"
                ? "技能是可复用的指令片段。启用后以 [技能:名称] 形式注入到 system prompt，指导 agent 的行为。对所有项目生效。"
                : "项目技能仅在当前项目内生效，适合存放项目专属的指令规范。"}
            </p>
          </div>
          <SkillsTab
          globalSkills={routines.globalSkills}
          projectSkills={routines.projectSkills}
          defaultTab={skillTab}
          lockedTab={skillTab}
          onGlobalChange={(globalSkills) => setRoutines({ ...routines, globalSkills })}
          onProjectChange={(projectSkills) => setRoutines({ ...routines, projectSkills })}
        />
        </div>
      );
    }
    case "subAgents":
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-amber-50 dark:bg-amber-950/20 p-4">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">自定义子代理功能暂未开放</p>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">NovelFork 的写作管线（规划→编排→写作→审计→修订）使用内置 Agent 类型。如需自定义子代理请在 GitHub Issues 中反馈。</p>
          </div>
          <SubAgentsTab subAgents={routines.subAgents} onChange={(subAgents) => setRoutines({ ...routines, subAgents })} />
        </div>
      );
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
          <div className="rounded-lg border border-border bg-amber-50 dark:bg-amber-950/20 p-4">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">MCP 工具集成暂未开放</p>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Model Context Protocol 工具服务器集成功能根据用户反馈决定是否开放。如有需求请在 GitHub Issues 中反馈。</p>
          </div>
          <MCPToolsTab mcpTools={routines.mcpTools} onChange={(mcpTools) => setRoutines({ ...routines, mcpTools })} />
          <MCPServerPanel />
        </div>
      );
    case "hooks":
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-amber-50 dark:bg-amber-950/20 p-4">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">生命周期钩子暂未开放</p>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Shell / Webhook / LLM 生命周期钩子功能根据用户反馈决定是否开放。如有需求请在 GitHub Issues 中反馈。</p>
          </div>
          <HooksTab hooks={routines.hooks} onChange={(hooks) => setRoutines({ ...routines, hooks })} />
        </div>
      );
  }
}

const COMMAND_STATUS_LABELS: Record<RuntimeCommandStatus, string> = {
  current: "当前可用",
  partial: "部分接入",
  planned: "计划中",
  unsupported: "不支持",
  "reference-only": "仅参考",
};

const COMMAND_SOURCE_LABELS: Record<RuntimeCommandSource, string> = {
  builtin: "内置",
  "claude-adapter": "Claude Adapter",
  "codex-adapter": "Codex Adapter",
  "novel-agent-pack": "Novel Agent Pack",
};

function RuntimeCommandRegistryPanel({ commands, disabledCommands, onToggleCommand }: {
  readonly commands: readonly RuntimeCommandDefinition[];
  readonly disabledCommands: readonly string[];
  readonly onToggleCommand?: (commandId: string) => void;
}) {
  // 只显示可用命令（current/partial），隐藏 planned/unsupported
  const availableCommands = commands.filter((cmd) => cmd.status === "current" || cmd.status === "partial");
  const plannedCount = commands.length - availableCommands.length;

  return (
    <section className="rounded-xl border border-border bg-muted/20 p-4" aria-label="可用命令">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">可用命令</h4>
          <p className="mt-1 text-sm text-muted-foreground">在对话中输入 / 触发。禁用后命令不可执行。</p>
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{availableCommands.length} 个可用{plannedCount > 0 ? ` · ${plannedCount} 个计划中` : ""}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {availableCommands.map((command) => {
          const isDisabled = disabledCommands.includes(command.id);
          return (
            <article key={command.id} className={`rounded-lg border border-border bg-background p-3 ${isDisabled ? "opacity-50" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-sm font-mono">{command.id}</code>
                {command.status === "partial" && <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">部分可用</span>}
                {isDisabled && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-900 dark:text-red-200">已禁用</span>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{command.description}</p>
              {onToggleCommand && (
                <Button
                  variant="outline"
                  size="xs"
                  className="mt-2"
                  onClick={() => onToggleCommand(command.id)}
                >
                  {isDisabled ? "启用" : "禁用"}
                </Button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = hooks.findIndex((h) => h.id === active.id);
      const newIndex = hooks.findIndex((h) => h.id === over.id);
      onChange(arrayMove(hooks, oldIndex, newIndex));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/20 p-4">
        <div>
          <h4 className="font-semibold">生命周期钩子</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            为 Shell、Webhook 或 LLM 提示词配置真实生命周期触发点，保存后写入当前 Routines 作用域。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={addHook}>
          创建钩子
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <HookTypeCard title="Shell" description="在指定生命周期节点运行本地命令，继承当前权限模式。" />
        <HookTypeCard title="Webhook" description="向外部服务发送事件载荷，用于通知、同步或自动化。" />
        <HookTypeCard title="LLM 提示词" description="以当前上下文触发模型提示词，生成审查或整理结果。" />
      </div>

      {hooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">暂无生命周期钩子，点击"创建钩子"添加第一条。</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={hooks.map((h) => h.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {hooks.map((hook) => (
                <SortableHookItem key={hook.id} hook={hook} onUpdate={updateHook} onRemove={removeHook} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <datalist id="routine-hook-events">
        {HOOK_EVENT_PRESETS.map((event) => <option key={event} value={event} />)}
      </datalist>
    </div>
  );
}

function SortableHookItem({ hook, onUpdate, onRemove }: { hook: RoutineHook; onUpdate: (id: string, updates: Partial<RoutineHook>) => void; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: hook.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="grid gap-3 rounded-xl border border-border bg-background p-4 md:grid-cols-[auto_1fr_1fr_1fr_auto]">
      <div className="flex items-center cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVertical className="size-4 text-muted-foreground" />
      </div>
      <label className="text-sm">
        钩子名称
        <Input className="mt-1 w-full" value={hook.name} onChange={(event) => onUpdate(hook.id, { name: event.target.value })} />
      </label>
      <label className="text-sm">
        触发节点
        <Input className="mt-1 w-full" list="routine-hook-events" value={hook.event} onChange={(event) => onUpdate(hook.id, { event: event.target.value })} />
      </label>
      <label className="text-sm">
        执行方式
        <SimpleSelect
          className="mt-1"
          value={hook.kind}
          onValueChange={(v) => onUpdate(hook.id, { kind: v as RoutineHookKind })}
          options={(Object.keys(HOOK_KIND_LABELS) as RoutineHookKind[]).map((kind) => ({ value: kind, label: HOOK_KIND_LABELS[kind] }))}
        />
      </label>
      <div className="flex items-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onUpdate(hook.id, { enabled: !hook.enabled })}>
          {hook.enabled ? "停用" : "启用"}
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onRemove(hook.id)}>
          删除
        </Button>
      </div>
      <label className="text-sm md:col-span-5">
        执行目标
        <Input className="mt-1 w-full" value={hook.target} onChange={(event) => onUpdate(hook.id, { target: event.target.value })} placeholder="命令、Webhook URL 或 LLM 提示词" />
      </label>
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

