/**
 * Admin 管理面板
 * 用户管理、API 供应商管理、资源监控、请求历史
 */

import { Activity, FileText, LayoutDashboard, Logs, Server, Users, Workflow } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSection } from "../../routes";
import { ProvidersTab } from "./ProvidersTab";
import { RequestsTab } from "./RequestsTab";
import { ResourcesTab } from "./ResourcesTab";
import { UsersTab } from "./UsersTab";

interface AdminProps {
  onBack?: () => void;
  section?: AdminSection;
  onNavigateSection?: (section: AdminSection) => void;
}

const PLACEHOLDER_SECTIONS = new Set<AdminPlaceholderSection>(["daemon", "logs", "worktrees"]);

type AdminPlaceholderSection = Exclude<AdminSection, "overview" | "providers" | "resources" | "requests">;

function isPlaceholderSection(section: AdminSection): section is AdminPlaceholderSection {
  return section === "daemon" || section === "logs" || section === "worktrees";
}

export function Admin({ onBack, section, onNavigateSection }: AdminProps) {
  const activeSection = section ?? "overview";

  return (
    <PageScaffold
      title="管理中心"
      description="参考 NarraFork 的 Admin 信息架构，把供应商、请求历史、资源监控与系统运维入口收口到一个平台面板里。"
      actions={onBack ? <Button variant="outline" onClick={onBack}>返回</Button> : undefined}
      contentClassName="space-y-6"
    >
      <div className="space-y-4" data-testid="admin-panel">
        <section>
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
        </section>

        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">系统运维</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminEntryCard
              icon={Server}
              title="守护进程"
              description="查看运行状态、启动 / 停止与最近事件。"
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
          </div>
        </section>
      </div>

      {activeSection === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>管理首页</CardTitle>
              <CardDescription>
                这一层先站住“平台面板”结构，下一批再把守护进程、日志、Worktree 等系统子页整体并进来。
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>当前收口范围</CardTitle>
              <CardDescription>
                供应商、请求历史、资源监控优先统一到管理中心；守护进程 / 日志 / Worktree 暂以管理子路由方式接入。
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>用户管理</CardTitle>
                <CardDescription>沿用现有用户管理能力，先保留在管理中心总览里。</CardDescription>
              </div>
              <Badge variant="secondary">核心入口</Badge>
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

      {isPlaceholderSection(activeSection) && (
        <PageEmptyState
          title={placeholderTitle(activeSection)}
          description={placeholderDescription(activeSection)}
          action={
            <Button variant="outline" onClick={() => onNavigateSection?.("overview")}>
              返回总览
            </Button>
          }
        />
      )}
    </PageScaffold>
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
    <button type="button" onClick={onClick} className="text-left">
      <Card className={active ? "border-primary/40 bg-primary/5" : undefined}>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="size-4 text-primary" />
              {title}
            </CardTitle>
            {active && <Badge variant="secondary">当前</Badge>}
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </button>
  );
}

function placeholderTitle(section: AdminPlaceholderSection) {
  switch (section) {
    case "daemon":
      return "守护进程";
    case "logs":
      return "日志";
    case "worktrees":
      return "Worktree";
  }
}

function placeholderDescription(section: AdminPlaceholderSection) {
  switch (section) {
    case "daemon":
      return "下一批会把守护进程运行状态、启动 / 停止和最近事件统一收口到这里。";
    case "logs":
      return "下一批会把日志滚动、筛选和导出统一收口到这里。";
    case "worktrees":
      return "下一批会把工作树列表、分支状态和隔离目录管理统一收口到这里。";
  }
}
