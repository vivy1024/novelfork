/**
 * StoryMapCanvas — 章 × 线索情节板
 *
 * X 轴是章，Y 轴是冲突 / 伏笔 / 角色弧线。格子是该线索在该章的节拍。
 * 不再把章节、冲突、伏笔、弧线混成一张 DAG。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Columns3,
  FilePlus2,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import type { NarrativeLineSnapshot } from "../../handlers/narrative-line-types";
import {
  beatsForChapter,
  buildStoryMapPlanPrompt,
  computeMissingPlanningKinds,
  hasPlanningNodes,
  snapshotToPlotBoard,
  storyMapBeatToNodeData,
  type StoryMapBeat,
  type StoryMapBoard,
  type StoryMapNodeData,
  type StoryMapThread,
  type StoryMapThreadKind,
} from "./story-map-board";

export {
  buildStoryMapPlanPrompt,
  computeMissingPlanningKinds,
  hasPlanningNodes,
  resolveStoryMapLane,
  snapshotToPlotBoard,
  type MissingPlanningKind,
  type StoryMapBoard,
  type StoryMapLane,
  type StoryMapNodeData,
  type StoryMapThread,
  type StoryMapThreadKind,
} from "./story-map-board";

const THREAD_TONE: Record<StoryMapThreadKind, string> = {
  conflict: "border-rose-500/40 bg-rose-500/[0.06] text-rose-700 dark:text-rose-300",
  foreshadow: "border-sky-500/40 bg-sky-500/[0.06] text-sky-700 dark:text-sky-300",
  character_arc: "border-amber-500/40 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300",
};

const THREAD_LABEL: Record<StoryMapThreadKind, string> = {
  conflict: "冲突",
  foreshadow: "伏笔",
  character_arc: "弧线",
};

/** 兼容旧测试：情节板不再产出 React Flow 节点，但保留同名导出。 */
export function snapshotToFlowElements(
  snapshot: NarrativeLineSnapshot | null | undefined,
): { nodes: Array<{ id: string; data: StoryMapNodeData }>; edges: Array<{ id: string; source: string; target: string }> } {
  const board = snapshotToPlotBoard(snapshot);
  const nodes = board.threads.flatMap((thread) => {
    const scheduled = Object.values(thread.beatsByChapter).flat();
    return [...scheduled, ...thread.unscheduled].map((beat) => ({
      id: beat.id,
      data: { ...storyMapBeatToNodeData(beat), lane: beat.lane, laneLabel: THREAD_LABEL[beat.lane] },
    }));
  });
  return { nodes, edges: [] };
}

