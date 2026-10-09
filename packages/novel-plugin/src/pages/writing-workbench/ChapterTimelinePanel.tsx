/**
 * 全书走势（左栏，约 2/3）：每章一行——
 * 「第 N 章 · 章名 · 一句摘要 · 字数 · 出场人物 · 新埋 n / 回收 n 伏笔」。
 *
 *  - 未结算的章（章号 > settledThrough）整行灰一些并带「未结算」文字标；
 *  - 摘要过期的章（summaryStale）标「以正文为准」；
 *  - 点一行展开该章的已结算事件列表（复用 narrative-memory/list 按章过滤）；
 *  - 初始定位在最新结算章附近（一章都没结算时落在最新一章）。
 *
 * 数据取不来（接口还没上线 / 返回结构不符）时显示空态，不补假数据。
 * 状态一律用「文字标签 + 色点」，不用彩色色块。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronRight, ListTree, Loader2 } from "lucide-react";

import {
  isChapterSettled,
  timelineAnchorChapter,
  useChapterEvents,
  useChapterTimeline,
  type ChapterTimeline,
  type ChapterTimelineChapter,
} from "./use-chapter-timeline";

export interface ChapterTimelinePanelProps {
  readonly bookId: string;
  readonly currentChapter?: number;
}

const STATUS_DOT: Record<string, string> = {
  unsettled: "bg-foreground/30",
  stale: "bg-amber-500",
};

function TextTag({ tone, children }: { readonly tone: "unsettled" | "stale"; readonly children: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-muted-foreground" data-testid={`chapter-timeline-tag-${tone}`}>
      <span className={`size-1.5 rounded-full ${STATUS_DOT[tone]}`} />
      {children}
    </span>
  );
}

function castLine(chapter: ChapterTimelineChapter): string {
  const names = chapter.cast.slice(0, 4).map((member) => member.name);
  const extra = chapter.cast.length > 4 ? chapter.cast.length - 4 + chapter.moreCast : chapter.moreCast;
  if (names.length === 0) return "";
  return `${names.join("、")}${extra > 0 ? ` 等 ${names.length + extra} 人` : ""}`;
}

// 内部事件类型名不能露给作者（术语纪律）：映射成中文标签，未知类型退化为原文。
const EVENT_TYPE_LABELS: Record<string, string> = {
  character_state_changed: "角色状态",
  relationship_changed: "关系",
  location_changed: "地点",
  hook_planted: "伏笔埋设",
  hook_progressed: "伏笔推进",
  hook_triggered: "伏笔触发",
  hook_resolved: "伏笔回收",
  world_fact_introduced: "世界事实",
  timeline_advanced: "时间推进",
};

function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

function ChapterEventList({ bookId, chapter }: { readonly bookId: string; readonly chapter: ChapterTimelineChapter }) {
  const { state } = useChapterEvents(bookId, chapter.number);

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-1.5 py-1.5 text-2xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> 正在读取本章事件…
      </div>
    );
  }
  if (state.status === "error") {
    // 列表取不通时不编数据：只退回到走势自带的计数。
    return (
      <p className="py-1.5 text-2xs text-muted-foreground" data-testid={`chapter-events-error-${chapter.number}`}>
        本章记录 {chapter.eventCount} 个事件，明细暂时取不回来。
      </p>
    );
  }
  if (state.events.length === 0) {
    return (
      <p className="py-1.5 text-2xs text-muted-foreground" data-testid={`chapter-events-empty-${chapter.number}`}>
        本章没有已结算的事件记录。
      </p>
    );
  }
  return (
    <ul className="space-y-1 py-1.5" data-testid={`chapter-events-${chapter.number}`}>
      {state.events.map((event) => (
        <li key={event.id} className="flex min-w-0 items-baseline gap-1.5 text-2xs">
          <span className="mt-0.5 size-1 shrink-0 rounded-full bg-foreground/50" />
          <span className="shrink-0 font-medium">{eventTypeLabel(event.eventType)}</span>
          <span className="min-w-0 truncate text-muted-foreground">
            {event.subject}{event.predicate ? ` ${event.predicate}` : ""}{event.object ? ` → ${event.object}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ChapterRow({
  bookId,
  timeline,
  chapter,
  isWriting,
  expanded,
  onToggle,
  rowRef,
}: {
  readonly bookId: string;
  readonly timeline: ChapterTimeline;
  readonly chapter: ChapterTimelineChapter;
  /** 作者正在写的章，带一场「在写」文字标。 */
  readonly isWriting: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly rowRef?: (node: HTMLLIElement | null) => void;
}) {
  const settled = isChapterSettled(timeline, chapter.number);
  const cast = castLine(chapter);
  return (
    <li data-testid="chapter-timeline-row" data-settled={settled ? "true" : "false"} ref={rowRef}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full flex-wrap items-baseline gap-x-2 rounded px-1.5 py-1 text-left text-2xs hover:bg-muted/60 ${settled ? "" : "opacity-70"}`}
        data-testid={`chapter-timeline-row-${chapter.number}`}
      >
        <ChevronRight className={`size-3 shrink-0 self-center text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        <span className="shrink-0 font-medium tabular-nums">第 {chapter.number} 章</span>
        {chapter.title ? <span className="max-w-28 shrink-0 truncate font-medium">{chapter.title}</span> : null}
        {isWriting ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-primary">
            <span className="size-1.5 rounded-full bg-primary" />在写
          </span>
        ) : null}
        {!settled ? <TextTag tone="unsettled">未结算</TextTag> : null}
        {chapter.summaryStale ? <TextTag tone="stale">以正文为准</TextTag> : null}
        <span className="min-w-0 flex-1 truncate text-muted-foreground" data-testid={`chapter-summary-${chapter.number}`}>
          {chapter.summary ?? "这一章还没有摘要"}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{chapter.chars} 字</span>
        {cast ? <span className="w-32 shrink-0 truncate text-muted-foreground" title={cast}>{cast}</span> : null}
        <span className="shrink-0 tabular-nums text-muted-foreground">
          新埋 {chapter.plantedHooks} / 回收 {chapter.recoveredHooks}
        </span>
      </button>
      {expanded ? (
        <div className="ml-7 border-l border-border/60 pl-3" data-testid={`chapter-events-pane-${chapter.number}`}>
          <ChapterEventList bookId={bookId} chapter={chapter} />
        </div>
      ) : null}
    </li>
  );
}

