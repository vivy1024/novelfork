import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import { useWorkbenchMode } from "@/hooks/use-workbench-mode";

import { WorkbenchIntroEmptyState } from "./WorkbenchIntroEmptyState";

interface WorkbenchModeGateProps {
  children: ReactNode;
}

export function WorkbenchModeGate({ children }: WorkbenchModeGateProps) {
  const { enabled, loading, saving, setEnabled } = useWorkbenchMode();
  const markedIntroRef = useRef(false);

  useEffect(() => {
    if (loading || enabled || markedIntroRef.current) return;
    markedIntroRef.current = true;
    void fetchJson("/onboarding/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: { hasReadWorkbenchIntro: true },
      }),
    }).catch(() => undefined);
  }, [enabled, loading]);

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">正在读取工作台模式…</div>;
  }

  if (!enabled) {
    return <WorkbenchIntroEmptyState onEnable={() => setEnabled(true)} />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-900">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="font-medium">工作台模式已开启 · 请按会话权限执行工具</div>
            <p className="text-xs leading-5 text-amber-800/90">
              写作会话建议“允许编辑”，审稿会话建议“只读”，设定会话建议“逐项询问”，规划会话建议“规划模式”。Terminal / Shell、Browser 原始抓取、MCP、Admin、Pipeline 等高级入口只在这里暴露。
            </p>
            <p className="text-xs leading-5 text-amber-800/90">
              权限与风险：Shell 可执行本机命令，MCP 可连接本地/远端工具，诊断面板会显示本地路径、请求历史和日志。返回作者模式路径：点击右侧“切回作者模式”，这些 coder 向入口会在侧边栏与命令面板中隐藏。
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void setEnabled(false)} disabled={saving}>
            切回作者模式
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
