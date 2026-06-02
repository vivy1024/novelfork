/**
 * TodosSummaryBar — 显示当前会话的 TaskCreate todos 摘要
 *
 * 数据来源：
 * 1. 初始化时从 /api/sessions/:id 获取 todos
 * 2. 实时通过 DOM 自定义事件 "novelfork:todos-updated"（由 WS reducer 派发）更新
 */

import { useEffect, useState } from "react";
import type { SessionTodoItem } from "@/shared/session-types";

export interface TodosSummaryBarProps {
  sessionId: string;
}

export function TodosSummaryBar({ sessionId }: TodosSummaryBarProps) {
  const [todos, setTodos] = useState<SessionTodoItem[]>([]);

  // Fetch initial todos from session metadata
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { todos?: SessionTodoItem[] } | null) => {
        if (!cancelled && data?.todos?.length) {
          setTodos(data.todos);
        }
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Listen for real-time updates via DOM CustomEvent
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string; todos: SessionTodoItem[] }>).detail;
      if (detail.sessionId === sessionId) {
        setTodos(detail.todos);
      }
    };
    window.addEventListener("novelfork:todos-updated", handler);
    return () => window.removeEventListener("novelfork:todos-updated", handler);
  }, [sessionId]);

  if (!todos.length) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const pending = todos.filter((t) => t.status === "pending").length;

  return (
    <div className="shrink-0 border-t border-border/50 px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
      <span>📋</span>
      <span className="font-medium">
        {completed}/{todos.length} 完成
      </span>
      <span className="text-[10px]">
        {inProgress > 0 && <span className="text-blue-500">{inProgress} 进行中</span>}
        {inProgress > 0 && pending > 0 && " · "}
        {pending > 0 && <span>{pending} 待处理</span>}
      </span>
    </div>
  );
}
