import { Terminal, Workflow } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function TerminalTab() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">Terminal / 终端</h2>
            <Badge variant="outline">未接线</Badge>
            <Badge variant="secondary">管理入口</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            这是 Admin 里的 terminal 管理入口。当前只保留可见入口与状态，不伪造可交互 shell。
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Terminal className="size-4 text-primary" />
              入口状态
            </CardTitle>
            <CardDescription>当前还没有接入真实终端后端，只先把入口放进统一 Admin 导航。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow
              title="接线状态"
              description="未接线，暂时不能打开真正的 shell 会话。"
              badge={<Badge variant="outline">未接线</Badge>}
            />
            <StatusRow
              title="终端输出"
              description="后续会接 stdout / stderr 回显，并回流到管理面板。"
              badge={<Badge variant="outline">待接入</Badge>}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Workflow className="size-4 text-primary" />
              后续接入能力
            </CardTitle>
            <CardDescription>只列出后续会接的运行时能力，不在这一刀里伪造完整终端。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow
              title="本地 shell"
              description="把受控命令执行接到本地 shell 会话。"
              badge={<Badge variant="outline">规划中</Badge>}
            />
            <StatusRow
              title="任务联动"
              description="为 daemon / worktree 提供临时调试和执行入口。"
              badge={<Badge variant="outline">规划中</Badge>}
            />
            <StatusRow
              title="运行时事件"
              description="把命令输出和状态变化接进 Admin 的统一事件流。"
              badge={<Badge variant="outline">规划中</Badge>}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusRow({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {badge}
      </div>
    </div>
  );
}
