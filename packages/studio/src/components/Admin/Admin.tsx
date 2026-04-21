/**
 * Admin 管理面板
 * 用户管理、API 供应商管理、资源监控、请求历史
 */

import { Activity, Box, FileText, LayoutDashboard, Logs, Server, Terminal, Users, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSection } from "../../routes";
import { ContainerTab } from "./ContainerTab";
import { ProvidersTab } from "./ProvidersTab";
import { RequestsTab } from "./RequestsTab";
import { ResourcesTab } from "./ResourcesTab";
import { TerminalTab } from "./TerminalTab";
import { UsersTab } from "./UsersTab";

interface AdminProps {
  onBack?: () => void;
  section?: AdminSection;
  onNavigateSection?: (section: AdminSection) => void;
}

export function Admin({ onBack, section, onNavigateSection }: AdminProps) {
  const activeSection = section ?? "overview";

  return (
    <div className="flex flex-col gap-6" data-testid="admin-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">管理 / 运维</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">管理中心</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            参考 NarraFork 的 Admin 信息架构，把供应商、请求历史、资源监控与系统运维入口收口到一个平台面板里。
          </p>
        </div>
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            返回
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">平台管理</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AdminEntryCard
              icon={LayoutDashboard}
              title="总览"
              description="平台入口卡片与后续系统能力收口点。"
              active={activeSection === "overview"}
              onClick={() => onNavigateSection?.("overview")}
            />
            <AdminEntryCard
              icon={Server}
              title="供应商"
              description="模型来源、启用状态与验证情况。"
              active={activeSection === "providers"}
              onClick={() => onNavigateSection?.("providers")}
            />
            <AdminEntryCard
              icon={Activity}
              title="资源监控"
              description="运行资源与系统态观察。"
              active={activeSection === "resources"}
              onClick={() => onNavigateSection?.("resources")}
            />
            <AdminEntryCard
              icon={FileText}
              title="请求历史"
              description="请求追踪、成本与性能统计。"
              active={activeSection === "requests"}
              onClick={() => onNavigateSection?.("requests")}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">系统运维</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminEntryCard
              icon={Server}
              title="守护进程"
              description="查看运行状态、启动/停止与最近事件。"
              active={activeSection === "daemon"}
              onClick={() => onNavigateSection?.("daemon")}
            />
            <AdminEntryCard
              icon={Logs}
              title="日志"
              description="滚动查看 Studio 与运行日志。"
              active={activeSection === "logs"}
              onClick={() => onNavigateSection?.("logs")}
            />
            <AdminEntryCard
              icon={Workflow}
              title="Worktree"
              description="管理隔离工作树与分支工作目录。"
              active={activeSection === "worktrees"}
              onClick={() => onNavigateSection?.("worktrees")}
            />
            <AdminEntryCard
              icon={Terminal}
              title="Terminal 终端"
              description="terminal 管理入口，后续接本地 shell 与受控命令执行。"
              active={activeSection === "terminal"}
              onClick={() => onNavigateSection?.("terminal")}
            />
            <AdminEntryCard
              icon={Box}
              title="Container 容器"
              description="container 管理入口，后续接容器运行时与 exec 能力。"
              active={activeSection === "container"}
              onClick={() => onNavigateSection?.("container")}
            />
          </div>
        </div>
      </div>

      {activeSection === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>管理首页</CardTitle>
              <CardDescription>这一层先站住“平台面板”结构，下一批再把守护进程、日志、Worktree 等系统子页整体并进来。</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>当前收口范围</CardTitle>
              <CardDescription>供应商、请求历史、资源监控优先统一到管理中心；守护进程 / 日志 / Worktree 暂以管理子路由方式接入。</CardDescription>
            </CardHeader>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>用户管理</CardTitle>
              <CardDescription>沿用现有用户管理能力，先保留在管理中心总览里。</CardDescription>
            </CardHeader>
            <CardContent>
              <UsersTab />
            </CardContent>
          </Card>
        </div>
      )}

      {activeSection === "providers" && <ProvidersTab />}
      {activeSection === "resources" && <ResourcesTab />}
      {activeSection === "requests" && <RequestsTab />}
      {activeSection === "terminal" && <TerminalTab />}
      {activeSection === "container" && <ContainerTab />}
    </div>
  );
}

function AdminEntryCard({
  icon: Icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: typeof Users;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="text-left">
      <Card className={active ? "border-primary/40 bg-primary/5" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="size-4 text-primary" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </button>
  );
}
