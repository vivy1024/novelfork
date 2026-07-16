import { useState } from "react";
import { BookOpen, Clock3, GripVertical, MessageSquareText, Pin, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  recentTabKey,
  recentTabNarratorId,
  type ShellRecentTabItem,
  type ShellSessionItem,
} from "./shell-route";

export interface ResolvedRecentNarrator {
  readonly tab: ShellRecentTabItem;
  readonly narratorId: string;
  readonly session: ShellSessionItem | null;
}

export function resolveRecentNarrators(
  recentTabs: readonly ShellRecentTabItem[],
  sessions: readonly ShellSessionItem[],
): ResolvedRecentNarrator[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  return recentTabs
    .map((tab) => {
      const narratorId = recentTabNarratorId(tab);
      if (!narratorId) return null;
      return { tab, narratorId, session: sessionsById.get(narratorId) ?? null };
    })
    .filter((entry): entry is ResolvedRecentNarrator => entry !== null);
}

export interface NarratorWorkspaceDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly activeNarratorId?: string;
  readonly recentTabs: readonly ShellRecentTabItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly onOpenNarrator: (narratorId: string) => void;
  readonly onRemoveRecentTab?: (tab: ShellRecentTabItem) => void;
  readonly onPinRecentTab?: (tab: ShellRecentTabItem, pinned: boolean) => void;
  readonly onMoveRecentTab?: (tab: ShellRecentTabItem, target: ShellRecentTabItem) => void;
  readonly onClearInactiveRecentTabs?: () => void;
}

