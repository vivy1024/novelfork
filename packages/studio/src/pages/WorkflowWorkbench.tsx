import {
  Activity,
  Bot,
  Bell,
  Boxes,
  Globe2,
  Puzzle,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Workflow,
  Wrench,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useRunListStream } from "@/hooks/use-run-events";
import type { StudioRun } from "@/shared/contracts";

import { PageScaffold } from "@/components/layout/PageScaffold";
import { WorkbenchModeGate } from "@/components/workbench/WorkbenchModeGate";
import { LogsTab } from "@/components/Admin/LogsTab";
import { RequestsTab } from "@/components/Admin/RequestsTab";
import { ResourcesTab } from "@/components/Admin/ResourcesTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  describeToolAccessReason,
  normalizeGovernanceSourceKey,
  type GovernanceSourceKey,
  type GovernanceSurface,
  type ToolAccessReasonKey,
} from "../shared/tool-access-reasons";
import { getSessionPermissionModeOption } from "../shared/session-types";
import type { RuntimeControlSettings } from "../types/settings";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { AdminSection, SettingsSection, WorkflowSection } from "../routes";


interface Nav {
  toDashboard: () => void;
  toBook: (bookId: string) => void;
  toWorkflow?: (section?: WorkflowSection) => void;
  toSettings?: (section?: SettingsSection) => void;
  toAdmin?: (section?: AdminSection) => void;
  toImport?: () => void;
  toRadar?: () => void;
  toPipeline?: (runId?: string) => void;
}

interface GovernanceSettingsResponse {
  runtimeControls?: Partial<RuntimeControlSettings>;
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
  servers?: Array<{
    id: string;
    name: string;
    tools?: Array<{
      name: string;
      access?: "allow" | "prompt" | "deny";
      source?: string;
      reason?: string;
      reasonKey?: ToolAccessReasonKey;
    }>;
  }>;
}

