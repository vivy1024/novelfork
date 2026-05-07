import { useCallback, useEffect, useMemo, useState } from "react";

import { createFetchJsonContractClient, createSessionClient, type ContractResult } from "@/app-next/backend-contract";
import { cn } from "@/lib/utils";
import {
  getSessionPermissionModeLabel,
  type NarratorSessionRecord,
  type NarratorSessionStatus,
} from "@/shared/session-types";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { NewSessionDialog, type NewSessionPayload } from "./NewSessionDialog";

export type SessionCenterBindingFilter = "all" | "standalone" | "book" | "chapter";
export type SessionCenterSortMode = "recent" | "lastModified-desc" | "manual";

type SessionCenterClient = Pick<ReturnType<typeof createSessionClient>, "listActiveSessions" | "updateSession" | "continueLatestSession" | "forkSession" | "getMemoryStatus" | "createSession">;

type SessionMemoryBoundaryStatus = {
  readonly ok: true;
  readonly sessionId: string;
  readonly status: "writable" | "readonly";
  readonly writable: boolean;
  readonly reason?: "memory_writer_not_configured";
};

interface SessionLifecyclePayload {
  readonly ok: true;
  readonly readonly: boolean;
  readonly session: NarratorSessionRecord;
  readonly snapshot?: {
    readonly session?: NarratorSessionRecord;
  };
}

