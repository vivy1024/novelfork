/**
 * 本章大纲进度伴随画板（ChapterOutlineBoard）。
 *
 * 位于正文编辑器右侧伴随栏的「大纲板」页签：
 * 1. 只通过 useNarrativeStructure(bookId) 读取统一快照，不发碎片化请求；
 * 2. 显示当前章所属卷、卷进度条与核心目标；
 * 3. 显示本章场景节拍（挂载的剧情线、场景作用、摘要），以及关联未回收伏笔；
 * 4. 支持一键跳去全书大纲总览 / 故事画布，或让叙述者补全本章细纲。
 */

import { useMemo } from "react";
import { Compass, Flag, Layers, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useNarrativeStructure } from "./useNarrativeStructure";
import type { SceneSpec } from "./SceneSpecPanel";
import type { NarrativeVolumeInfo } from "../../engine/narrative-taxonomy/narrative-structure";

export interface ChapterOutlineBoardProps {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly sceneSpec?: SceneSpec | null;
  readonly onOpenStoryCanvas?: (preferredView?: string) => void;
  readonly onOpenBlueprint?: () => void;
  readonly onJumpToChapter?: (chapterNumber: number) => void;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  readonly className?: string;
}

const SCENE_FUNCTION_LABELS: Record<string, string> = {
  hook: "开篇钩子",
  advance: "推进",
  turn: "转折",
  climax: "高潮",
  breath: "缓冲",
  reveal: "揭示",
};

function findVolumeForChapter(
  volumes: readonly NarrativeVolumeInfo[],
  chapterNumber: number | undefined,
): { volume: NarrativeVolumeInfo; index: number } | null {
  if (volumes.length === 0) return null;
  if (typeof chapterNumber === "number" && chapterNumber > 0) {
    const idx = volumes.findIndex(
      (vol) => chapterNumber >= vol.chapterRange.from && chapterNumber <= vol.chapterRange.to,
    );
    if (idx >= 0) return { volume: volumes[idx]!, index: idx };
  }
  return { volume: volumes[0]!, index: 0 };
}

