import { Box, Workflow } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ContainerTab() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">Container / 容器</h2>
            <Badge variant="secondary">规划中</Badge>
            <Badge variant="outline">管理入口</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            这是 Admin 里的 container 管理入口。当前先放入口和说明，后续再接容器运行时与执行能力。
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Box className="size-4 text-primary" />
              入口状态
            </CardTitle>
            <CardDescription>当前没有接入真实容器后端，只先把入口挂到统一 Admin 导航体系里。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow
              title="接线状态"
              description="规划中，暂时不展示虚假的容器列表或按钮。"
              badge={<Badge variant="secondary">规划中</Badge>}
            />
            <StatusRow
              title="运行时能力"
              description="后续会接容器运行时、exec 调试和容器日志入口。"
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
            <CardDescription>这一版只确认容器入口的存在，后续能力再逐步接入。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow
              title="容器运行时"
              description="对接本地 Docker / 兼容运行时，提供统一可视化入口。"
              badge={<Badge variant="outline">规划中</Badge>}
            />
            <StatusRow
              title="exec / inspect"
              description="后续补上容器内命令执行与状态检查。"
              badge={<Badge variant="outline">规划中</Badge>}
            />
            <StatusRow
              title="容器日志"
              description="把容器输出接回 Admin 的统一日志与事件视图。"
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
