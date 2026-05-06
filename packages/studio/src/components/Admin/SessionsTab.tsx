/**
 * Admin · 会话运行态
 *
 * 直接读取 `/api/sessions`、chat state 与 session tools 作为运行时事实源。
 * 不再把 ChatWindow/windowStore 当作 narrator session truth。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createFetchJsonContractClient,
  createSessionClient,
  type ContractResult,
} from "@/app-next/backend-contract";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecoveryBadge } from "@/components/RecoveryBadge";
import type { ToolConfirmationRequest } from "@/shared/agent-native-workspace";
import {
  getSessionPermissionModeLabel,
  type NarratorSessionChatMessage,
  type NarratorSessionChatSnapshot,
  type NarratorSessionRecord,
} from "@/shared/session-types";

type SessionsTabClient = Pick<ReturnType<typeof createSessionClient>, "listActiveSessions" | "getChatState" | "listPendingTools">;

interface SessionRuntimeRow {
  session: NarratorSessionRecord;
  chatState: NarratorSessionChatSnapshot | null;
  chatStateError: string | null;
  pendingTools: readonly ToolConfirmationRequest[];
  pendingToolsError: string | null;
}

export interface SessionsTabProps {
  readonly sessionClient?: SessionsTabClient;
}

function createDefaultSessionClient(): SessionsTabClient {
  return createSessionClient(createFetchJsonContractClient());
}

function contractErrorMessage(result: ContractResult<unknown>, fallback: string): string {
  if (result.ok) return fallback;
  const error = result.error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (record.error && typeof record.error === "object") {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
  }
  if (typeof error === "string") return error;
  return result.code ? `${fallback}：${result.code}` : fallback;
}

function sessionModelLabel(session: NarratorSessionRecord): string {
  const providerId = session.sessionConfig.providerId.trim();
  const modelId = session.sessionConfig.modelId.trim();
  if (!providerId && !modelId) return "未配置模型";
  if (!providerId) return modelId;
  if (!modelId) return providerId;
  return `${providerId}:${modelId}`;
}

function recentMessageSummary(messages: readonly NarratorSessionChatMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === "user" || item.role === "assistant");
  if (!message) return "无最近消息";
  return message.content.trim() || "空消息";
}

function runtimeRecoveryState(row: SessionRuntimeRow) {
  if (row.chatStateError || row.pendingToolsError) return "failed" as const;
  const pendingCount = row.pendingTools.length || row.session.recovery?.pendingToolCallCount || 0;
  return pendingCount > 0 ? "replaying" as const : "idle" as const;
}

async function loadRuntimeRow(sessionClient: SessionsTabClient, session: NarratorSessionRecord): Promise<SessionRuntimeRow> {
  const [chatStateResult, pendingToolsResult] = await Promise.all([
    sessionClient.getChatState<NarratorSessionChatSnapshot>(session.id),
    sessionClient.listPendingTools<{ pending: readonly ToolConfirmationRequest[] }>(session.id),
  ]);
  return {
    session,
    chatState: chatStateResult.ok ? chatStateResult.data : null,
    chatStateError: chatStateResult.ok ? null : contractErrorMessage(chatStateResult, "chat state 缺失"),
    pendingTools: pendingToolsResult.ok ? pendingToolsResult.data.pending : [],
    pendingToolsError: pendingToolsResult.ok ? null : contractErrorMessage(pendingToolsResult, "pending tools 缺失"),
  };
}

export function SessionsTab({ sessionClient: providedSessionClient }: SessionsTabProps = {}) {
  const sessionClient = useMemo(() => providedSessionClient ?? createDefaultSessionClient(), [providedSessionClient]);
  const [rows, setRows] = useState<SessionRuntimeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [activeResult, archivedResult] = await Promise.all([
      sessionClient.listActiveSessions<NarratorSessionRecord[]>({ status: "active" }),
      sessionClient.listActiveSessions<NarratorSessionRecord[]>({ status: "archived" }),
    ]);

    if (!activeResult.ok || !archivedResult.ok) {
      setRows([]);
      setError(contractErrorMessage(!activeResult.ok ? activeResult : archivedResult, "会话运行态加载失败"));
      setLoading(false);
      return;
    }

    const sessions = [...activeResult.data, ...archivedResult.data];
    const nextRows = await Promise.all(sessions.map((session) => loadRuntimeRow(sessionClient, session)));
    setRows(nextRows);
    setLoading(false);
  }, [sessionClient]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const activeCount = rows.filter((row) => row.session.status === "active").length;
  const archivedCount = rows.filter((row) => row.session.status === "archived").length;
  const pendingCount = rows.reduce((sum, row) => sum + (row.pendingTools.length || row.session.recovery?.pendingToolCallCount || 0), 0);
  const errorCount = rows.filter((row) => row.chatStateError || row.pendingToolsError).length;

  return (
    <div className="space-y-4" data-testid="admin-sessions-tab">
      <Card>
        <CardHeader>
          <CardTitle>会话运行态</CardTitle>
          <CardDescription>
            直接读取 <code className="rounded bg-muted px-1">/api/sessions</code>、chat state 与 session tools 的真实运行态，
            不再把 windowStore 或 ChatWindow 当作会话事实源。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatCell label="全部会话" value={rows.length} />
            <StatCell label="活跃" value={activeCount} emphasis={activeCount > 0 ? "ok" : undefined} />
            <StatCell label="已归档" value={archivedCount} />
            <StatCell label="待确认/异常" value={pendingCount + errorCount} emphasis={pendingCount + errorCount > 0 ? "warning" : "ok"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>会话明细</CardTitle>
          <CardDescription>每一行对应一个 narrator session record，并补充 chat state、pending tools 与 recovery metadata。</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          {rows.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">当前没有会话记录。</p>
          ) : null}
          {rows.length > 0 ? (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">会话</th>
                  <th className="py-2 pr-3 font-medium">代理 / 模型</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 pr-3 font-medium">运行态</th>
                  <th className="py-2 pr-3 font-medium">最近消息</th>
                  <th className="py-2 pr-3 font-medium">确认门 / 错误</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const session = row.session;
                  const pendingToolCount = row.pendingTools.length || session.recovery?.pendingToolCallCount || 0;
                  const pendingSummary = row.pendingTools[0]?.summary ?? session.recovery?.pendingToolCallSummary?.[0] ?? "无";
                  const recoveryState = runtimeRecoveryState(row);
                  return (
                    <tr key={session.id} className="border-b last:border-0" data-testid={`admin-session-row-${session.id}`}>
                      <td className="py-2 pr-3 align-top">
                        <div className="font-medium text-foreground">{session.title}</div>
                        <div className="font-mono text-xs text-muted-foreground">{session.id}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {session.projectId ? <Badge variant="outline">书籍 {session.projectId}</Badge> : null}
                          {session.chapterId ? <Badge variant="outline">章节 {session.chapterId}</Badge> : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3 align-top text-xs text-muted-foreground">
                        <div>{session.agentId}</div>
                        <div>{sessionModelLabel(session)}</div>
                        <div>{getSessionPermissionModeLabel(session.sessionConfig.permissionMode)}</div>
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <Badge variant={session.status === "active" ? "secondary" : "outline"}>{session.status === "active" ? "活跃" : "已归档"}</Badge>
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <RecoveryBadge recoveryState={recoveryState} wsConnected={!row.chatStateError} variant="chip" />
                        <div className="mt-1 text-xs text-muted-foreground">
                          seq {session.recovery?.lastAckedSeq ?? 0}/{session.recovery?.lastSeq ?? row.chatState?.cursor.lastSeq ?? 0}
                        </div>
                      </td>
                      <td className="max-w-[18rem] py-2 pr-3 align-top text-xs text-muted-foreground">
                        {row.chatState ? recentMessageSummary(row.chatState.messages) : "chat state 缺失"}
                      </td>
                      <td className="py-2 pr-3 align-top text-xs text-muted-foreground">
                        <div>未处理确认 {pendingToolCount}</div>
                        <div>{pendingSummary}</div>
                        {row.chatStateError ? <div className="text-destructive">chat state 缺失：{row.chatStateError}</div> : null}
                        {row.pendingToolsError ? <div className="text-destructive">pending tools 缺失：{row.pendingToolsError}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
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
