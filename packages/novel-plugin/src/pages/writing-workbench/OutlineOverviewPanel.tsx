/**
 * 大纲总览面板（OutlineOverviewPanel）—— 故事推进与分卷大纲的联动视图。
 *
 * 使用 useNarrativeStructure(bookId) 渲染分卷科技树式推进路径：
 * - 每卷卡片展示起止区间、卷目标、已完成章节比例；
 * - 卷内按章号点亮各章（已落稿章实心点亮，点击直接跳正文；下一章高亮；规划中虚线）；
 * - 右上角可一键跳转到「下一章计划」或「推进网格」。
 */

import { BookOpen, CheckCircle2, Circle, Layers, Loader2, PenLine, RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNarrativeStructure } from "./useNarrativeStructure";

export interface OutlineOverviewPanelProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly onOpenWriteView?: () => void;
  readonly onOpenBoardProgress?: () => void;
  readonly onOpenNextChapter?: () => void;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
}

export function OutlineOverviewPanel({
  bookId,
  currentChapter,
  onOpenChapter,
  onOpenWriteView,
  onOpenBoardProgress,
  onOpenNextChapter,
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
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-info" />
            <h3 className="text-sm font-semibold text-foreground">全书分卷与大纲总览</h3>
            <Badge variant="outline" className="text-2xs">
              已写 {data.chapters.length} 章 · {data.volumes.length} 卷
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            点亮已落稿章节可直接进入正文编辑，点击「推进网格」或「下一章」同步规划后续剧情。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onOpenNextChapter ? (
            <Button size="xs" variant="outline" onClick={onOpenNextChapter}>下一章计划</Button>
          ) : null}
          {onOpenBoardProgress ? (
            <Button size="xs" variant="outline" onClick={onOpenBoardProgress}>推进网格</Button>
          ) : null}
          {onOpenWriteView ? (
            <Button size="xs" variant="default" className="gap-1" onClick={onOpenWriteView}>
              <PenLine className="size-3" />
              去写第 {nextChapter} 章
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={reload} aria-label="刷新大纲总览">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {data.volumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
          <BookOpen className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">这本书还没有分卷大纲</p>
          <p className="text-xs text-muted-foreground">先让叙述者根据书名与设定生成第一卷卷纲，再逐章点亮推进。</p>
          {onSendToNarrator ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-1 gap-1"
              onClick={() => {
                void onSendToNarrator("请根据当前设定为我起草第一卷卷纲草案，确认后再写入。");
              }}
            >
              <Sparkles className="size-3.5 text-primary" />
              让叙述者起草第一卷卷纲
            </Button>
          ) : null}
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
                        disabled={!drafted && !isNext}
                        title={
                          drafted
                            ? `第 ${ch} 章 ${chInfo?.title ?? ""}（${chInfo?.wordCount ?? 0} 字${sceneCount > 0 ? ` · ${sceneCount} 场` : ""}）`
                            : isNext
                              ? `点击开写第 ${ch} 章`
                              : `第 ${ch} 章（未写${sceneCount > 0 ? ` · 已规划 ${sceneCount} 场` : ""}）`
                        }
                        onClick={() => {
                          if (drafted) onOpenChapter?.(ch);
                          else if (isNext) onOpenWriteView?.();
                        }}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-2xs transition-colors ${
                          drafted
                            ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                            : isNext
                              ? "border-warning/50 bg-warning/10 text-warning hover:bg-warning/15"
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