function SessionButton({
  session,
  active,
  onClick,
}: {
  readonly session: ShellSessionItem;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-auto w-full justify-start gap-2 px-3 py-2 text-left",
        active && "bg-primary/10 text-primary",
      )}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {session.projectId ? <BookOpen className="size-4 shrink-0" /> : <MessageSquareText className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{session.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {session.projectName ? `书籍 · ${session.projectName}` : "独立叙述者"}
        </span>
      </span>
      {session.working ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" aria-label="工作中" /> : null}
      {!session.working && session.unread ? <span className="size-2 shrink-0 rounded-full bg-muted-foreground" aria-label="未读" /> : null}
    </Button>
  );
}

export function NarratorWorkspaceDrawer({
  open,
  onOpenChange,
  activeNarratorId,
  recentTabs,
  sessions,
  onOpenNarrator,
  onRemoveRecentTab,
  onPinRecentTab,
  onMoveRecentTab,
  onClearInactiveRecentTabs,
}: NarratorWorkspaceDrawerProps) {
  const recentNarrators = resolveRecentNarrators(recentTabs, sessions);
  const activeSessions = sessions.filter((session) => session.status === "active");
  const standaloneSessions = activeSessions.filter((session) => !session.projectId);
  const bookSessions = activeSessions.filter((session) => !!session.projectId);
  const [draggedRecentTabKey, setDraggedRecentTabKey] = useState<string | null>(null);
  const [dropTargetRecentTabKey, setDropTargetRecentTabKey] = useState<string | null>(null);
  const recentTabsByKey = new Map(recentTabs.map((tab) => [recentTabKey(tab), tab]));

  const clearRecentDrag = () => {
    setDraggedRecentTabKey(null);
    setDropTargetRecentTabKey(null);
  };

  const openNarrator = (narratorId: string) => {
    onOpenChange(false);
    onOpenNarrator(narratorId);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(24rem,calc(100vw-1rem))] gap-0 overflow-hidden p-0 sm:max-w-md"
        data-testid="narrator-workspace-drawer"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle>会话工作区</SheetTitle>
          <SheetDescription>切换最近叙述者，或从完整会话列表继续工作。</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
          <section aria-label="最近标签" className="space-y-1">
            <div className="flex items-center justify-between px-1 py-1">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Clock3 className="size-3.5" />
                最近标签
              </h2>
              {recentNarrators.length > 0 && onClearInactiveRecentTabs ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="清理不活跃最近标签"
                  title="清理不活跃最近标签"
                  onClick={onClearInactiveRecentTabs}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>

            {recentNarrators.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">暂无最近会话</p>
            ) : recentNarrators.map(({ tab, narratorId, session }) => {
              const active = narratorId === activeNarratorId;
              const stale = session === null || session.status !== "active";
              const tabKey = recentTabKey(tab);
              return (
                <div
                  key={tabKey}
                  className={cn(
                    "group flex items-center rounded-md",
                    active ? "bg-primary/10" : "hover:bg-muted",
                    stale && "opacity-70",
                    draggedRecentTabKey === tabKey && "opacity-50",
                    dropTargetRecentTabKey === tabKey && "ring-1 ring-primary/60",
                  )}
                  draggable={Boolean(onMoveRecentTab)}
                  onDragStart={(event) => {
                    if (!onMoveRecentTab) return;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", tabKey);
                    setDraggedRecentTabKey(tabKey);
                  }}
                  onDragOver={(event) => {
                    if (!onMoveRecentTab) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const source = draggedRecentTabKey ? recentTabsByKey.get(draggedRecentTabKey) : undefined;
                    setDropTargetRecentTabKey(source && source.pinned === tab.pinned ? tabKey : null);
                  }}
                  onDrop={(event) => {
                    if (!onMoveRecentTab) return;
                    event.preventDefault();
                    const source = draggedRecentTabKey ? recentTabsByKey.get(draggedRecentTabKey) : undefined;
                    if (source && source.pinned === tab.pinned && recentTabKey(source) !== tabKey) onMoveRecentTab(source, tab);
                    clearRecentDrag();
                  }}
                  onDragEnd={clearRecentDrag}
                >
                  {onMoveRecentTab ? <GripVertical className="ml-1 size-3 shrink-0 cursor-grab text-muted-foreground/70" aria-hidden="true" /> : null}
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                    disabled={stale}
                    aria-current={active ? "page" : undefined}
                    onClick={() => openNarrator(narratorId)}
                  >
                    <span className="block truncate text-sm font-medium">{tab.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {stale
                        ? "会话已失效，可关闭此最近项"
                        : session.projectName
                          ? `书籍 · ${session.projectName}`
                          : "独立叙述者"}
                    </span>
                  </button>
                  {onPinRecentTab ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-5 shrink-0 text-muted-foreground hover:text-primary"
                      aria-label={`${tab.pinned ? "取消置顶" : "置顶"}最近项 ${tab.title}`}
                      title={tab.pinned ? "取消置顶" : "置顶"}
                      onClick={() => onPinRecentTab(tab, !tab.pinned)}
                    >
                      <Pin className={cn("size-3", tab.pinned && "fill-current")} />
                    </Button>
                  ) : null}
                  {onRemoveRecentTab ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="mr-1 shrink-0 text-muted-foreground"
                      aria-label={`关闭最近项 ${tab.title}`}
                      onClick={() => onRemoveRecentTab(tab)}
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </section>

          <section aria-label="独立叙述者" className="mt-5 space-y-1">
            <h2 className="px-1 py-1 text-xs font-semibold text-muted-foreground">独立叙述者</h2>
            {standaloneSessions.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">暂无独立会话</p>
            ) : standaloneSessions.map((session) => (
              <SessionButton
                key={session.id}
                session={session}
                active={session.id === activeNarratorId}
                onClick={() => openNarrator(session.id)}
              />
            ))}
          </section>

          {bookSessions.length > 0 ? (
            <section aria-label="书籍叙述者" className="mt-5 space-y-1">
              <h2 className="px-1 py-1 text-xs font-semibold text-muted-foreground">书籍叙述者</h2>
              {bookSessions.map((session) => (
                <SessionButton
                  key={session.id}
                  session={session}
                  active={session.id === activeNarratorId}
                  onClick={() => openNarrator(session.id)}
                />
              ))}
            </section>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