function BeatCard({
  beat,
  onOpenChapter,
  onPromote,
}: {
  beat: StoryMapBeat;
  onOpenChapter?: (chapterNumber: number) => void;
  onPromote?: (node: StoryMapNodeData) => void;
}) {
  const canJump = typeof beat.chapterNumber === "number" && onOpenChapter;
  return (
    <div
      className={`rounded-md border p-2 text-left ${THREAD_TONE[beat.lane]}`}
      data-testid={`story-map-node-${beat.id}`}
    >
      <div className="flex items-center justify-between gap-1">
        <Badge variant="outline" className="h-4 px-1.5 text-2xs">{THREAD_LABEL[beat.lane]}</Badge>
        {beat.status ? <span className="text-2xs text-muted-foreground">{beat.status}</span> : null}
      </div>
      <p className="mt-1 text-2xs font-medium leading-snug">{beat.title}</p>
      {beat.summary ? <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{beat.summary}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {canJump ? (
          <Button
            size="xs"
            variant="ghost"
            className="h-5 px-1.5 text-2xs"
            data-testid={`jump-btn-${beat.id}`}
            onClick={() => onOpenChapter?.(beat.chapterNumber!)}
          >
            <BookOpen className="mr-1 size-3" />跳转章节
          </Button>
        ) : null}
        {onPromote ? (
          <Button
            size="xs"
            variant="ghost"
            className="h-5 px-1.5 text-2xs"
            data-testid={`promote-btn-${beat.id}`}
            onClick={() => onPromote(storyMapBeatToNodeData(beat))}
          >
            <FilePlus2 className="mr-1 size-3" />提拔落稿
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export interface StoryMapCanvasProps {
  bookId: string;
  runtimeFetch?: (input: string, init?: RequestInit) => Promise<unknown>;
  onOpenChapter?: (chapterNumber: number) => void;
  onPromote?: (node: StoryMapNodeData) => void;
  onSendToNarrator?: (message: string) => Promise<void> | void;
}

export function StoryMapCanvas({ bookId, runtimeFetch, onOpenChapter, onPromote, onSendToNarrator }: StoryMapCanvasProps) {
  const [snapshot, setSnapshot] = useState<NarrativeLineSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  const loadStoryMap = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/books/${encodeURIComponent(bookId)}/narrative-line`;
      let resData: { snapshot?: NarrativeLineSnapshot };
      if (runtimeFetch) {
        resData = (await runtimeFetch(url, { signal: controller.signal })) as { snapshot?: NarrativeLineSnapshot };
      } else {
        resData = await fetchJson<{ snapshot?: NarrativeLineSnapshot }>(url, { signal: controller.signal });
      }
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      setSnapshot(resData.snapshot ?? null);
    } catch (err) {
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      setError(err instanceof Error ? err.message : "加载故事主支线失败");
      setSnapshot(null);
    } finally {
      if (!controller.signal.aborted && generation === loadGenerationRef.current) setLoading(false);
    }
  }, [bookId, runtimeFetch]);

  useEffect(() => {
    void loadStoryMap();
    return () => {
      loadGenerationRef.current += 1;
      loadAbortRef.current?.abort();
    };
  }, [loadStoryMap]);

  const board = useMemo(() => snapshotToPlotBoard(snapshot), [snapshot]);
  const chapterCount = snapshot?.nodes.filter((node) => node.type === "chapter").length ?? 0;

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background" data-testid="story-map-loading">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>正在加载情节板…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center bg-background" data-testid="story-map-error">
        <AlertCircle className="size-6 text-destructive" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground">情节板加载失败</p>
          <p className="text-2xs text-muted-foreground max-w-sm">{error}</p>
        </div>
        <Button size="xs" variant="outline" className="h-7 text-xs gap-1" onClick={() => void loadStoryMap()}>
          <RotateCcw className="size-3" />
          重试
        </Button>
      </div>
    );
  }

  if (!snapshot || snapshot.nodes.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center bg-background" data-testid="story-map-empty">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
          <Columns3 className="size-5" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">暂无故事主支线数据</p>
          <p className="text-2xs text-muted-foreground max-w-xs leading-relaxed">
            当前书籍尚未生成章节或叙事线节点。开始写作或在大纲中添加规划后将自动生成情节板。
          </p>
        </div>
        <Button size="xs" variant="outline" className="h-7 text-xs gap-1" onClick={() => void loadStoryMap()}>
          <RotateCcw className="size-3" />
          刷新
        </Button>
      </div>
    );
  }

  if (!hasPlanningNodes(snapshot)) {
    const missing = computeMissingPlanningKinds(snapshot);
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center bg-background" data-testid="story-map-empty-planning">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
          <Columns3 className="size-5" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">叙事线暂无规划节点</p>
          <p className="text-2xs text-muted-foreground max-w-sm leading-relaxed">
            当前快照仅包含 {chapterCount} 个章节节点，缺少：{missing.join(" / ")}。
            规划节点来自经纬账本，需要先拆解正文与抽取弧线才会点亮情节板。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onSendToNarrator ? (
            <Button
              size="xs"
              variant="default"
              className="h-7 text-xs gap-1 bg-primary text-primary-foreground shadow-2xs"
              data-testid="story-map-start-planning"
              onClick={() => void onSendToNarrator(buildStoryMapPlanPrompt(chapterCount, missing))}
            >
              <Sparkles className="size-3" />
              发起主支线梳理
            </Button>
          ) : null}
          <Button size="xs" variant="outline" className="h-7 text-xs gap-1" onClick={() => void loadStoryMap()}>
            <RotateCcw className="size-3" />
            刷新
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-auto bg-background" data-testid="story-map-canvas">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card/90 px-3 py-2 backdrop-blur-md">
        <Sparkles className="size-4 text-primary" />
        <span className="text-xs font-bold text-foreground">故事情节板 · 章 × 线索</span>
        <Button size="xs" variant="outline" className="ml-auto h-7 text-2xs gap-1" onClick={() => void loadStoryMap()}>
          <RotateCcw className="size-3" />
          刷新
        </Button>
      </div>
      <div className="min-w-max p-3" data-testid="story-map-board">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `10rem repeat(${Math.max(board.chapters.length, 1)}, minmax(11rem, 1fr))` }}
        >
          <div className="sticky left-0 z-[1] rounded-md bg-muted/70 px-2 py-1.5 text-2xs font-semibold text-muted-foreground">线索</div>
          {board.chapters.map((chapter) => (
            <button
              key={chapter.chapterNumber}
              type="button"
              className="rounded-md bg-muted/40 px-2 py-1.5 text-left"
              data-testid={`jump-btn-${chapter.nodeId ?? `chapter-${chapter.chapterNumber}`}`}
              onClick={() => onOpenChapter?.(chapter.chapterNumber)}
            >
              <div className="text-2xs font-semibold">第 {chapter.chapterNumber} 章</div>
              <div className="truncate text-2xs text-muted-foreground">{chapter.title}</div>
            </button>
          ))}
          {board.threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              chapters={board.chapters}
              onOpenChapter={onOpenChapter}
              onPromote={onPromote}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  chapters,
  onOpenChapter,
  onPromote,
}: {
  thread: StoryMapThread;
  chapters: StoryMapBoard["chapters"];
  onOpenChapter?: (chapterNumber: number) => void;
  onPromote?: (node: StoryMapNodeData) => void;
}) {
  return (
    <>
      <div className={`sticky left-0 z-[1] rounded-md border px-2 py-2 ${THREAD_TONE[thread.kind]}`}>
        <Badge variant="outline" className="h-4 px-1.5 text-2xs">{THREAD_LABEL[thread.kind]}</Badge>
        <p className="mt-1 text-2xs font-medium leading-snug">{thread.title}</p>
        {thread.status ? <p className="mt-0.5 text-2xs text-muted-foreground">{thread.status}</p> : null}
        {thread.unscheduled.length > 0 ? (
          <div className="mt-1 space-y-1">
            {thread.unscheduled.map((beat) => (
              <BeatCard key={beat.id} beat={beat} onPromote={onPromote} />
            ))}
          </div>
        ) : null}
      </div>
      {chapters.map((chapter) => {
        const beats = beatsForChapter(thread, chapter.chapterNumber);
        return (
          <div key={`${thread.id}:${chapter.chapterNumber}`} className="min-h-16 space-y-1 rounded-md border border-dashed border-border/70 p-1.5">
            {beats.length > 0
              ? beats.map((beat) => (
                <BeatCard key={beat.id} beat={beat} onOpenChapter={onOpenChapter} onPromote={onPromote} />
              ))
              : <p className="px-1 py-3 text-center text-2xs text-muted-foreground/70">空</p>}
          </div>
        );
      })}
    </>
  );
}