export interface SessionCenterProps {
  readonly className?: string;
  readonly initialBinding?: SessionCenterBindingFilter;
  readonly initialStatus?: NarratorSessionStatus;
  readonly projectId?: string;
  readonly chapterId?: string;
  readonly sessionClient?: SessionCenterClient;
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

const SORT_MODES: ReadonlyArray<{ value: SessionCenterSortMode; label: string }> = [
  { value: "recent", label: "最近活动优先" },
  { value: "lastModified-desc", label: "最后消息优先" },
  { value: "manual", label: "手动顺序" },
];

function formatSessionDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

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

function createDefaultSessionClient(): SessionCenterClient {
  return createSessionClient(createFetchJsonContractClient());
}

function sessionClientErrorMessage(result: ContractResult<unknown>, fallback: string): string {
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

function sessionListQuery(input: {
  readonly binding: SessionCenterBindingFilter;
  readonly status: NarratorSessionStatus;
  readonly search: string;
  readonly sort: SessionCenterSortMode;
}): { status: NarratorSessionStatus; binding?: string; search?: string; sort?: string } {
  const query: { status: NarratorSessionStatus; binding?: string; search?: string; sort?: string } = { status: input.status };
  if (input.binding !== "all") query.binding = input.binding;
  if (input.sort !== "recent") query.sort = input.sort;
  const search = input.search.trim();
  if (search) query.search = search;
  return query;
}

export function SessionCenter({ className, initialBinding = "all", initialStatus = "active", projectId, chapterId, sessionClient: providedSessionClient, onOpenSession }: SessionCenterProps) {
  const [binding, setBinding] = useState<SessionCenterBindingFilter>(initialBinding);
  const [status, setStatus] = useState<NarratorSessionStatus>(initialStatus);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SessionCenterSortMode>("recent");
  const [sessions, setSessions] = useState<NarratorSessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoryStatusBySessionId, setMemoryStatusBySessionId] = useState<Record<string, SessionMemoryBoundaryStatus>>({});
  const [forkTarget, setForkTarget] = useState<NarratorSessionRecord | null>(null);
  const [forkTitle, setForkTitle] = useState("");
  const [inheritanceNote, setInheritanceNote] = useState("");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const sessionClient = useMemo(() => providedSessionClient ?? createDefaultSessionClient(), [providedSessionClient]);

  const listQuery = useMemo(() => sessionListQuery({ binding, status, search, sort }), [binding, status, search, sort]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await sessionClient.listActiveSessions<NarratorSessionRecord[]>(listQuery);
    if (result.ok) {
      const records = Array.isArray(result.data) ? result.data : [];
      setSessions(records);
      const statuses = await Promise.all(records.map(async (session) => {
        const statusResult = await sessionClient.getMemoryStatus<SessionMemoryBoundaryStatus>(session.id);
        return statusResult.ok ? [session.id, statusResult.data] as const : null;
      }));
      setMemoryStatusBySessionId(Object.fromEntries(statuses.filter((item): item is readonly [string, SessionMemoryBoundaryStatus] => Boolean(item))));
      setLoading(false);
      return;
    }
    setSessions([]);
    setMemoryStatusBySessionId({});
    setError(sessionClientErrorMessage(result, "会话列表加载失败"));
    setLoading(false);
  }, [listQuery, sessionClient]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const openLifecyclePayload = (payload: SessionLifecyclePayload) => {
    onOpenSession(payload.snapshot?.session ?? payload.session);
  };

  const continueLatest = async () => {
    setLifecycleBusy(true);
    setError(null);
    const result = await sessionClient.continueLatestSession<SessionLifecyclePayload>(projectId, chapterId);
    if (result.ok) {
      openLifecyclePayload(result.data);
      setLifecycleBusy(false);
      return;
    }
    setError(sessionClientErrorMessage(result, "继续最近会话失败"));
    setLifecycleBusy(false);
  };

  const updateSessionStatus = async (session: NarratorSessionRecord, nextStatus: NarratorSessionStatus) => {
    setError(null);
    const result = await sessionClient.updateSession(session.id, { status: nextStatus });
    if (!result.ok) {
      setError(sessionClientErrorMessage(result, nextStatus === "archived" ? "会话归档失败" : "会话恢复失败"));
      return;
    }
    await loadSessions();
  };

  const beginFork = (session: NarratorSessionRecord) => {
    setError(null);
    setForkTarget(session);
    setForkTitle(`${session.title} fork`);
    setInheritanceNote("");
  };

  const cancelFork = () => {
    setForkTarget(null);
    setForkTitle("");
    setInheritanceNote("");
  };

  const createFork = async () => {
    if (!forkTarget) return;
    setLifecycleBusy(true);
    setError(null);
    const title = forkTitle.trim();
    const note = inheritanceNote.trim();
    const result = await sessionClient.forkSession<SessionLifecyclePayload>(forkTarget.id, {
      ...(title ? { title } : {}),
      ...(note ? { inheritanceNote: note } : {}),
    });
    if (result.ok) {
      openLifecyclePayload(result.data);
      cancelFork();
      setLifecycleBusy(false);
      return;
    }
    setError(sessionClientErrorMessage(result, "Fork 会话失败"));
    setLifecycleBusy(false);
  };

  const createIndependentSession = async (payload: NewSessionPayload) => {
    setLifecycleBusy(true);
    setError(null);
    const result = await sessionClient.createSession<NarratorSessionRecord>({
      title: payload.title,
      agentId: payload.agentId,
      kind: "standalone",
      sessionMode: payload.sessionMode,
      worktree: payload.worktree,
      sessionConfig: payload.sessionConfig,
    });
    if (result.ok) {
      setNewSessionOpen(false);
      onOpenSession(result.data);
      setLifecycleBusy(false);
      return;
    }
    setError(sessionClientErrorMessage(result, "新建叙述者失败"));
    setLifecycleBusy(false);
  };

  return (
    <section className={cn("space-y-4", className)} aria-label="会话中心">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">会话中心</h2>
          <p className="text-sm text-muted-foreground">管理独立、书籍绑定和章节绑定的长期 Agent 会话；归档不会删除历史。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setNewSessionOpen(true)} disabled={lifecycleBusy}>
            新建叙述者
          </Button>
          <Button type="button" size="sm" onClick={() => void continueLatest()} disabled={lifecycleBusy}>
            继续最近会话
          </Button>
          <div className="text-xs text-muted-foreground">{loading ? "正在刷新…" : `当前 ${sessions.length} 个会话`}</div>
        </div>
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
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">排序会话</span>
              <select
                aria-label="排序会话"
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                onChange={(event) => setSort(event.target.value as SessionCenterSortMode)}
                value={sort}
              >
                {SORT_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
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
          const memoryStatus = memoryStatusBySessionId[session.id];
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
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>工作目录：{session.worktree ?? "未绑定工作目录"}</span>
                    <span>创建：{formatSessionDate(session.createdAt)}</span>
                    <span>最后消息：{formatSessionDate(session.lastModified)}</span>
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
                  {memoryStatus ? (
                    <div className="rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                      <p>{memoryStatus.writable ? "Memory：可审计写入" : "Memory：只读（未接入写入器）"}</p>
                      <p>临时剧情草稿不会自动写入长期 memory；偏好/项目事实写入需审计来源。</p>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => onOpenSession(session)}>打开</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => beginFork(session)}>Fork</Button>
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

      <NewSessionDialog open={newSessionOpen} onOpenChange={setNewSessionOpen} onCreate={(payload) => void createIndependentSession(payload)} />

      {forkTarget ? (
        <div role="dialog" aria-label="Fork 会话" className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Fork 会话</h3>
            <p className="text-xs text-muted-foreground">从「{forkTarget.title}」创建新会话，只继承摘要和必要上下文。</p>
          </div>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Fork 标题</span>
              <input
                aria-label="Fork 标题"
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                onChange={(event) => setForkTitle(event.target.value)}
                value={forkTitle}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">继承说明</span>
              <textarea
                aria-label="继承说明"
                className="min-h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                onChange={(event) => setInheritanceNote(event.target.value)}
                placeholder="例如：保留伏笔、人物关系或本章目标"
                value={inheritanceNote}
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={cancelFork} disabled={lifecycleBusy}>取消</Button>
              <Button type="button" size="sm" onClick={() => void createFork()} disabled={lifecycleBusy}>创建 fork</Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