export function ChapterOutlineBoard({
  bookId,
  chapterNumber,
  sceneSpec,
  onOpenStoryCanvas,
  onOpenBlueprint,
  onJumpToChapter,
  onSendToNarrator,
  className,
}: ChapterOutlineBoardProps) {
  const { state, reload } = useNarrativeStructure(bookId);

  const model = useMemo(() => {
    if (state.status !== "ready") return null;
    const data = state.data;
    const targetChapter = typeof chapterNumber === "number" && chapterNumber > 0
      ? chapterNumber
      : data.currentChapter || 1;

    const volHit = findVolumeForChapter(data.volumes, targetChapter);
    const storylineNameMap = new Map(data.storylines.map((s) => [s.id, s.name]));
    const mountsByScene = new Map<string, string[]>();
    for (const mount of data.mounts) {
      const title = storylineNameMap.get(mount.storylineId);
      if (!title) continue;
      const list = mountsByScene.get(mount.sceneId) ?? [];
      list.push(title);
      mountsByScene.set(mount.sceneId, list);
    }

    const chapterScenes = data.scenes
      .filter((scene) => scene.chapterNumber === targetChapter)
      .map((scene) => ({
        id: scene.id,
        title: scene.title,
        summary: scene.summary,
        fnLabel: SCENE_FUNCTION_LABELS[scene.function] ?? scene.function,
        storylines: mountsByScene.get(scene.id) ?? [],
      }));

    const chapterInfo = data.chapters.find((c) => c.number === targetChapter);
    const activeForeshadows = data.foreshadows
      .filter((f) => f.urgency === "overdue" || f.urgency === "watch")
      .slice(0, 4);

    let volumeProgressPct = 0;
    let volumeSpanLabel = "";
    if (volHit) {
      const from = volHit.volume.chapterRange.from;
      const to = Math.max(from, volHit.volume.chapterRange.to);
      const span = to - from + 1;
      const draftedInVolume = data.chapters.filter((c) => c.number >= from && c.number <= to).length;
      volumeProgressPct = Math.min(100, Math.round((draftedInVolume / span) * 100));
      volumeSpanLabel = `第 ${from}–${to} 章 · 已写 ${draftedInVolume}/${span} 章`;
    }

    return {
      targetChapter,
      chapterInfo,
      volHit,
      volumeProgressPct,
      volumeSpanLabel,
      chapterScenes,
      activeForeshadows,
      totalChapters: data.chapters.length,
    };
  }, [state, chapterNumber]);

  return (
    <aside
      className={cn("flex h-full min-h-0 flex-col overflow-y-auto bg-card text-card-foreground", className)}
      data-testid="chapter-outline-board"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">
              {typeof chapterNumber === "number" ? `第 ${chapterNumber} 章大纲` : "本章大纲"}
            </span>
            {model?.chapterInfo ? (
              <Badge variant="outline" className="h-4 px-1.5 text-2xs">
                {model.chapterInfo.wordCount.toLocaleString()} 字
              </Badge>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={state.status === "loading"}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="刷新大纲进度"
          aria-label="刷新大纲进度"
        >
          {state.status === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </button>
      </header>

      {state.status === "loading" ? (
        <div className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在同步大纲进度…
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="space-y-2 px-3 py-4 text-xs text-destructive">
          <p>{state.message}</p>
          <button type="button" onClick={reload} className="text-primary hover:underline">重试</button>
        </div>
      ) : null}

      {state.status === "ready" && model ? (
        <div className="flex flex-1 flex-col divide-y divide-border">
          {/* 1. 所属卷进度 */}
          <section className="space-y-1.5 px-3 py-2.5" data-testid="outline-board-volume">
            <div className="flex items-center justify-between gap-1">
              <span className="inline-flex items-center gap-1 text-2xs font-semibold text-foreground">
                <Layers className="size-3 text-info" />
                所在卷进度
              </span>
              {model.volHit ? (
                <span className="text-2xs tabular-nums text-muted-foreground">{model.volumeProgressPct}%</span>
              ) : null}
            </div>
            {model.volHit ? (
              <>
                <p className="text-xs font-medium text-foreground">{model.volHit.volume.title}</p>
                <p className="text-2xs text-muted-foreground">{model.volumeSpanLabel}</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${model.volumeProgressPct}%` }}
                  />
                </div>
                {model.volHit.volume.goal ? (
                  <p className="text-2xs leading-5 text-muted-foreground">{model.volHit.volume.goal}</p>
                ) : null}
              </>
            ) : (
              <p className="text-2xs text-muted-foreground">尚未建卷纲，可在故事画布或对话中先起第一卷。</p>
            )}
          </section>

          {/* 2. 本章细纲与场景节拍 */}
          <section className="space-y-2 px-3 py-2.5" data-testid="outline-board-scenes">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-2xs font-semibold text-foreground">
                <Compass className="size-3 text-primary" />
                本章推进节拍
              </span>
              {onOpenBlueprint ? (
                <button type="button" onClick={onOpenBlueprint} className="text-2xs text-primary hover:underline">
                  章节蓝图
                </button>
              ) : null}
            </div>

            {model.chapterScenes.length > 0 ? (
              <ol className="space-y-1.5">
                {model.chapterScenes.map((scene, index) => (
                  <li key={scene.id} className="rounded-md border border-border/70 bg-background/60 p-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xs font-medium text-primary">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{scene.title}</span>
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-2xs text-muted-foreground">
                        {scene.fnLabel}
                      </span>
                    </div>
                    {scene.summary ? (
                      <p className="mt-1 text-2xs leading-5 text-muted-foreground">{scene.summary}</p>
                    ) : null}
                    {scene.storylines.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {scene.storylines.map((line) => (
                          <span key={line} className="rounded bg-primary/5 px-1.5 py-0.5 text-2xs text-primary">
                            {line}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : sceneSpec && sceneSpec.scenes.length > 0 ? (
              <ol className="space-y-1.5">
                {sceneSpec.scenes.map((scene, index) => (
                  <li key={index} className="rounded-md border border-border/70 bg-background/60 p-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xs font-medium text-primary">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{scene.outcome}</span>
                    </div>
                    {scene.conflict ? (
                      <p className="mt-1 text-2xs leading-5 text-muted-foreground">{scene.conflict}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="space-y-2 rounded-md border border-dashed border-border p-2.5 text-2xs text-muted-foreground">
                <p>第 {model.targetChapter} 章暂无结构化场景节拍。</p>
                {onSendToNarrator ? (
                  <button
                    type="button"
                    onClick={() => {
                      void onSendToNarrator(`请结合当前卷纲和前文，为第 ${model.targetChapter} 章拆出 2–4 个场景细纲节拍给我确认。`);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-2xs text-foreground hover:bg-muted"
                  >
                    <Sparkles className="size-3 text-primary" />
                    让叙述者拆本章细纲
                  </button>
                ) : null}
              </div>
            )}
          </section>

          {/* 3. 本章须关注伏笔 */}
          {model.activeForeshadows.length > 0 ? (
            <section className="space-y-1.5 px-3 py-2.5">
              <div className="flex items-center gap-1 text-2xs font-semibold text-foreground">
                <Flag className="size-3 text-warning" />
                <span>近章待收伏笔</span>
              </div>
              <ul className="space-y-1">
                {model.activeForeshadows.map((debt) => (
                  <li key={debt.entryId} className="flex items-center justify-between gap-2 text-2xs">
                    <span className="min-w-0 flex-1 truncate text-foreground" title={debt.title}>{debt.title}</span>
                    <button
                      type="button"
                      onClick={() => { if (typeof debt.plantedChapter === "number") onJumpToChapter?.(debt.plantedChapter); }}
                      className="shrink-0 text-warning hover:underline"
                    >
                      {typeof debt.plantedChapter === "number" ? `第${debt.plantedChapter}章` : "未定章"}
                      {typeof debt.chaptersPending === "number" ? `·悬${debt.chaptersPending}章` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* 4. 与故事推进大纲总览联动 */}
          {onOpenStoryCanvas ? (
            <section className="mt-auto px-3 py-2.5">
              <button
                type="button"
                data-testid="outline-board-open-overview"
                onClick={() => onOpenStoryCanvas("overview")}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent"
              >
                打开全书大纲总览与故事推进 →
              </button>
            </section>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
