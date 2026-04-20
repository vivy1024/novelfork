import type { ReactNode } from "react";

import {
  Anchor,
  Bell,
  Bot,
  Boxes,
  CheckCircle,
  FileText,
  Puzzle,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Workflow,
} from "lucide-react";

import { PermissionsTab } from "@/components/Routines/PermissionsTab";
import { PromptsTab } from "@/components/Routines/PromptsTab";
import { SubAgentsTab } from "@/components/Routines/SubAgentsTab";
import { ROUTINES_SCOPE_META, useRoutinesEditor } from "@/components/Routines/use-routines-editor";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNovelFork } from "../providers/novelfork-context";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { WorkflowSection } from "../routes";
import { AgentPanel } from "./AgentPanel";
import { ConfigView } from "./ConfigView";
import { DetectionConfigView } from "./DetectionConfigView";
import { HookDashboard } from "./HookDashboard";
import { LLMAdvancedConfig } from "./LLMAdvancedConfig";
import { MCPServerManager } from "./MCPServerManager";
import { NotifyConfig } from "./NotifyConfig";
import { PluginManager } from "./PluginManager";
import { SchedulerConfig } from "./SchedulerConfig";

interface Nav {
  toDashboard: () => void;
  toBook: (bookId: string) => void;
  toWorkflow?: () => void;
}

const WORKFLOW_TABS = [
  {
    value: "project",
    label: "项目与模型",
    icon: Boxes,
    summary: "项目基础配置、默认模型、Prompt 基线",
    badge: "基础",
    scope: "混合",
    scopeDescription: "同时包含项目级默认值与全局模型路由配置。",
    saveStrategy: "混合保存",
    saveDescription: "部分字段即时生效，部分字段沿用各子面板自己的保存动作。",
  },
  {
    value: "agents",
    label: "Agent",
    icon: Bot,
    summary: "16 个写作 Agent、Tool Permissions、Sub-agents",
    badge: "核心",
    scope: "混合",
    scopeDescription: "Agent 路由默认影响整套写作管线；下方 Tool Permissions / Sub-agents 仍可按 routines 的 global / project 口径覆盖。",
    saveStrategy: "面板内保存",
    saveDescription: "Agent 路由在主面板保存，执行权限与子代理在下方 routines 区块按 global / project 保存。",
  },
  {
    value: "mcp",
    label: "MCP 工具",
    icon: Server,
    summary: "本地/远程 MCP Server 与工具接入",
    badge: "工具",
    scope: "全局级",
    scopeDescription: "工具接入属于工作台基础设施，默认对所有会话共享。",
    saveStrategy: "即时同步",
    saveDescription: "连接状态与启停结果即时反馈，配置仍由子面板确认。",
  },
  {
    value: "plugins",
    label: "插件",
    icon: Puzzle,
    summary: "插件开关、状态与配置入口",
    badge: "扩展",
    scope: "全局级",
    scopeDescription: "插件能力面向整个 Studio 工作台提供，不按单书拆分。",
    saveStrategy: "面板内保存",
    saveDescription: "插件启停和细项配置在各自卡片内保存，便于追踪变更。",
  },
  {
    value: "advanced",
    label: "高级 LLM",
    icon: SlidersHorizontal,
    summary: "thinking budget、headers、extra 参数",
    badge: "模型",
    scope: "全局级",
    scopeDescription: "高级模型参数会影响所有 AI 调用的默认行为。",
    saveStrategy: "即时同步",
    saveDescription: "参数修改后立即反映到后续请求，当前任务无需离开工作台。",
  },
  {
    value: "scheduler",
    label: "调度",
    icon: Workflow,
    summary: "守护进程写作节奏与质量门控",
    badge: "自动化",
    scope: "项目级",
    scopeDescription: "调度节奏与质量门控通常按项目/书籍分别管理。",
    saveStrategy: "面板内保存",
    saveDescription: "建议逐项确认后再保存，避免守护进程立刻切换节奏。",
  },
  {
    value: "detection",
    label: "AIGC 检测",
    icon: ShieldCheck,
    summary: "检测提供商、阈值与自动改写策略",
    badge: "审计",
    scope: "项目级",
    scopeDescription: "不同书籍可按题材和风险要求设不同检测阈值。",
    saveStrategy: "面板内保存",
    saveDescription: "检测阈值和改写策略集中在当前项目上下文中提交。",
  },
  {
    value: "hooks",
    label: "伏笔健康",
    icon: Sparkles,
    summary: "伏笔生命周期、陈旧度与回收率",
    badge: "审计",
    scope: "项目级",
    scopeDescription: "伏笔生命周期依附具体书籍，不适合作为全局默认值。",
    saveStrategy: "即时刷新",
    saveDescription: "切换区块后立即刷新当前书籍快照，保存策略沿用数据面板。",
  },
  {
    value: "notify",
    label: "通知",
    icon: Bell,
    summary: "Telegram / 飞书 / 企业微信 / Webhook",
    badge: "联动",
    scope: "全局级",
    scopeDescription: "通知渠道是工作台级能力，可被多个任务复用。",
    saveStrategy: "面板内保存",
    saveDescription: "渠道配置集中保存，避免半配置状态影响运行中的任务。",
  },
] as const;

