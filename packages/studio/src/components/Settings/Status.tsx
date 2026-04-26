import { useEffect, useState } from "react";
import { Activity, TimerReset } from "lucide-react";

import { ReleaseOverview } from "@/components/Settings/ReleaseOverview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface StatusProps {
  theme: "light" | "dark";
}

export function Status({ theme }: StatusProps) {
  const [uptimeSeconds, setUptimeSeconds] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUptimeSeconds((prev) => prev + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">系统状态</h2>
          <p className="text-sm text-muted-foreground">把版本、运行时与更新节奏放到作者看得懂的位置，先确认自己手上的工作台来自哪里。</p>
        </div>
        <div className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
          当前主题：{theme === "dark" ? "深色" : "浅色"}
        </div>
      </div>

      <ReleaseOverview variant="status" />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-primary" />
            本页运行状态
          </CardTitle>
          <CardDescription>这里显示的是当前设置页这次打开后的本地会话时长，方便判断你看到的状态是否来自最新一轮检查。</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TimerReset className="size-4 text-primary" />
              页面在线时长
            </div>
            <p className="mt-3 text-2xl font-semibold text-foreground">{formatUptime(uptimeSeconds)}</p>
            <p className="mt-2 text-xs text-muted-foreground">如果你刚切换了工作区、运行模式或桌面壳构建，刷新本页即可重新拉取版本快照。</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function formatUptime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours}h ${minutes}m ${remainingSeconds}s`;
}
