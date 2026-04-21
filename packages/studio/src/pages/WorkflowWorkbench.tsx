import { Bot,
  Bell,
  Boxes,
  Puzzle,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { PageScaffold } from "@/components/layout/PageScaffold";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "../hooks/use-api";
import { AgentPanel } from "./AgentPanel";
import { ConfigView } from "./ConfigView";
import { DetectionConfigView } from "./DetectionConfigView";
import { HookDashboard } from "./HookDashboard";
import { LLMAdvancedConfig } from "./LLMAdvancedConfig";
import { MCPServerManager } from "./MCPServerManager";
import { NotifyConfig } from "./NotifyConfig";
import { PluginManager } from "./PluginManager";
import { SchedulerConfig } from "./SchedulerConfig";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { WorkflowSection } from "../routes";


interface Nav {
  toDashboard: () => void;
  toBook: (bookId: string) => void;
  toWorkflow?: (section?: WorkflowSection) => void;
}

interface GovernanceSettingsResponse {
  runtimeControls?: {
    defaultPermissionMode?: "allow" | "ask" | "deny";
    toolAccess?: {
      allowlist?: string[];
      blocklist?: string[];
      mcpStrategy?: "allow" | "ask" | "deny" | "inherit";
    };
  };
}

interface MCPRegistryResponse {
  summary?: {
    totalServers: number;
    connectedServers: number;
    enabledTools: number;
    discoveredTools: number;
    allowTools?: number;
    promptTools?: number;
    denyTools?: number;
    policySource?: string;
    mcpStrategy?: "allow" | "ask" | "deny" | "inherit";
  };
}

const WORKFLOW_TABS = [
  {
    value: "project",
    label: "项目与模型",
    icon: Boxes,
    summary: "项目基础配置、默认模型、路由覆盖",
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
    summary: "16 个写作 Agent 的路由与状态总览",
    badge: "核心",
    scope: "全局级",
    scopeDescription: "影响整套写作管线默认行为，所有项目默认继承。",
    saveStrategy: "面板内保存",
    saveDescription: "按 Agent 分组在各自面板保存，避免误改整套编排。",
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

function formatStatusList(values: string[] | undefined) {
  if (!values || values.length === 0) {
    return "未启用";
  }

  return `${values.length} 项（${values.slice(0, 3).join(" / ")}${values.length > 3 ? " …" : ""}）`;
}

function GovernanceSummaryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card size="sm" className="border-border/70 bg-background/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

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
  const currentSection = section ?? "project";
  const currentTab = useMemo(
    () => WORKFLOW_TABS.find((tab) => tab.value === currentSection) ?? WORKFLOW_TABS[0],
    [currentSection],
  );
  const workflowSettings = useApi<GovernanceSettingsResponse>("/settings/user");
  const mcpRegistry = useApi<MCPRegistryResponse>("/mcp/registry");
  const workflowNav = {
    toDashboard: nav.toDashboard,
    toWorkflow: () => {
      if (onNavigateSection) {
        onNavigateSection("project");
        return;
      }

      nav.toWorkflow?.("project");
    },
  };
  const runtimeControls = workflowSettings.data?.runtimeControls;
  const toolAccess = runtimeControls?.toolAccess;
  const registrySummary = mcpRegistry.data?.summary;

  return (
    <PageScaffold
      title="工作流配置"
      description="把原先分散在多个页面的模型、Agent、MCP、插件、调度、检测和通知配置收口到一个工作台里，侧边栏只保留一个稳定入口。"
      actions={
        <>
          <Badge variant="secondary">阶段 1</Badge>
          <Badge variant="outline">shadcn UI</Badge>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <WorkbenchStat title="已收口模块" value="9" description="从分散入口合并到统一工作台" />
        <WorkbenchStat title="一级入口" value="1" description="侧边栏只保留工作流配置" />
        <WorkbenchStat title="参考方向" value="NarraFork" description="参考其配置中心与信息架构" />
      </div>

      <Card className="border-dashed bg-muted/20">
        <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">统一治理总览</CardTitle>
            <CardDescription>
              把 workflow 编排、MCP 注册表和 toolAccess / mcpStrategy 边界收在同一页，避免来回跳 Settings 或 MCPServerManager。
            </CardDescription>
          </div>
          <Badge variant="outline">Workflow / Routines / MCP / Permissions</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-3">
          <GovernanceSummaryCard title="当前 workflow 编排">
            <p className="text-foreground">当前区块：{currentTab.label}</p>
            <p>区块摘要：{currentTab.summary}</p>
            <p>作用域：{currentTab.scope}</p>
            <p>保存策略：{currentTab.saveStrategy}</p>
          </GovernanceSummaryCard>

          <GovernanceSummaryCard title="工具执行边界">
            <div className="flex items-center justify-between gap-3">
              <span className="text-foreground">toolAccess 模式</span>
              <Badge variant="secondary">{runtimeControls?.defaultPermissionMode ?? "读取中"}</Badge>
            </div>
            <p>allowlist：{formatStatusList(toolAccess?.allowlist)}</p>
            <p>blocklist：{formatStatusList(toolAccess?.blocklist)}</p>
            <p>mcpStrategy：{toolAccess?.mcpStrategy ?? registrySummary?.mcpStrategy ?? "inherit"}</p>
            <p>策略来源：{registrySummary?.policySource ?? "runtimeControls.toolAccess"}</p>
          </GovernanceSummaryCard>

          <GovernanceSummaryCard title="MCP 注册表实时摘要">
            <p className="text-foreground">已发现 {registrySummary?.discoveredTools ?? 0} 个工具</p>
            <p>已启用 {registrySummary?.enabledTools ?? 0} 个工具</p>
            <p>allow / prompt / deny：{registrySummary?.allowTools ?? 0} / {registrySummary?.promptTools ?? 0} / {registrySummary?.denyTools ?? 0}</p>
            <p>已连接 {registrySummary?.connectedServers ?? 0} / {registrySummary?.totalServers ?? 0} 个 Server</p>
            <p>策略来源：{registrySummary?.policySource ?? "runtimeControls.toolAccess"}</p>
          </GovernanceSummaryCard>
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

                {tab.value === "project" && <ConfigView nav={nav} theme={theme} t={t} />}
                {tab.value === "agents" && <AgentPanel nav={workflowNav} theme={theme} t={t} />}
                {tab.value === "mcp" && <MCPServerManager nav={nav} theme={theme} t={t} />}
                {tab.value === "plugins" && <PluginManager nav={nav} theme={theme} t={t} />}
                {tab.value === "advanced" && <LLMAdvancedConfig nav={workflowNav} theme={theme} t={t} />}
                {tab.value === "scheduler" && <SchedulerConfig nav={workflowNav} theme={theme} t={t} />}
                {tab.value === "detection" && <DetectionConfigView nav={nav} theme={theme} t={t} />}
                {tab.value === "hooks" && <HookDashboard nav={nav} theme={theme} t={t} />}
                {tab.value === "notify" && <NotifyConfig nav={nav} theme={theme} t={t} />}
              </TabsContent>
            );
          })}
        </div>
      </Tabs>
    </PageScaffold>
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
