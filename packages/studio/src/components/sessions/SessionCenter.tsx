import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchJson } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import {
  getSessionPermissionModeLabel,
  type NarratorSessionRecord,
  type NarratorSessionStatus,
} from "@/shared/session-types";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export type SessionCenterBindingFilter = "all" | "standalone" | "book" | "chapter";

export interface SessionCenterProps {
  readonly className?: string;
  readonly initialBinding?: SessionCenterBindingFilter;
  readonly initialStatus?: NarratorSessionStatus;
  readonly onOpenSession: (session: NarratorSessionRecord) => void;
}

const BINDING_FILTERS: ReadonlyArray<{ value: SessionCenterBindingFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "standalone", label: "独立会话" },
  { value: "book", label: "书籍绑定" },
  { value: "chapter", label: "章节绑定" },
];

const STATUS_FILTERS: ReadonlyArray<{ value: NarratorSessionStatus; label: string }> = [
  { value: "active", label: "活跃" },
  { value: "archived", label: "已归档" },
];

function sessionBindingLabel(session: NarratorSessionRecord): string {
  if (session.chapterId) return "章节绑定";
  if (session.projectId) return "书籍绑定";
  return "独立会话";
}

function sessionModelLabel(session: NarratorSessionRecord): string {
  const providerId = session.sessionConfig.providerId.trim();
  const modelId = session.sessionConfig.modelId.trim();
  if (!providerId && !modelId) return "未配置模型";
  if (!providerId) return modelId;
  if (!modelId) return providerId;
  return `${providerId}:${modelId}`;
}

function sessionStatusLabel(status: NarratorSessionStatus): string {
  return status === "archived" ? "已归档" : "活跃";
}

function createSessionListPath(input: {
  readonly binding: SessionCenterBindingFilter;
  readonly status: NarratorSessionStatus;
  readonly search: string;
}): string {
  const params = new URLSearchParams();
  params.set("sort", "recent");
  params.set("status", input.status);
  if (input.binding !== "all") params.set("binding", input.binding);
  const search = input.search.trim();
  if (search) params.set("search", search);
  return `/api/sessions?${params.toString()}`;
}

export function SessionCenter({ className, initialBinding = "all", initialStatus = "active", onOpenSession }: SessionCenterProps) {
  const [binding, setBinding] = useState<SessionCenterBindingFilter>(initialBinding);
  const [status, setStatus] = useState<NarratorSessionStatus>(initialStatus);
  const [search, setSearch] = useState("");
  const [sessions, setSessions] = useState<NarratorSessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listPath = useMemo(() => createSessionListPath({ binding, status, search }), [binding, status, search]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<NarratorSessionRecord[]>(listPath);
      setSessions(Array.isArray(response) ? response : []);
    } catch (loadError) {
      setSessions([]);
      setError(loadError instanceof Error ? loadError.message : "会话列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [listPath]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const updateSessionStatus = async (session: NarratorSessionRecord, nextStatus: NarratorSessionStatus) => {
    await fetchJson<NarratorSessionRecord>(`/api/sessions/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    await loadSessions();
  };

  return (
    <section className={cn("space-y-4", className)} aria-label="会话中心">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">会话中心</h2>
          <p className="text-sm text-muted-foreground">管理独立、书籍绑定和章节绑定的长期 Agent 会话；归档不会删除历史。</p>
        </div>
        <div className="text-xs text-muted-foreground">{loading ? "正在刷新…" : `当前 ${sessions.length} 个会话`}</div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <label className="block space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">搜索会话</span>
            <input
              aria-label="搜索会话"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="按标题、Agent、模型、书籍或章节搜索"
              value={search}
            />
          </label>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2" aria-label="会话状态筛选">
              {STATUS_FILTERS.map((item) => (
                <Button key={item.value} type="button" size="sm" variant={status === item.value ? "default" : "outline"} onClick={() => setStatus(item.value)}>
                  {item.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" aria-label="会话绑定筛选">
              {BINDING_FILTERS.map((item) => (
                <Button key={item.value} type="button" size="sm" variant={binding === item.value ? "default" : "outline"} onClick={() => setBinding(item.value)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <div className="space-y-3">
        {sessions.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">没有匹配的会话。</div>
        ) : null}
        {sessions.map((session) => {
          const pendingCount = session.recovery?.pendingToolCallCount ?? 0;
          const lastFailure = session.recovery?.lastFailure;
          return (
            <article key={session.id} data-testid={`session-center-row-${session.id}`} className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{session.title}</h3>
                    <Badge variant={session.status === "archived" ? "outline" : "secondary"}>{sessionStatusLabel(session.status)}</Badge>
                    <Badge variant="outline">{sessionBindingLabel(session)}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Agent：{session.agentId}</span>
                    <span>模型：{sessionModelLabel(session)}</span>
                    <span>权限：{getSessionPermissionModeLabel(session.sessionConfig.permissionMode)}</span>
                    <span>模式：{session.sessionMode === "plan" ? "计划模式" : "对话模式"}</span>
                    <span>消息：{session.messageCount}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant={pendingCount > 0 ? "destructive" : "outline"}>未处理确认 {pendingCount}</Badge>
                    {session.projectId ? <Badge variant="outline">书籍 {session.projectId}</Badge> : null}
                    {session.chapterId ? <Badge variant="outline">章节 {session.chapterId}</Badge> : null}
                  </div>
                  {lastFailure ? (
                    <p className="text-xs text-destructive">最近失败：{lastFailure.reason} · {lastFailure.message}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">最近失败：无</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => onOpenSession(session)}>打开</Button>
                  {session.status === "archived" ? (
                    <Button type="button" size="sm" onClick={() => void updateSessionStatus(session, "active")}>恢复</Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => void updateSessionStatus(session, "archived")}>归档</Button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
