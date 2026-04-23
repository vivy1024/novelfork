/**
 * Admin · 会话窗口运行态
 *
 * Package 4 / 5.6d：把 windowStore + windowRuntimeStore 的运行时真相直接暴露在 Admin 里，
 * 让运维能看到每个打开的会话工作台窗口 (windowId / sessionId / 连接状态 / recovery 五态)
 * 并快速定位异常会话。所有徽标与文案都走共享的 windowRecoveryPresentation，
 * 与 SessionCenter 卡片、ChatWindow 头部保持同一套视觉与话术。
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getRecoveryPresentation,
  getRecoveryToneBadgeClassName,
} from "@/lib/windowRecoveryPresentation";
import { useWindowRuntimeStore } from "@/stores/windowRuntimeStore";
import { useWindowStore } from "@/stores/windowStore";

export function SessionsTab() {
  const windows = useWindowStore((state) => state.windows);
  const activeWindowId = useWindowStore((state) => state.activeWindowId);
  const wsConnections = useWindowRuntimeStore((state) => state.wsConnections);
  const recoveryStates = useWindowRuntimeStore((state) => state.recoveryStates);

  const total = windows.length;
  const connectedCount = windows.filter((window) => wsConnections[window.id] ?? false).length;
  const minimizedCount = windows.filter((window) => window.minimized).length;
  const nonIdleCount = windows.filter((window) => {
    const state = recoveryStates[window.id] ?? "idle";
    return state !== "idle";
  }).length;

  return (
    <div className="space-y-4" data-testid="admin-sessions-tab">
      <Card>
        <CardHeader>
          <CardTitle>会话窗口运行态</CardTitle>
          <CardDescription>
            直接映射 <code className="rounded bg-muted px-1">windowStore</code> +
            <code className="ml-1 rounded bg-muted px-1">windowRuntimeStore</code>
            的实时真相，不做额外推导。所有徽标与文案与 SessionCenter 卡片、ChatWindow 头部保持一致。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatCell label="打开的工作台" value={total} />
            <StatCell label="WebSocket 在线" value={connectedCount} emphasis={connectedCount < total ? "warning" : "ok"} />
            <StatCell label="已最小化" value={minimizedCount} />
            <StatCell label="过渡态窗口" value={nonIdleCount} emphasis={nonIdleCount > 0 ? "warning" : "ok"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>窗口明细</CardTitle>
          <CardDescription>
            每一行对应一个 ChatWindow 实例；recovery 态是 `WindowRecoveryState` 五态之一
            (idle / recovering / reconnecting / replaying / resetting)。
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {windows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              当前没有打开的会话工作台窗口。可在会话中心打开会话以出现条目。
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">窗口 ID</th>
                  <th className="py-2 pr-3 font-medium">会话 ID</th>
                  <th className="py-2 pr-3 font-medium">Agent</th>
                  <th className="py-2 pr-3 font-medium">模式</th>
                  <th className="py-2 pr-3 font-medium">连接 & 恢复态</th>
                  <th className="py-2 pr-3 font-medium">布局</th>
                  <th className="py-2 pr-3 font-medium">标记</th>
                </tr>
              </thead>
              <tbody>
                {windows.map((window) => {
                  const wsConnected = wsConnections[window.id] ?? false;
                  const recoveryState = recoveryStates[window.id] ?? "idle";
                  const presentation = getRecoveryPresentation({ recoveryState, wsConnected });
                  return (
                    <tr key={window.id} className="border-b last:border-0" data-testid={`admin-session-row-${window.id}`}>
                      <td className="py-2 pr-3 font-mono text-xs text-foreground">{window.id}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                        {window.sessionId ?? <span className="italic text-muted-foreground/70">(未绑定)</span>}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{window.agentId}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {window.sessionMode === "plan" ? "计划模式" : "对话模式"}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={getRecoveryToneBadgeClassName(presentation.tone)}>
                          {presentation.shortLabel}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                        {`x:${window.position.x} y:${window.position.y} w:${window.position.w} h:${window.position.h}`}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <div className="flex flex-wrap gap-1">
                          {window.minimized && <Badge variant="outline">已收起</Badge>}
                          {activeWindowId === window.id && <Badge>聚焦</Badge>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: "ok" | "warning";
}) {
  const numClassName =
    emphasis === "warning"
      ? "text-amber-600"
      : emphasis === "ok"
        ? "text-emerald-600"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${numClassName}`}>{value}</div>
    </div>
  );
}