type RoutinesResourceSection = "prompts" | "permissions" | "subagents";

export function WorkflowWorkbench({
  nav,
  theme,
  t,
  section,
  onNavigateSection,
}: {
  nav: Nav;
  theme: Theme;
  t: TFunction;
  section?: WorkflowSection;
  onNavigateSection?: (section: WorkflowSection) => void;
}) {
  const { workspace } = useNovelFork();
  const currentSection = section ?? "project";
  const currentTab = WORKFLOW_TABS.find((tab) => tab.value === currentSection) ?? WORKFLOW_TABS[0]!;
  const routinesDescription = workspace
    ? "默认读取 merged 视图；当前工作区的 .inkos/routines.json 会覆盖全局 ~/.inkos/routines.json。需要修改 Prompt / Tool Permissions / Sub-agents 时，切到 global / project 视图保存。"
    : "当前没有工作区上下文时，Routines 只读取全局 ~/.inkos/routines.json。进入工作区后默认改为 merged 视图查看实际生效结果。";

  return (
    <PageScaffold
      title="工作流配置台"
      description="参考 NarraFork 的 routines/config workbench 信息架构，把模型、Agent、MCP、插件、调度、检测、通知和关键编排资源收口到一个工作台里。"
      actions={
        <>
          <Badge variant="secondary">统一入口</Badge>
          <Badge variant="outline">Routines 资源显性化</Badge>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <WorkbenchStat title="已收口模块" value="9" description="从分散入口合并到统一工作台" />
        <WorkbenchStat title="一级入口" value="1" description="侧边栏只保留工作流配置" />
        <WorkbenchStat title="当前区块" value={currentTab.label} description={currentTab.summary} />
        <WorkbenchStat title="配置边界" value={currentTab.scope} description={currentTab.scopeDescription} />
      </div>

      <Card size="sm" className="border-dashed bg-muted/20">
        <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-base">当前区块的配置边界</CardTitle>
            <CardDescription>
              {currentTab.scopeDescription}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{currentTab.scope}</Badge>
            <Badge variant="outline">{currentTab.saveStrategy}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          <div>
            <p className="font-medium text-foreground">适用范围</p>
            <p className="mt-1">{currentTab.scopeDescription}</p>
          </div>
          <div>
            <p className="font-medium text-foreground">保存策略</p>
            <p className="mt-1">{currentTab.saveDescription}</p>
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="border-dashed bg-muted/20" data-testid="workflow-routines-policy">
        <CardHeader className="gap-2">
          <CardTitle className="text-base">Routines 主事实源</CardTitle>
          <CardDescription>
            后端 routines-service 文件配置是唯一事实源，Prompt / Tool Permissions / Sub-agents 直接在工作流配置台读写。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{routinesDescription}</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">默认读取：{workspace ? "merged" : "global"}</Badge>
            <Badge variant="outline">保存入口：global / project</Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={currentSection}
        onValueChange={(value) => onNavigateSection?.(value as WorkflowSection)}
        orientation="vertical"
        className="gap-6 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start"
      >
        <Card className="lg:sticky lg:top-0">
          <CardHeader>
            <CardTitle>配置导航</CardTitle>
            <CardDescription>按职责分区，不再在侧边栏散落多个低频入口。</CardDescription>
          </CardHeader>
          <CardContent>
            <TabsList variant="line" className="w-full flex-col items-stretch gap-1 bg-transparent p-0">
              {WORKFLOW_TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="w-full justify-start rounded-xl border border-transparent px-3 py-2.5 data-active:border-border data-active:bg-muted/70"
                  >
                    <Icon className="size-4" />
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="truncate">{tab.label}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {tab.badge}
                      </Badge>
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6">
          {WORKFLOW_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsContent key={tab.value} value={tab.value} className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon className="size-5 text-primary" />
                      {tab.label}
                    </CardTitle>
                    <CardDescription>{tab.summary}</CardDescription>
                  </CardHeader>
                </Card>

                {tab.value === "project" && (
                  <>
                    <ConfigView nav={nav} theme={theme} t={t} />
                    <WorkflowRoutinesResourceBlock
                      title="Prompt 资源"
                      description="把全局 Prompt / System Prompt 变成工作流配置台里的正式编排区块，仍然只读写 routines-service。"
                      sections={["prompts"]}
                      projectRoot={workspace ?? undefined}
                      testId="workflow-routines-prompts"
                    />
                  </>
                )}
                {tab.value === "agents" && (
                  <>
                    <AgentPanel nav={nav} theme={theme} t={t} />
                    <WorkflowRoutinesResourceBlock
                      title="执行编排资源"
                      description="Tool Permissions 与 Sub-agents 直接复用现有 routines 数据结构和编辑组件，不再藏在独立 Routines 页面里。"
                      sections={["permissions", "subagents"]}
                      projectRoot={workspace ?? undefined}
                      testId="workflow-routines-agents"
                    />
                  </>
                )}
                {tab.value === "mcp" && <MCPServerManager nav={nav} theme={theme} t={t} />}
                {tab.value === "plugins" && <PluginManager nav={nav} theme={theme} t={t} />}
                {tab.value === "advanced" && <LLMAdvancedConfig nav={nav} theme={theme} t={t} />}
                {tab.value === "scheduler" && <SchedulerConfig nav={nav} theme={theme} t={t} />}
                {tab.value === "detection" && <DetectionConfigView nav={nav} theme={theme} t={t} />}
                {tab.value === "hooks" && (
                  <>
                    <Card size="sm" className="border-dashed bg-muted/20" data-testid="workflow-hooks-resource">
                      <CardHeader className="gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1.5">
                          <CardTitle className="text-base">Hooks 资源区块</CardTitle>
                          <CardDescription>
                            伏笔健康继续读取当前书籍 truth 快照，但在工作流配置台里以正式区块承接运行中的伏笔状态与回收率。
                          </CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">项目级</Badge>
                          <Badge variant="outline">即时刷新</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <Badge variant="secondary" className="gap-1">
                          <Anchor className="size-3.5" />
                          pending_hooks.md
                        </Badge>
                        <Badge variant="outline">当前书籍伏笔快照</Badge>
                      </CardContent>
                    </Card>
                    <HookDashboard nav={nav} theme={theme} t={t} />
                  </>
                )}
                {tab.value === "notify" && <NotifyConfig nav={nav} theme={theme} t={t} />}
              </TabsContent>
            );
          })}
        </div>
      </Tabs>
    </PageScaffold>
  );
}

