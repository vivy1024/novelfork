import { useMemo, useState } from "react";
import { ArrowUpDown, Archive, Bot, LayoutGrid, MessagesSquare, MonitorSmartphone, PlusCircle } from "lucide-react";

import { ChatWindowManager } from "@/components/ChatWindowManager";
import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewSessionDialog, SESSION_PRESETS, type NewSessionPayload, type SessionPresetId } from "@/components/sessions/NewSessionDialog";
import { fetchJson } from "@/hooks/use-api";
import { useSession } from "@/hooks/useSession";
import { useWindowStore } from "@/stores/windowStore";
import type { NarratorSessionChatSnapshot } from "@/shared/session-types";
import type { Theme } from "../hooks/use-theme";

export function SessionCenter({ theme }: { theme: Theme }) {
  const windows = useWindowStore((state) => state.windows);
  const activeWindowId = useWindowStore((state) => state.activeWindowId);
  const addWindow = useWindowStore((state) => state.addWindow);
  const updateWindow = useWindowStore((state) => state.updateWindow);
  const setActiveWindow = useWindowStore((state) => state.setActiveWindow);
  const toggleMinimize = useWindowStore((state) => state.toggleMinimize);
  const removeWindow = useWindowStore((state) => state.removeWindow);
  const { sessions, loaded, createSession, updateSession } = useSession();
  const connected = windows.filter((window) => window.wsConnected).length;
  const minimized = windows.filter((window) => window.minimized).length;
  const totalMessages = windows.reduce((sum, window) => sum + window.messages.length, 0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPreset, setDialogPreset] = useState<SessionPresetId>("writer");
  const [sessionFilter, setSessionFilter] = useState<"all" | "active" | "archived">("all");
  const [sessionSort, setSessionSort] = useState<"recent" | "title" | "messages">("recent");

  const activeWindow = windows.find((window) => window.id === activeWindowId) ?? windows[0] ?? null;
  const windowBySessionId = useMemo(
    () => new Map(windows.filter((window) => window.sessionId).map((window) => [window.sessionId!, window])),
    [windows],
  );

  const templateCards = useMemo(
    () =>
      SESSION_PRESETS.map((preset) => ({
        ...preset,
        affordance: preset.id === "writer" ? "直接开始写作" : preset.id === "planner" ? "先做结构规划" : preset.id === "auditor" ? "检查连续性" : "整理世界观",
      })),
    [],
  );

  const visibleSessions = useMemo(() => {
    const filtered = sessions.filter((session) => {
      if (sessionFilter === "all") {
        return true;
      }
      return session.status === sessionFilter;
    });

    return [...filtered].sort((left, right) => {
      if (sessionSort === "title") {
        return left.title.localeCompare(right.title, "zh-CN");
      }
      if (sessionSort === "messages") {
        return right.messageCount - left.messageCount;
      }
      return right.lastModified.getTime() - left.lastModified.getTime();
    });
  }, [sessions, sessionFilter, sessionSort]);

  const openSessionDialog = (presetId: SessionPresetId) => {
    setDialogPreset(presetId);
    setDialogOpen(true);
  };

  const handleCreateSession = async (payload: NewSessionPayload) => {
    const session = await createSession({
      title: payload.title,
      agentId: payload.agentId,
      sessionMode: payload.sessionMode,
    });

    addWindow({
      agentId: session.agentId,
      title: session.title,
      sessionId: session.id,
      sessionMode: session.sessionMode,
      sessionConfig: session.sessionConfig,
    });
  };

  const handleOpenSessionWorkspace = async (sessionId: string) => {
    const existingWindow = windowBySessionId.get(sessionId);
    if (existingWindow) {
      setActiveWindow(existingWindow.id);
      return;
    }

    const session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    let snapshotMessages: NarratorSessionChatSnapshot["messages"] = [];
    try {
      const snapshot = await fetchJson<NarratorSessionChatSnapshot>(`/api/sessions/${sessionId}/chat/state`);
      snapshotMessages = snapshot.messages;
    } catch {
      snapshotMessages = [];
    }

    addWindow({
      agentId: session.agentId,
      title: session.title,
      sessionId: session.id,
      sessionMode: session.sessionMode,
      sessionConfig: session.sessionConfig,
    });

    if (snapshotMessages.length > 0) {
      const createdWindow = useWindowStore.getState().windows.find((window) => window.sessionId === sessionId);
      if (createdWindow) {
        updateWindow(createdWindow.id, {
          messages: snapshotMessages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp,
          })),
        });
      }
    }
  };

  const handleToggleArchive = async (sessionId: string, nextStatus: "active" | "archived") => {
    await updateSession(sessionId, { status: nextStatus });
  };

  return (
    <>
      <PageScaffold
        title="会话中心"
        description="把每个窗口都当成一个可管理的会话对象：先选角色模板，再看状态、上下文和动作。右侧 ChatPanel 仍然保留，但这里只是辅助入口，正式组织方式以会话对象为主。"
        actions={
          <>
            <Badge variant="secondary">对象入口</Badge>
            <Badge variant="outline">角色模板</Badge>
            <Badge variant="outline">状态可见</Badge>
            <Button onClick={() => openSessionDialog("writer")}>
              <PlusCircle className="size-4" />
              新建会话
            </Button>
          </>
        }
        contentClassName="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SessionStat
            title="活跃会话"
            value={String(sessions.length > 0 ? sessions.filter((session) => session.status === "active").length : windows.length)}
            description={sessions.length > 0 ? "当前正式 session 中处于 active 的对象" : "当前已打开的工作台会话窗口"}
            icon={MessagesSquare}
          />
          <SessionStat
            title="在线连接"
            value={String(connected)}
            description="与后端保持连接的窗口数"
            icon={MonitorSmartphone}
          />
          <SessionStat
            title="最小化"
            value={String(minimized)}
            description="折叠中、等待继续处理的窗口"
            icon={LayoutGrid}
          />
          <SessionStat
            title="消息总数"
            value={String(totalMessages)}
            description="所有会话里累计的对话条数"
            icon={Bot}
          />
        </div>

        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <CardTitle className="flex items-center gap-2">
                  <PlusCircle className="size-5 text-primary" />
                  会话对象入口
                </CardTitle>
                <CardDescription>
                  先按使用意图选模板，再补标题与 Agent ID。这样创建出来的是对象，而不是一条孤立消息输入框。
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeWindow ? (
                  <Badge variant="secondary">当前聚焦：{activeWindow.title}</Badge>
                ) : (
                  <Badge variant="outline">暂无聚焦对象</Badge>
                )}
                <Badge variant="outline">正式入口在左侧导航</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {templateCards.map((preset) => {
              const Icon = preset.icon;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => openSessionDialog(preset.id)}
                  className="group rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:bg-muted/40 hover:shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{preset.label}</span>
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {preset.title}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">{preset.description}</p>
                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary/80">{preset.affordance}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>会话对象列表</CardTitle>
            <CardDescription>
              每个卡片都暴露标题、Agent、连接状态、消息数与快捷动作，方便把会话当成可操作的对象来管理。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loaded && sessions.length > 0 ? (
              <>
                <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <Button variant={sessionFilter === "all" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setSessionFilter("all")}>
                      全部
                    </Button>
                    <Button variant={sessionFilter === "active" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setSessionFilter("active")}>
                      仅看活跃
                    </Button>
                    <Button variant={sessionFilter === "archived" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setSessionFilter("archived")}>
                      仅看已归档
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ArrowUpDown className="size-3.5" />
                    排序
                    <select
                      aria-label="会话排序"
                      value={sessionSort}
                      onChange={(event) => setSessionSort(event.target.value as "recent" | "title" | "messages")}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                    >
                      <option value="recent">最近活动</option>
                      <option value="title">标题</option>
                      <option value="messages">消息数</option>
                    </select>
                  </label>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {visibleSessions.map((session) => {
                    const attachedWindow = windowBySessionId.get(session.id);
                    return (
                      <NarratorSessionCard
                        key={session.id}
                        title={session.title}
                        agentId={session.agentId}
                        status={session.status}
                        sessionMode={session.sessionMode}
                        model={session.sessionConfig.modelId}
                        messageCount={session.messageCount}
                        lastModified={session.lastModified}
                        attachedWindow={attachedWindow ? { id: attachedWindow.id, wsConnected: attachedWindow.wsConnected, minimized: attachedWindow.minimized } : null}
                        active={attachedWindow?.id === activeWindowId}
                        onOpenWorkspace={() => handleOpenSessionWorkspace(session.id)}
                        onToggleArchive={() => handleToggleArchive(session.id, session.status === "archived" ? "active" : "archived")}
                        onCloseWindow={attachedWindow ? () => removeWindow(attachedWindow.id) : undefined}
                      />
                    );
                  })}
                </div>
              </>
            ) : windows.length > 0 ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {windows.map((window) => (
                  <SessionObjectCard
                    key={window.id}
                    title={window.title}
                    agentId={window.agentId}
                    minimized={window.minimized}
                    wsConnected={window.wsConnected}
                    messageCount={window.messages.length}
                    position={window.position}
                    lastMessage={window.messages[window.messages.length - 1]}
                    active={window.id === activeWindowId}
                    onActivate={() => setActiveWindow(window.id)}
                    onToggleMinimize={() => toggleMinimize(window.id)}
                    onClose={() => removeWindow(window.id)}
                  />
                ))}
              </div>
            ) : (
              <PageEmptyState
                title="还没有会话对象"
                description="先从模板里创建一个 Writer、Planner、Auditor 或 Architect 会话，接着就可以在工作台里拖拽排布。"
                action={
                  <Button onClick={() => openSessionDialog("writer")}>
                    创建第一个会话
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="size-5 text-primary" />
              会话工作台
            </CardTitle>
            <CardDescription>
              这里保留多窗口排布能力，但它更像对象的可视化工作区，而不是唯一入口。
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[720px]">
            <ChatWindowManager theme={theme} onCreateWindow={() => openSessionDialog("writer")} />
          </CardContent>
        </Card>
      </PageScaffold>

      <NewSessionDialog
        open={dialogOpen}
        initialPresetId={dialogPreset}
        onOpenChange={setDialogOpen}
        onCreate={handleCreateSession}
      />
    </>
  );
}

function SessionStat({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof MessagesSquare;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

function NarratorSessionCard({
  title,
  agentId,
  status,
  sessionMode,
  model,
  messageCount,
  lastModified,
  attachedWindow,
  active,
  onOpenWorkspace,
  onToggleArchive,
  onCloseWindow,
}: {
  title: string;
  agentId: string;
  status: "active" | "archived";
  sessionMode: "chat" | "plan";
  model: string;
  messageCount: number;
  lastModified: Date;
  attachedWindow: { id: string; wsConnected: boolean; minimized: boolean } | null;
  active: boolean;
  onOpenWorkspace: () => void;
  onToggleArchive: () => void;
  onCloseWindow?: () => void;
}) {
  return (
    <Card className={active ? "border-primary/40 shadow-sm ring-1 ring-primary/10" : ""}>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{title}</CardTitle>
              <Badge variant={status === "active" ? "secondary" : "outline"}>{status === "active" ? "活跃" : "已归档"}</Badge>
              <Badge variant="outline">{sessionMode === "plan" ? "计划模式" : "对话模式"}</Badge>
              {attachedWindow && <Badge variant={attachedWindow.wsConnected ? "secondary" : "outline"}>{attachedWindow.wsConnected ? "在线" : "离线"}</Badge>}
              {active && <Badge>当前对象</Badge>}
            </div>
            <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
              <span>Agent {agentId}</span>
              <span>•</span>
              <span>{model}</span>
              <span>•</span>
              <span>{messageCount} 条消息</span>
            </CardDescription>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div>最近修改</div>
            <div className="font-medium text-foreground">{lastModified.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
          {attachedWindow
            ? `已关联工作台窗口 ${attachedWindow.id}${attachedWindow.minimized ? " · 已收起" : " · 展开中"}`
            : "当前尚未打开工作台窗口，可直接从这里进入会话工作区。"}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-8 px-3 text-xs" onClick={onOpenWorkspace}>
            {attachedWindow ? "聚焦工作台" : "打开工作台"}
          </Button>
          <Button variant="outline" className="h-8 px-3 text-xs" onClick={onToggleArchive}>
            <Archive className="size-3.5" />
            {status === "archived" ? "恢复" : "归档"}
          </Button>
          {onCloseWindow && (
            <Button variant="ghost" className="h-8 px-3 text-xs text-destructive hover:text-destructive" onClick={onCloseWindow}>
              关闭窗口
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SessionObjectCard({
  title,
  agentId,
  minimized,
  wsConnected,
  messageCount,
  position,
  lastMessage,
  active,
  onActivate,
  onToggleMinimize,
  onClose,
}: {
  title: string;
  agentId: string;
  minimized: boolean;
  wsConnected: boolean;
  messageCount: number;
  position: { x: number; y: number; w: number; h: number };
  lastMessage?: { content: string; timestamp: number };
  active: boolean;
  onActivate: () => void;
  onToggleMinimize: () => void;
  onClose: () => void;
}) {
  const positionLabel = `x:${position.x} y:${position.y} · ${position.w}×${position.h}`;
  const latestText = lastMessage?.content ? lastMessage.content : "暂无消息";
  const latestTime = lastMessage ? new Date(lastMessage.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";

  return (
    <Card className={active ? "border-primary/40 shadow-sm ring-1 ring-primary/10" : ""}>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{title}</CardTitle>
              {active && <Badge>当前对象</Badge>}
              <Badge variant={wsConnected ? "secondary" : "outline"}>{wsConnected ? "在线" : "离线"}</Badge>
              <Badge variant="outline">{minimized ? "已收起" : "展开中"}</Badge>
            </div>
            <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
              <span>Agent {agentId}</span>
              <span>•</span>
              <span>{messageCount} 条消息</span>
              <span>•</span>
              <span>{positionLabel}</span>
            </CardDescription>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div>最近活动</div>
            <div className="font-medium text-foreground">{latestTime}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">最新消息</p>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-foreground/90">{latestText}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-8 px-3 text-xs" onClick={onActivate}>
            聚焦
          </Button>
          <Button variant="outline" className="h-8 px-3 text-xs" onClick={onToggleMinimize}>
            {minimized ? "展开" : "收起"}
          </Button>
          <Button variant="ghost" className="h-8 px-3 text-xs text-destructive hover:text-destructive" onClick={onClose}>
            关闭
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
