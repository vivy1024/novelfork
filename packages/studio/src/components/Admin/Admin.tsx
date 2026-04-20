/**
 * Admin 管理面板
 * 用户管理、API 供应商管理、资源监控、请求历史
 */

import { Activity, FileText, LayoutDashboard, Logs, Server, Users, Workflow } from "lucide-react";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSection } from "../../routes";
import { DaemonTab } from "./DaemonTab";
import { LogsTab } from "./LogsTab";
import { ProvidersTab } from "./ProvidersTab";
import { RequestsTab } from "./RequestsTab";
import { ResourcesTab } from "./ResourcesTab";
import { UsersTab } from "./UsersTab";
import { WorktreesTab } from "./WorktreesTab";

interface AdminProps {
  onBack?: () => void;
  section?: AdminSection;
  onNavigateSection?: (section: AdminSection) => void;
}

export function Admin({ onBack, section, onNavigateSection }: AdminProps) {
  const activeSection = section ?? "overview";

  return (
    <PageScaffold
      title="管理中心"
      description="把供应商、请求历史、资源监控与系统运维入口统一收口到一个管理中心，优先接真实 API 和真实刷新流。"
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
              description="查看真实运行状态、启动 / 停止与最近事件。"
              active={activeSection === "daemon"}
              onClick={() => onNavigateSection?.("daemon")}
            />
            <AdminEntryCard
              icon={Logs}
              title="日志"
              description="滚动查看真实日志文件尾部与刷新状态。"
              active={activeSection === "logs"}
              onClick={() => onNavigateSection?.("logs")}
            />
            <AdminEntryCard
              icon={Workflow}
              title="Worktree"
              description="查看真实 worktree 列表与变更计数。"
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
                平台面板已经把供应商、请求历史、资源监控、守护进程、日志和 Worktree 收到同一套管理导航里。
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>当前收口范围</CardTitle>
              <CardDescription>
                当前优先接入真实可验证的后台结构与刷新流；终端 / 容器等仍未验证的入口，会在子页里明确标为待接入。
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
      {activeSection === "daemon" && <DaemonTab />}
      {activeSection === "logs" && <LogsTab />}
      {activeSection === "worktrees" && <WorktreesTab />}
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
