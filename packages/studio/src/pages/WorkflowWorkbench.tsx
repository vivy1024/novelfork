import {
  Bot,
  Bell,
  Boxes,
  Puzzle,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Workflow,
} from "lucide-react";

import { PageScaffold } from "@/components/layout/PageScaffold";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

interface Nav {
  toDashboard: () => void;
  toBook: (bookId: string) => void;
}

const WORKFLOW_TABS = [
  {
    value: "project",
    label: "项目与模型",
    icon: Boxes,
    summary: "项目基础配置、默认模型、路由覆盖",
    badge: "基础",
  },
  {
    value: "agents",
    label: "Agent",
    icon: Bot,
    summary: "16 个写作 Agent 的路由与状态总览",
    badge: "核心",
  },
  {
    value: "mcp",
    label: "MCP 工具",
    icon: Server,
    summary: "本地/远程 MCP Server 与工具接入",
    badge: "工具",
  },
  {
    value: "plugins",
    label: "插件",
    icon: Puzzle,
    summary: "插件开关、状态与配置入口",
    badge: "扩展",
  },
  {
    value: "advanced",
    label: "高级 LLM",
    icon: SlidersHorizontal,
    summary: "thinking budget、headers、extra 参数",
    badge: "模型",
  },
  {
    value: "scheduler",
    label: "调度",
    icon: Workflow,
    summary: "守护进程写作节奏与质量门控",
    badge: "自动化",
  },
  {
    value: "detection",
    label: "AIGC 检测",
    icon: ShieldCheck,
    summary: "检测提供商、阈值与自动改写策略",
    badge: "审计",
  },
  {
    value: "hooks",
    label: "伏笔健康",
    icon: Sparkles,
    summary: "伏笔生命周期、陈旧度与回收率",
    badge: "审计",
  },
  {
    value: "notify",
    label: "通知",
    icon: Bell,
    summary: "Telegram / 飞书 / 企业微信 / Webhook",
    badge: "联动",
  },
] as const;

export function WorkflowWorkbench({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const workflowNav = {
    toDashboard: nav.toDashboard,
    toWorkflow: () => {},
  };

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

      <Tabs defaultValue="project" orientation="vertical" className="gap-6 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
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