interface ToolsRegistryResponse {
  tools?: Array<{
    name: string;
    access?: "allow" | "prompt" | "deny";
    source?: string;
    reason?: string;
    reasonKey?: ToolAccessReasonKey;
  }>;
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
    value: "toolchain",
    label: "工具链入口",
    icon: TerminalSquare,
    summary: "Terminal / Browser / MCP / Pipeline 的权限与风险入口",
    badge: "高级",
    scope: "工作台级",
    scopeDescription: "只在高级工作台模式暴露，作者默认模式不显示这些 coder 向入口。",
    saveStrategy: "只读治理",
    saveDescription: "入口卡展示权限来源、风险边界和返回作者模式路径；具体执行仍走各子面板确认。",
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
    value: "diagnostics",
    label: "诊断面板",
    icon: Activity,
    summary: "资源、请求、日志与运行事实的高级诊断",
    badge: "诊断",
    scope: "工作台级",
    scopeDescription: "复用管理中心诊断组件，只在工作台模式内显示本地路径、请求和日志明细。",
    saveStrategy: "只读观察",
    saveDescription: "诊断面板默认只读；恢复、重扫等动作仍在对应 Admin 子组件内逐项触发。",
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

type GovernanceFilter = "all" | "prompt" | "deny";
type GovernanceSurfaceFilter = "all" | GovernanceSurface;
type GovernanceSourceFilter = "all" | GovernanceSourceKey;
type WorkbenchDiagnosticSection = "resources" | "requests" | "logs";

interface GovernanceToolSample {
  label: string;
  reason: string;
  access: Exclude<GovernanceFilter, "all">;
  surface: GovernanceSurface;
  sourceKey: GovernanceSourceKey;
}

interface GovernanceReasonGroup {
  reason: string;
  count: number;
}

interface GovernanceRunSummary {
  total: number;
  active: number;
  failed: number;
  latestStage: string;
  latestRuns: ReadonlyArray<StudioRun>;
}

function formatToolSample(sample: GovernanceToolSample) {
  return `${sample.label} · ${sample.reason}`;
}

function groupReasons(samples: GovernanceToolSample[]) {
  const counts = new Map<string, number>();

  for (const sample of samples) {
    counts.set(sample.reason, (counts.get(sample.reason) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

function renderSampleList(samples: GovernanceToolSample[]) {
  if (samples.length === 0) {
    return <p>暂无</p>;
  }

  return (
    <ul className="space-y-1">
      {samples.map((sample) => (
        <li key={`${sample.access}-${sample.label}-${sample.reason}`}>{formatToolSample(sample)}</li>
      ))}
    </ul>
  );
}

function summarizeLiveRuns(runs: ReadonlyArray<StudioRun>): GovernanceRunSummary {
  const activeRuns = runs.filter((run) => run.status === "queued" || run.status === "running");
  const failedRuns = runs.filter((run) => run.status === "failed");

  return {
    total: runs.length,
    active: activeRuns.length,
    failed: failedRuns.length,
    latestStage: activeRuns[0]?.stage ?? runs[0]?.stage ?? "暂无运行",
    latestRuns: runs.slice(0, 3),
  };
}

function filterSamples(
  samples: GovernanceToolSample[],
  filter: GovernanceFilter,
  surfaceFilter: GovernanceSurfaceFilter,
  sourceFilter: GovernanceSourceFilter,
) {
  return samples.filter((sample) => {
    const accessMatches = filter === "all" || sample.access === filter;
    const surfaceMatches = surfaceFilter === "all" || sample.surface === surfaceFilter;
    const sourceMatches = sourceFilter === "all" || sample.sourceKey === sourceFilter;
    return accessMatches && surfaceMatches && sourceMatches;
  });
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
  const [governanceFilter, setGovernanceFilter] = useState<GovernanceFilter>("all");
  const [governanceSurfaceFilter, setGovernanceSurfaceFilter] = useState<GovernanceSurfaceFilter>("all");
  const [governanceSourceFilter, setGovernanceSourceFilter] = useState<GovernanceSourceFilter>("all");
  const [diagnosticSection, setDiagnosticSection] = useState<WorkbenchDiagnosticSection>("resources");
  const [focusedDiagnosticRunId, setFocusedDiagnosticRunId] = useState<string | undefined>(undefined);
  const currentTab = useMemo(
    () => WORKFLOW_TABS.find((tab) => tab.value === currentSection) ?? WORKFLOW_TABS[0],
    [currentSection],
  );
  const workflowSettings = useApi<GovernanceSettingsResponse>("/settings/user");
  const mcpRegistry = useApi<MCPRegistryResponse>("/mcp/registry");
  const toolsRegistry = useApi<ToolsRegistryResponse>("/tools/list");
  const liveRuns = useRunListStream();
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
  const activePermission = runtimeControls?.defaultPermissionMode
    ? getSessionPermissionModeOption(runtimeControls.defaultPermissionMode)
    : null;
  const toolAccess = runtimeControls?.toolAccess;
  const registrySummary = mcpRegistry.data?.summary;
  const builtinToolSummary = useMemo(() => {
    const tools = toolsRegistry.data?.tools ?? [];
    return {
      allow: tools.filter((tool) => tool.access === "allow").length,
      prompt: tools.filter((tool) => tool.access === "prompt").length,
      deny: tools.filter((tool) => tool.access === "deny").length,
      allowlist: tools.filter((tool) => tool.source === "runtimeControls.toolAccess.allowlist").length,
      blocklist: tools.filter((tool) => tool.source === "runtimeControls.toolAccess.blocklist").length,
      defaultPermissionMode: tools.filter((tool) => tool.source === "runtimeControls.defaultPermissionMode").length,
      builtinRules: tools.filter((tool) => tool.source === "builtin-permission-rules").length,
    };
  }, [toolsRegistry.data?.tools]);
  const mcpSourceSummary = useMemo(() => {
    const tools = (mcpRegistry.data?.servers ?? []).flatMap((server) => server.tools ?? []);
    return {
      mcpStrategy: tools.filter((tool) => tool.source === "runtimeControls.toolAccess.mcpStrategy").length,
      blocklist: tools.filter((tool) => tool.source === "runtimeControls.toolAccess.blocklist").length,
    };
  }, [mcpRegistry.data?.servers]);
  const builtinReasonSummary = useMemo(() => {
    const tools = toolsRegistry.data?.tools ?? [];
    return {
      blocklist: tools.filter((tool) => tool.reasonKey === "blocklist-deny").length,
      defaultAsk: tools.filter((tool) => tool.reasonKey === "default-prompt").length,
      builtinPrompt: tools.filter((tool) => tool.reasonKey === "builtin-write-prompt").length,
    };
  }, [toolsRegistry.data?.tools]);
  const mcpReasonSummary = useMemo(() => {
    const tools = (mcpRegistry.data?.servers ?? []).flatMap((server) => server.tools ?? []);
    return {
      mcpStrategyAsk: tools.filter((tool) => tool.reasonKey === "mcp-strategy-prompt").length,
      blocklist: tools.filter((tool) => tool.reasonKey === "blocklist-deny").length,
    };
  }, [mcpRegistry.data?.servers]);
  const builtinPromptSamples = useMemo(
    () => (toolsRegistry.data?.tools ?? [])
      .filter((tool) => tool.access === "prompt")
      .slice(0, 4)
      .map((tool) => ({
        label: tool.name,
        reason: describeToolAccessReason(tool.reasonKey, tool.reason),
        access: "prompt" as const,
        surface: "builtin" as const,
        sourceKey: normalizeGovernanceSourceKey(tool.source),
      })),
    [toolsRegistry.data?.tools],
  );
  const builtinDenySamples = useMemo(
    () => (toolsRegistry.data?.tools ?? [])
      .filter((tool) => tool.access === "deny")
      .slice(0, 4)
      .map((tool) => ({
        label: tool.name,
        reason: describeToolAccessReason(tool.reasonKey, tool.reason),
        access: "deny" as const,
        surface: "builtin" as const,
        sourceKey: normalizeGovernanceSourceKey(tool.source),
      })),
    [toolsRegistry.data?.tools],
  );
  const mcpPromptSamples = useMemo(
    () => (mcpRegistry.data?.servers ?? [])
      .flatMap((server) =>
        (server.tools ?? [])
          .filter((tool) => tool.access === "prompt")
          .map((tool) => ({
            label: `${server.id} / ${tool.name}`,
            reason: describeToolAccessReason(tool.reasonKey, tool.reason),
            access: "prompt" as const,
            surface: "mcp" as const,
            sourceKey: normalizeGovernanceSourceKey(tool.source),
          })),
      )
      .slice(0, 4),
    [mcpRegistry.data?.servers],
  );
  const mcpDenySamples = useMemo(
    () => (mcpRegistry.data?.servers ?? [])
      .flatMap((server) =>
        (server.tools ?? [])
          .filter((tool) => tool.access === "deny")
          .map((tool) => ({
            label: `${server.id} / ${tool.name}`,
            reason: describeToolAccessReason(tool.reasonKey, tool.reason),
            access: "deny" as const,
            surface: "mcp" as const,
            sourceKey: normalizeGovernanceSourceKey(tool.source),
          })),
      )
      .slice(0, 4),
    [mcpRegistry.data?.servers],
  );
  const filteredBuiltinPromptSamples = useMemo(
    () => filterSamples(builtinPromptSamples, governanceFilter, governanceSurfaceFilter, governanceSourceFilter),
    [builtinPromptSamples, governanceFilter, governanceSourceFilter, governanceSurfaceFilter],
  );
  const filteredBuiltinDenySamples = useMemo(
    () => filterSamples(builtinDenySamples, governanceFilter, governanceSurfaceFilter, governanceSourceFilter),
    [builtinDenySamples, governanceFilter, governanceSourceFilter, governanceSurfaceFilter],
  );
  const filteredMcpPromptSamples = useMemo(
    () => filterSamples(mcpPromptSamples, governanceFilter, governanceSurfaceFilter, governanceSourceFilter),
    [governanceFilter, governanceSourceFilter, governanceSurfaceFilter, mcpPromptSamples],
  );
  const filteredMcpDenySamples = useMemo(
    () => filterSamples(mcpDenySamples, governanceFilter, governanceSurfaceFilter, governanceSourceFilter),
    [governanceFilter, governanceSourceFilter, governanceSurfaceFilter, mcpDenySamples],
  );
  const governanceReasonGroups = useMemo(
    () => groupReasons([
      ...filteredBuiltinPromptSamples,
      ...filteredBuiltinDenySamples,
      ...filteredMcpPromptSamples,
      ...filteredMcpDenySamples,
    ]),
    [filteredBuiltinDenySamples, filteredBuiltinPromptSamples, filteredMcpDenySamples, filteredMcpPromptSamples],
  );
  const liveRunSummary = useMemo(() => summarizeLiveRuns(liveRuns), [liveRuns]);

  return (
    <WorkbenchModeGate>
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
        <WorkbenchStat title="已收口模块" value={String(WORKFLOW_TABS.length)} description="从分散入口合并到统一工作台" />
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
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-4">
            <GovernanceSummaryCard title="当前 workflow 编排">
              <p className="text-foreground">当前区块：{currentTab.label}</p>
              <p>区块摘要：{currentTab.summary}</p>
              <p>作用域：{currentTab.scope}</p>
              <p>保存策略：{currentTab.saveStrategy}</p>
            </GovernanceSummaryCard>

            <GovernanceSummaryCard title="工具执行边界">
              <div className="flex items-center justify-between gap-3">
                <span className="text-foreground">toolAccess 模式</span>
                <Badge variant="secondary">{activePermission?.label ?? "读取中"}</Badge>
              </div>
              {activePermission ? <p>{activePermission.description}</p> : null}
              <p>allowlist：{formatStatusList(toolAccess?.allowlist)}</p>
              <p>blocklist：{formatStatusList(toolAccess?.blocklist)}</p>
              <p>mcpStrategy：{toolAccess?.mcpStrategy ?? registrySummary?.mcpStrategy ?? "inherit"}</p>
              <p>
                恢复策略：启动恢复{runtimeControls?.recovery?.resumeOnStartup ? "开" : "关"} / 恢复 {runtimeControls?.recovery?.maxRecoveryAttempts ?? 0} 次 / 重试 {runtimeControls?.recovery?.maxRetryAttempts ?? 0} 次 / {runtimeControls?.recovery?.initialRetryDelayMs ?? 0}ms→{runtimeControls?.recovery?.maxRetryDelayMs ?? 0}ms / x{runtimeControls?.recovery?.backoffMultiplier ?? 1} / jitter {runtimeControls?.recovery?.jitterPercent ?? 0}%
              </p>
              <p>
                上下文治理：压缩阈值 {runtimeControls?.contextCompressionThresholdPercent ?? 0}% / 截断目标 {runtimeControls?.contextTruncateTargetPercent ?? 0}%
              </p>
              <p>
                调试链：dump {runtimeControls?.runtimeDebug?.dumpEnabled ? "开" : "关"} / trace {runtimeControls?.runtimeDebug?.traceEnabled ? "开" : "关"} / sample {runtimeControls?.runtimeDebug?.traceSampleRatePercent ?? 0}%
              </p>
              <p>内置 tools：{builtinToolSummary.allow} / {builtinToolSummary.prompt} / {builtinToolSummary.deny}</p>
              <p>内置来源：allowlist {builtinToolSummary.allowlist} / blocklist {builtinToolSummary.blocklist} / default {builtinToolSummary.defaultPermissionMode} / builtin {builtinToolSummary.builtinRules}</p>
              <p>内置原因：blocklist {builtinReasonSummary.blocklist} / default ask {builtinReasonSummary.defaultAsk} / builtin prompt {builtinReasonSummary.builtinPrompt}</p>
              <p>策略来源：{registrySummary?.policySource ?? "runtimeControls.toolAccess"}</p>
            </GovernanceSummaryCard>

            <GovernanceSummaryCard title="MCP 注册表实时摘要">
              <p className="text-foreground">已发现 {registrySummary?.discoveredTools ?? 0} 个工具</p>
              <p>已启用 {registrySummary?.enabledTools ?? 0} 个工具</p>
              <p>allow / prompt / deny：{registrySummary?.allowTools ?? 0} / {registrySummary?.promptTools ?? 0} / {registrySummary?.denyTools ?? 0}</p>
              <p>MCP 来源：mcpStrategy {mcpSourceSummary.mcpStrategy} / blocklist {mcpSourceSummary.blocklist}</p>
              <p>MCP 原因：mcpStrategy ask {mcpReasonSummary.mcpStrategyAsk} / blocklist {mcpReasonSummary.blocklist}</p>
              <p>已连接 {registrySummary?.connectedServers ?? 0} / {registrySummary?.totalServers ?? 0} 个 Server</p>

              <p>策略来源：{registrySummary?.policySource ?? "runtimeControls.toolAccess"}</p>
            </GovernanceSummaryCard>

            <GovernanceSummaryCard title="实时执行投影">
              <p className="text-foreground">活跃 run：{liveRunSummary.active} / 总 run：{liveRunSummary.total}</p>
              <p>失败 run：{liveRunSummary.failed}</p>
              <p>最新阶段：{liveRunSummary.latestStage}</p>
              {liveRunSummary.latestRuns.length === 0 ? (
                <p>当前没有来自 runStore 的执行事实。</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {liveRunSummary.latestRuns.map((run) => (
                    <li key={run.id}>{run.action} · {run.status} · {run.stage} · {run.id}</li>
                  ))}
                </ul>
              )}
            </GovernanceSummaryCard>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={governanceFilter === "all" ? "secondary" : "outline"} onClick={() => setGovernanceFilter("all")}>
                  全部样本
                </Button>
                <Button type="button" size="sm" variant={governanceFilter === "prompt" ? "secondary" : "outline"} onClick={() => setGovernanceFilter("prompt")}>
                  仅看需确认
                </Button>
                <Button type="button" size="sm" variant={governanceFilter === "deny" ? "secondary" : "outline"} onClick={() => setGovernanceFilter("deny")}>
                  仅看已拒绝
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={governanceSurfaceFilter === "all" ? "secondary" : "outline"} onClick={() => setGovernanceSurfaceFilter("all")}>
                  全部范围
                </Button>
                <Button type="button" size="sm" variant={governanceSurfaceFilter === "builtin" ? "secondary" : "outline"} onClick={() => setGovernanceSurfaceFilter("builtin")}>
                  仅看内置
                </Button>
                <Button type="button" size="sm" variant={governanceSurfaceFilter === "mcp" ? "secondary" : "outline"} onClick={() => setGovernanceSurfaceFilter("mcp")}>
                  仅看 MCP
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={governanceSourceFilter === "all" ? "secondary" : "outline"} onClick={() => setGovernanceSourceFilter("all")}>
                  全部来源
                </Button>
                <Button type="button" size="sm" variant={governanceSourceFilter === "blocklist" ? "secondary" : "outline"} onClick={() => setGovernanceSourceFilter("blocklist")}>
                  仅看 blocklist
                </Button>
                <Button type="button" size="sm" variant={governanceSourceFilter === "default" ? "secondary" : "outline"} onClick={() => setGovernanceSourceFilter("default")}>
                  仅看 defaultPermissionMode
                </Button>
                <Button type="button" size="sm" variant={governanceSourceFilter === "builtin" ? "secondary" : "outline"} onClick={() => setGovernanceSourceFilter("builtin")}>
                  仅看 builtin 规则
                </Button>
                <Button type="button" size="sm" variant={governanceSourceFilter === "mcpStrategy" ? "secondary" : "outline"} onClick={() => setGovernanceSourceFilter("mcpStrategy")}>
                  仅看 mcpStrategy
                </Button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-5">
              <GovernanceSummaryCard title="内置工具需确认样本">
                {renderSampleList(filteredBuiltinPromptSamples)}
              </GovernanceSummaryCard>
              <GovernanceSummaryCard title="内置工具已拒绝样本">
                {renderSampleList(filteredBuiltinDenySamples)}
              </GovernanceSummaryCard>
              <GovernanceSummaryCard title="MCP 工具需确认样本">
                {renderSampleList(filteredMcpPromptSamples)}
              </GovernanceSummaryCard>
              <GovernanceSummaryCard title="MCP 工具已拒绝样本">
                {renderSampleList(filteredMcpDenySamples)}
              </GovernanceSummaryCard>
              <GovernanceSummaryCard title="原因分组与处置入口">
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => nav.toSettings?.("advanced")}>
                  前往高级设置
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => nav.toWorkflow?.("mcp")}>
                  前往 MCP 管理
                </Button>
              </div>
                {governanceReasonGroups.length === 0 ? (
                  <p>暂无</p>
                ) : (
                  <ul className="space-y-1">
                    {governanceReasonGroups.map((group) => (
                      <li key={group.reason}>{group.reason} · {group.count}</li>
                    ))}
                  </ul>
                )}
              </GovernanceSummaryCard>
            </div>
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

                {tab.value === "project" && <ConfigView nav={nav} theme={theme} t={t} />}
                {tab.value === "agents" && <AgentPanel nav={workflowNav} theme={theme} t={t} />}
                {tab.value === "toolchain" && (
                  <AdvancedToolchainPanel
                    activePermissionLabel={activePermission?.label ?? "读取中"}
                    activePermissionDescription={activePermission?.description ?? "正在读取默认权限模式。"}
                    builtinToolSummary={builtinToolSummary}
                    registrySummary={registrySummary}
                    nav={nav}
                  />
                )}
                {tab.value === "mcp" && <MCPServerManager nav={nav} theme={theme} t={t} />}
                {tab.value === "plugins" && <PluginManager nav={nav} theme={theme} t={t} />}
                {tab.value === "advanced" && <LLMAdvancedConfig nav={workflowNav} theme={theme} t={t} />}
                {tab.value === "scheduler" && <SchedulerConfig nav={workflowNav} theme={theme} t={t} />}
                {tab.value === "detection" && <DetectionConfigView nav={nav} theme={theme} t={t} />}
                {tab.value === "hooks" && <HookDashboard nav={nav} theme={theme} t={t} />}
                {tab.value === "diagnostics" && (
                  <AdvancedDiagnosticsPanel
                    section={diagnosticSection}
                    runId={focusedDiagnosticRunId}
                    onSectionChange={setDiagnosticSection}
                    onFocusRun={(runId) => setFocusedDiagnosticRunId(runId)}
                    onOpenRun={(runId) => nav.toPipeline?.(runId)}
                  />
                )}
                {tab.value === "notify" && <NotifyConfig nav={nav} theme={theme} t={t} />}
              </TabsContent>
            );
          })}
        </div>
        </Tabs>
      </PageScaffold>
    </WorkbenchModeGate>
  );
}

