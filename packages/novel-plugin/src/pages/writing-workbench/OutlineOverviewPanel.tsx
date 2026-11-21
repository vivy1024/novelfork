/**
 * 大纲总览面板（OutlineOverviewPanel）—— 故事推进与分卷大纲的联动视图。
 *
 * 使用 useNarrativeStructure(bookId) 渲染分卷科技树式推进路径：
 * - 每卷卡片展示起止区间、卷目标、已完成章节比例；
 * - 卷内按章号点亮各章（已落稿章实心点亮，点击直接跳正文；下一章高亮；规划中虚线）；
 * - 右上角可一键跳转到「下一章计划」或「推进网格」。
 */

import { BookOpen, CheckCircle2, Circle, FolderTree, Layers, LayoutGrid, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNarrativeStructure } from "./useNarrativeStructure";

export interface OutlineOverviewPanelProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  /** 兼容保留；大纲总览聚焦全局分卷结构，不再堆砌重复的「写下一章」按钮。 */
  readonly onOpenWriteView?: () => void;
  readonly onOpenBoardProgress?: () => void;
  readonly onOpenStoryTree?: () => void;
  /** 兼容旧调用方保留。 */
  readonly onOpenNextChapter?: () => void;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
}

export function OutlineOverviewPanel({
  bookId,
  currentChapter,
  onOpenChapter,
  onOpenBoardProgress,
  onOpenStoryTree,
  onSendToNarrator,
}: OutlineOverviewPanelProps) {
  const { state, reload } = useNarrativeStructure(bookId);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="outline-overview-loading">
        <Loader2 className="size-4 animate-spin" />
        正在加载全书大纲总览…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-destructive">
        <p>{state.message}</p>
        <Button size="sm" variant="outline" onClick={reload}>重试</Button>
      </div>
    );
  }

  const data = state.data;
  const draftedSet = new Set(data.chapters.map((c) => c.number));
  const chapterMap = new Map(data.chapters.map((c) => [c.number, c]));
  const scenesByChapter = new Map<number, number>();
  for (const scene of data.scenes) {
    scenesByChapter.set(scene.chapterNumber, (scenesByChapter.get(scene.chapterNumber) ?? 0) + 1);
  }
  const focusChapter = currentChapter ?? data.currentChapter ?? 0;
  const nextChapter = focusChapter + 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3" data-testid="outline-overview-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="size-4 shrink-0 text-info" />
            <h3 className="whitespace-nowrap text-sm font-semibold text-foreground">全书分卷与大纲总览</h3>
            <Badge variant="outline" className="shrink-0 whitespace-nowrap tabular-nums text-2xs">
              已写 {data.chapters.length} 章 · {data.volumes.length} 卷
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            点击已落稿章节可直接打开正文复盘，或切到「推进网格」「故事树」核查剧情线与因果脉络。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {onOpenBoardProgress ? (
            <Button size="xs" variant="outline" className="h-7 shrink-0 gap-1 whitespace-nowrap px-2.5 text-xs" onClick={onOpenBoardProgress}>
              <LayoutGrid className="size-3" />
              <span>推进网格</span>
            </Button>
          ) : null}
          {onOpenStoryTree ? (
            <Button size="xs" variant="outline" className="h-7 shrink-0 gap-1 whitespace-nowrap px-2.5 text-xs" onClick={onOpenStoryTree}>
              <FolderTree className="size-3" />
              <span>故事树</span>
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" className="h-7 shrink-0 px-2" onClick={reload} aria-label="刷新大纲总览">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {data.volumes.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border bg-card/40 px-6 py-10 text-center"
          data-testid="outline-overview-empty"
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
            <BookOpen className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">这本书还没有分卷大纲</p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {data.chapters.length > 0
                ? `当前已落稿 ${data.chapters.length} 章，但尚未整理分卷结构。可以让叙述者按现有正文反推第一卷卷纲草案，再逐章点亮进度。`
                : "先让叙述者根据书名与设定生成第一卷卷纲草案，确认后再按章推进写作。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {onSendToNarrator ? (
              <Button
                size="sm"
                className="h-8 shrink-0 gap-1.5 whitespace-nowrap px-3 text-xs"
                onClick={() => {
                  void onSendToNarrator("请根据当前设定与已有正文为我起草第一卷卷纲草案，确认后再写入。");
                }}
              >
                <Sparkles className="size-3.5" />
                <span>让叙述者起草第一卷卷纲</span>
              </Button>
            ) : null}
            {data.chapters.length > 0 && onOpenBoardProgress ? (
              <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 whitespace-nowrap px-3 text-xs" onClick={onOpenBoardProgress}>
                <LayoutGrid className="size-3.5" />
                <span>查看推进网格</span>
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {data.volumes.map((volume, volIdx) => {
            const from = Math.max(1, volume.chapterRange.from);
            const to = Math.max(from, volume.chapterRange.to);
            const chapterSlots: number[] = [];
            for (let ch = from; ch <= Math.min(to, from + 59); ch += 1) {
              chapterSlots.push(ch);
            }
            const draftedInVolume = data.chapters.filter((c) => c.number >= from && c.number <= to).length;
            const totalInVolume = to - from + 1;
            const pct = Math.min(100, Math.round((draftedInVolume / totalInVolume) * 100));

            return (
              <section key={volume.id || volIdx} className="rounded-lg border border-border bg-card p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-2xs">第 {volIdx + 1} 卷</Badge>
                    <h4 className="text-sm font-semibold text-foreground">{volume.title}</h4>
                    <span className="text-2xs text-muted-foreground">第 {from}–{to} 章</span>
                  </div>
                  <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                    <span>已完成 {draftedInVolume}/{totalInVolume} 章</span>
                    <span className="font-medium text-foreground tabular-nums">{pct}%</span>
                  </div>
                </div>
                {volume.goal ? (
                  <p className="text-xs text-muted-foreground">{volume.goal}</p>
                ) : null}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {chapterSlots.map((ch) => {
                    const drafted = draftedSet.has(ch);
                    const isNext = ch === nextChapter;
                    const chInfo = chapterMap.get(ch);
                    const sceneCount = scenesByChapter.get(ch) ?? 0;
                    return (
                      <button
                        key={ch}
                        type="button"
                        disabled={!drafted}
                        title={
                          drafted
                            ? `第 ${ch} 章 ${chInfo?.title ?? ""}（${chInfo?.wordCount ?? 0} 字${sceneCount > 0 ? ` · ${sceneCount} 场` : ""}）`
                            : isNext
                              ? `第 ${ch} 章（下一待写章，请到写作台筹备与起草）`
                              : `第 ${ch} 章（未写${sceneCount > 0 ? ` · 已规划 ${sceneCount} 场` : ""}）`
                        }
                        onClick={() => {
                          if (drafted) onOpenChapter?.(ch);
                        }}
                        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-2xs transition-colors ${
                          drafted
                            ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                            : isNext
                              ? "border-warning/50 bg-warning/10 text-warning"
                              : "border-dashed border-border text-muted-foreground opacity-75"
                        }`}
                      >
                        {drafted ? (
                          <CheckCircle2 className="size-3 shrink-0" />
                        ) : (
                          <Circle className="size-3 shrink-0" />
                        )}
                        <span>第{ch}章</span>
                        {sceneCount > 0 ? <span className="opacity-70">·{sceneCount}场</span> : null}
                      </button>
                    );
                  })}
                  {to >= from + 60 ? (
                    <span className="self-center px-1 text-2xs text-muted-foreground">…共 {totalInVolume} 章</span>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