function WorkflowRoutinesResourceBlock({
  title,
  description,
  sections,
  projectRoot,
  testId,
}: {
  title: string;
  description: string;
  sections: RoutinesResourceSection[];
  projectRoot?: string;
  testId: string;
}) {
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

  const promptCount = routines.globalPrompts.length + routines.systemPrompts.length;
  const permissionCount = routines.permissions.length;
  const subAgentCount = routines.subAgents.length;
  const enabledSubAgentCount = routines.subAgents.filter((agent) => agent.enabled).length;

  return (
    <Card data-testid={testId}>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={loading || saving || isReadOnly}
            className="px-3 py-2 text-sm rounded border hover:bg-accent disabled:opacity-50 flex items-center gap-2"
          >
            <RotateCcw size={14} />
            Reset
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading || saving || isReadOnly}
            className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {saved ? <CheckCircle size={14} /> : <Save size={14} />}
            {saving ? "Saving..." : saved ? "Saved" : "Save"}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          {sections.includes("prompts") && (
            <ResourceStatCard
              title="Prompt"
              value={String(promptCount)}
              description={`Global ${routines.globalPrompts.length} / System ${routines.systemPrompts.length}`}
            />
          )}
          {sections.includes("permissions") && (
            <ResourceStatCard
              title="Tool Permissions"
              value={String(permissionCount)}
              description="Allow / Ask / Deny 规则"
            />
          )}
          {sections.includes("subagents") && (
            <ResourceStatCard
              title="Sub-agents"
              value={String(subAgentCount)}
              description={`已启用 ${enabledSubAgentCount} 个`}
            />
          )}
        </div>

        <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid={`${testId}-scope`}>
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
              {ROUTINES_SCOPE_META.merged.label}
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
              {ROUTINES_SCOPE_META.global.label}
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
              {ROUTINES_SCOPE_META.project.label}
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

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        ) : (
          <fieldset disabled={isReadOnly} className={isReadOnly ? "space-y-4 opacity-70" : "space-y-4"}>
            {sections.includes("prompts") && (
              <ResourceSectionCard
                title="Prompt"
                icon={FileText}
                description="直接管理 global prompts 与 system prompts，仍然走 /api/routines 的 merged/global/project 口径。"
                badges={[
                  `Global ${routines.globalPrompts.length}`,
                  `System ${routines.systemPrompts.length}`,
                ]}
                testId={`${testId}-prompts`}
              >
                <PromptsTab
                  globalPrompts={routines.globalPrompts}
                  systemPrompts={routines.systemPrompts}
                  onGlobalChange={(globalPrompts) => setRoutines({ ...routines, globalPrompts })}
                  onSystemChange={(systemPrompts) => setRoutines({ ...routines, systemPrompts })}
                />
              </ResourceSectionCard>
            )}

            {sections.includes("permissions") && (
              <ResourceSectionCard
                title="Tool Permissions"
                icon={ShieldCheck}
                description="Allow / Ask / Deny 规则与 pattern 匹配直接复用现有 permissions 数据结构。"
                badges={[`${routines.permissions.length} 条规则`]}
                testId={`${testId}-permissions`}
              >
                <PermissionsTab
                  permissions={routines.permissions}
                  onChange={(permissions) => setRoutines({ ...routines, permissions })}
                />
              </ResourceSectionCard>
            )}

            {sections.includes("subagents") && (
              <ResourceSectionCard
                title="Sub-agents"
                icon={Bot}
                description="自定义子代理继续复用原有 subAgents 数组与编辑器，不再维护第二套工作流事实源。"
                badges={[`${routines.subAgents.length} 个`, `启用 ${enabledSubAgentCount} 个`]}
                testId={`${testId}-subagents`}
              >
                <SubAgentsTab
                  subAgents={routines.subAgents}
                  onChange={(subAgents) => setRoutines({ ...routines, subAgents })}
                />
              </ResourceSectionCard>
            )}
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}

function ResourceSectionCard({
  title,
  description,
  badges,
  icon: Icon,
  children,
  testId,
}: {
  title: string;
  description: string;
  badges: string[];
  icon: typeof FileText;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Card size="sm" data-testid={testId}>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="size-4 text-primary" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {badges.map((badge) => (
            <Badge key={badge} variant="outline">
              {badge}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ResourceStatCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

function WorkbenchStat({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