export function ChapterTimelinePanel({ bookId, currentChapter }: ChapterTimelinePanelProps) {
  const { state, reload } = useChapterTimeline(bookId);
  const [expanded, setExpanded] = useState<number | null>(null);
  const anchorRef = useRef<HTMLLIElement | null>(null);

  const anchor = useMemo(() => (state.status === "ready" ? timelineAnchorChapter(state.data) : null), [state]);
  const chapterTotal = state.status === "ready" ? state.data.chapters.length : 0;

  // 列表默认定位到最新结算章附近；jsdom 没有 scrollIntoView，守卫调用。
  useEffect(() => {
    if (anchor === null) return;
    anchorRef.current?.scrollIntoView?.({ block: "center" });
  }, [anchor, chapterTotal]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full min-h-24 items-center justify-center gap-2 text-2xs text-muted-foreground" data-testid="chapter-timeline-panel">
        <Loader2 className="size-3.5 animate-spin" /> 正在读取全书走势…
      </div>
    );
  }

  if (state.status === "error" || state.data.chapters.length === 0) {
    return (
      <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1.5 px-4 text-center" data-testid="chapter-timeline-empty">
        <AlertCircle className="size-5 text-muted-foreground" />
        <p className="text-2xs text-muted-foreground">
          这里按章排出全书走势——每章的摘要、卡司和伏笔账。走势接口暂时没读通
          {state.status === "ready" ? "（或本书还没有章节）。先写完第一章并结算，这里就会亮起来。" : `（${state.message}）。`}
        </p>
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 text-2xs text-muted-foreground hover:text-foreground"
          onClick={reload}
          data-testid="chapter-timeline-retry"
        >
          重试
        </button>
      </div>
    );
  }

  const timeline = state.data;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chapter-timeline-panel">
      <div className="flex items-center gap-1.5 px-1.5 pb-1 text-2xs text-muted-foreground">
        <ListTree className="size-3.5" />
        <span className="font-medium text-foreground">全书走势</span>
        <span className="truncate">
          每章一行：摘要 · 字数 · 出场 · 伏笔账{timeline.settledThrough !== null ? ` · 已结算到第 ${timeline.settledThrough} 章` : " · 还没有结算记录"}
        </span>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto" data-testid="chapter-timeline-list">
        {timeline.chapters.map((chapter) => (
          <ChapterRow
            key={chapter.number}
            bookId={bookId}
            timeline={timeline}
            chapter={chapter}
            isWriting={currentChapter === chapter.number}
            expanded={expanded === chapter.number}
            onToggle={() => setExpanded((value) => (value === chapter.number ? null : chapter.number))}
            {...(chapter.number === anchor ? { rowRef: (node) => { anchorRef.current = node; } } : {})}
          />
        ))}
      </ul>
    </div>
  );
}