interface BuiltinToolSummary {
  allow: number;
  prompt: number;
  deny: number;
  allowlist: number;
  blocklist: number;
  defaultPermissionMode: number;
  builtinRules: number;
}

interface ToolchainEntryAction {
  label: string;
  onClick?: () => void;
}

interface ToolchainEntry {
  title: string;
  icon: typeof TerminalSquare;
  permission: string;
  risk: string;
  integration: string;
  returnPath: string;
  actions: ToolchainEntryAction[];
}

function AdvancedToolchainPanel({
  activePermissionLabel,
  activePermissionDescription,
  builtinToolSummary,
  registrySummary,
  nav,
}: {
  activePermissionLabel: string;
  activePermissionDescription: string;
  builtinToolSummary: BuiltinToolSummary;
  registrySummary: MCPRegistryResponse["summary"] | undefined;
  nav: Nav;
}) {
  const toolEntries: ToolchainEntry[] = [
    {
      title: "Terminal / Shell",
      icon: TerminalSquare,
      permission: `默认权限：${activePermissionLabel}；Bash / Shell 类工具同时受 allowlist、blocklist 和内置写类确认规则约束。`,
      risk: "可执行本机命令、启动进程、读写文件并暴露本地路径；请优先使用逐项询问或只读模式，避免把密钥写入日志。",
      integration: "当前以 Bash 工具权限、守护进程状态和运行日志方式接入；不在作者模式提供独立终端入口。",
      returnPath: "返回作者模式：使用页面顶部“切回作者模式”，侧边栏与命令面板会隐藏 Terminal / Shell 相关入口。",
      actions: [
        { label: "权限设置", onClick: nav.toSettings ? () => nav.toSettings?.("advanced") : undefined },
        { label: "查看日志", onClick: nav.toAdmin ? () => nav.toAdmin?.("logs") : undefined },
        { label: "守护进程", onClick: nav.toAdmin ? () => nav.toAdmin?.("daemon") : undefined },
      ],
    },
    {
      title: "Browser / 抓取",
      icon: Globe2,
      permission: "抓取能力只通过素材导入与市场雷达触发，结果进入可审阅素材区，不直接写入故事经纬或章节正文。",
      risk: "外部网页可能包含版权、隐私、站点条款和不稳定内容；导入前需要人工确认来源与用途。",
      integration: "把 NarraFork Browser 能力映射成作者化采风、题材扫描和素材整理，而不是默认暴露独立 Browser。",
      returnPath: "返回作者模式：切回后仍保留作者化导入 / 雷达入口，但不会显示 Browser 原始工具链。",
      actions: [
        { label: "素材导入", onClick: nav.toImport },
        { label: "市场雷达", onClick: nav.toRadar },
      ],
    },
    {
      title: "MCP 工具",
      icon: Server,
      permission: `MCP 策略：${registrySummary?.mcpStrategy ?? "inherit"}；allow / prompt / deny：${registrySummary?.allowTools ?? 0} / ${registrySummary?.promptTools ?? 0} / ${registrySummary?.denyTools ?? 0}。`,
      risk: "stdio MCP 会启动本地进程，SSE MCP 会连接远端服务；工具参数和返回值可能包含本地文件、URL 或账号上下文。",
      integration: "复用 MCP Server 管理与 /tools/list 注册表，所有调用遵循 mcpStrategy、allowlist、blocklist 与 reasonKey 解释。",
      returnPath: "返回作者模式：切回后隐藏 MCP Server 管理与原始工具注册表，只保留写作会话的必要提示。",
      actions: [
        { label: "MCP 管理", onClick: nav.toWorkflow ? () => nav.toWorkflow?.("mcp") : undefined },
        { label: "权限策略", onClick: nav.toSettings ? () => nav.toSettings?.("advanced") : undefined },
      ],
    },
    {
      title: "工具调用详情 / Pipeline",
      icon: Wrench,
      permission: `内置工具 allow / prompt / deny：${builtinToolSummary.allow} / ${builtinToolSummary.prompt} / ${builtinToolSummary.deny}；来源覆盖 allowlist ${builtinToolSummary.allowlist} / blocklist ${builtinToolSummary.blocklist}。`,
      risk: "Pipeline 会展示原始工具调用、运行阶段、错误和部分模型上下文，适合排障，不适合作者默认写作流。",
      integration: "复用 runStore、ToolCall 和 Admin Requests / Logs 串联同一条运行事实。",
      returnPath: "返回作者模式：顶部切换后隐藏 Pipeline 与工具调用详情入口，避免把排障指标带进日常写作。",
      actions: [
        { label: "打开 Pipeline", onClick: nav.toPipeline ? () => nav.toPipeline?.() : undefined },
        { label: "请求历史", onClick: nav.toAdmin ? () => nav.toAdmin?.("requests") : undefined },
      ],
    },
    {
      title: "诊断面板",
      icon: ShieldAlert,
      permission: "诊断默认只读观察；资源重扫、恢复重试等动作仍需要在对应面板中显式点击。",
      risk: "会暴露本地路径、日志、请求模型、耗时、token 估算和失败摘要；仅用于维护和排障。",
      integration: "复用 Admin Resources / Requests / Logs 组件，避免新增第二套诊断 UI。",
      returnPath: "返回作者模式：切回后隐藏诊断面板，作者首页只保留必要失败提示。",
      actions: [
        { label: "打开诊断", onClick: nav.toWorkflow ? () => nav.toWorkflow?.("diagnostics") : undefined },
        { label: "资源监控", onClick: nav.toAdmin ? () => nav.toAdmin?.("resources") : undefined },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/20 bg-amber-500/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4 text-amber-600" />
            工具权限与风险矩阵
          </CardTitle>
          <CardDescription className="text-amber-900/80">
            {activePermissionDescription} 每个入口都标明权限来源、风险说明和返回作者模式路径；作者默认模式不会展示 Terminal、Browser、MCP、Admin 或 Pipeline 原始入口。
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {toolEntries.map((entry) => (
          <ToolchainEntryCard key={entry.title} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function ToolchainEntryCard({ entry }: { entry: ToolchainEntry }) {
  const Icon = entry.icon;

  return (
    <Card className="border-border/70 bg-background/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-primary" />
          {entry.title}
        </CardTitle>
        <CardDescription>{entry.integration}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-foreground">权限说明</div>
          <p>{entry.permission}</p>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-amber-900">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em]">风险说明</div>
          <p>{entry.risk}</p>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-foreground">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">返回作者模式路径</div>
          <p>{entry.returnPath}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {entry.actions.map((action) => (
            <Button key={action.label} type="button" size="sm" variant="outline" onClick={action.onClick} disabled={!action.onClick}>
              {action.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AdvancedDiagnosticsPanel({
  section,
  runId,
  onSectionChange,
  onFocusRun,
  onOpenRun,
}: {
  section: WorkbenchDiagnosticSection;
  runId?: string;
  onSectionChange: (section: WorkbenchDiagnosticSection) => void;
  onFocusRun: (runId: string | undefined) => void;
  onOpenRun?: (runId: string) => void;
}) {
  const handleNavigateSection = (nextSection: WorkbenchDiagnosticSection, options?: { runId?: string }) => {
    onFocusRun(options?.runId);
    onSectionChange(nextSection);
  };
  const handleInspectRun = (nextRunId: string) => {
    onFocusRun(nextRunId);
    onOpenRun?.(nextRunId);
  };

  return (
    <div className="space-y-4">
      <Card className="border-dashed bg-muted/20">
        <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              高级诊断面板
            </CardTitle>
            <CardDescription>
              复用 Admin Resources / Requests / Logs；这里会显示本地路径、请求耗时、token 估算、日志和运行事实，只在工作台模式内可见。
            </CardDescription>
            <p className="text-xs text-muted-foreground">
              返回作者模式路径：点击页面顶部“切回作者模式”，侧边栏、命令面板与持久化入口都会隐藏诊断面板。
            </p>
          </div>
          <Badge variant="outline">Resources / Requests / Logs</Badge>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={section === "resources" ? "secondary" : "outline"} onClick={() => handleNavigateSection("resources")}>资源监控</Button>
          <Button type="button" size="sm" variant={section === "requests" ? "secondary" : "outline"} onClick={() => handleNavigateSection("requests")}>请求历史</Button>
          <Button type="button" size="sm" variant={section === "logs" ? "secondary" : "outline"} onClick={() => handleNavigateSection("logs")}>运行日志</Button>
          {runId ? <Badge variant="secondary">聚焦 run：{runId}</Badge> : null}
        </CardContent>
      </Card>

      {section === "resources" && <ResourcesTab />}
      {section === "requests" && (
        <RequestsTab
          runId={runId}
          onInspectRun={handleInspectRun}
          onNavigateSection={handleNavigateSection}
          onOpenRun={onOpenRun}
        />
      )}
      {section === "logs" && (
        <LogsTab
          runId={runId}
          onInspectRun={handleInspectRun}
          onNavigateSection={handleNavigateSection}
          onOpenRun={onOpenRun}
        />
      )}
    </div>
  );
}

function WorkbenchStat({ title, value, description }: { title: string; description: string; value: string }) {
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
