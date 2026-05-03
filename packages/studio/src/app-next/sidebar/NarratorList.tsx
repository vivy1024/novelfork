/**
 * NarratorList — 叙述者会话列表
 *
 * 显示活跃会话列表，支持点击切换、新建、清理。
 * 作为 Sidebar 叙述者区域的内容组件。
 */

import { Plus, Trash2 } from "lucide-react";

export interface NarratorSession {
  readonly id: string;
  readonly title: string;
  readonly status: "active" | "archived";
  readonly projectId?: string;
  readonly projectName?: string;
  readonly agentId?: string;
  readonly lastModified?: string;
}

export interface NarratorListProps {
  /** 会话列表 */
  readonly sessions: readonly NarratorSession[];
  /** 当前选中的会话 ID */
  readonly activeSessionId: string | null;
  /** 点击会话 */
  readonly onSessionClick: (sessionId: string) => void;
  /** 新建会话 */
  readonly onNewSession?: () => void;
  /** 清理空闲会话 */
  readonly onCleanup?: () => void;
}

export function NarratorList({
  sessions,
  activeSessionId,
  onSessionClick,
  onNewSession,
  onCleanup,
}: NarratorListProps) {
  const activeSessions = sessions.filter((s) => s.status === "active");

  return (
    <div className="space-y-1">
      {activeSessions.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">暂无活跃会话</p>
      ) : (
        activeSessions.map((session) => (
          <button
            key={session.id}
            type="button"
            aria-current={activeSessionId === session.id ? "page" : undefined}
            className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left transition ${
              activeSessionId === session.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            onClick={() => onSessionClick(session.id)}
          >
            <span className="truncate text-xs font-medium">{session.title}</span>
            {session.projectName && (
              <span className="truncate text-[10px] opacity-60">{session.projectName}</span>
            )}
          </button>
        ))
      )}
    </div>
  );
}

/** 叙述者区域的操作按钮 */
export function NarratorActions({
  onNewSession,
  onCleanup,
}: {
  readonly onNewSession?: () => void;
  readonly onCleanup?: () => void;
}) {
  return (
    <>
      {onNewSession && (
        <button
          type="button"
          aria-label="新建会话"
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onNewSession}
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {onCleanup && (
        <button
          type="button"
          aria-label="清空空闲叙述者"
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onCleanup}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </>
  );
}
