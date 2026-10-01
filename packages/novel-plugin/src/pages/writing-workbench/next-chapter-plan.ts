/**
 * 下一章计划（纯函数，零副作用）：T4.5 整合页的数据组装。
 *
 * 只读现有数据组装「下一章写什么」，不新建权威源：
 *  - 剧情线/场景/挂载来自 narrative-structure 快照
 *  - 伏笔用快照里已算好的 ForeshadowDebt（debtUrgency 阈值已带）
 *  - 焦点来自经纬 current-focus 单例（goal/why 由作者手填）
 *
 * 建议合成规则（作者已认可）：
 *  1. 焦点点名线：有焦点句时，取 lifecycle=active 的第一条主线（kind=main；没有则第一条 active 线）；
 *  2. 最长停滞线：chaptersSinceLastBeat 最大的活跃线（带真实停滞数字）；
 *  3. 若 1、2 是同一条线，只出一条；有两条才并列。
 * 最早到期的伏笔附进建议。没有剧情线时给「先建剧情线」的引导而不是空建议。
 */

import type { NarrativeScene } from "../../engine/narrative-memory/scene-store.js";
import type { NarrativeStoryline } from "../../engine/narrative-memory/scene-store.js";
import type { SceneStorylineMount } from "../../engine/narrative-memory/scene-store.js";
import type { ForeshadowDebt } from "../../engine/narrative-taxonomy/foreshadow-debts.js";
import type { NarrativeChapterInfo } from "../../engine/narrative-taxonomy/narrative-structure.js";

export interface CurrentFocusSnapshot {
  readonly goal: string;
  readonly why?: string;
}

export interface NextChapterSuggestion {
  readonly id: string;
  readonly storylineId?: string;
  readonly laneKind: string;
  readonly laneTitle: string;
  readonly reason: "focus-named" | "longest-stalled";
  readonly reasonText: string;
  readonly chaptersSinceLastBeat?: number;
}

export interface HookPlanItem {
  readonly debt: ForeshadowDebt;
  readonly pendingChapters: number | null;
  readonly headline: string;
}

export interface NextChapterPlan {
  readonly nextChapter: number;
  readonly focus: CurrentFocusSnapshot | null;
  readonly hasStorylines: boolean;
  readonly suggestions: readonly NextChapterSuggestion[];
  /** 加入建议的最先到期的伏笔（最多 3 条，按 urgency 与年龄排序）。 */
  readonly hookPlan: readonly HookPlanItem[];
  /** 伏笔按 urgency 分四类（超期/临近/正常/未埋草稿——草稿由调用方补充）。 */
  readonly overdue: readonly ForeshadowDebt[];
  readonly watch: readonly ForeshadowDebt[];
  readonly healthy: readonly ForeshadowDebt[];
  readonly narrativeSummary: string;
}

interface LaneStat {
  readonly storyline: NarrativeStoryline | null;
  readonly kind: string;
  readonly title: string;
  readonly chaptersSinceLastBeat?: number;
  readonly active: boolean;
}

function lastBeatChapter(scenes: readonly NarrativeScene[], mounts: readonly SceneStorylineMount[], storylineId: string): number | undefined {
  const ids = new Set(mounts.filter((mount) => mount.storylineId === storylineId).map((mount) => mount.sceneId));
  let last: number | undefined;
  for (const scene of scenes) {
    if (ids.has(scene.id) && (last === undefined || scene.chapterNumber > last)) last = scene.chapterNumber;
  }
  return last;
}

function laneStats(input: {
  readonly storylines: readonly NarrativeStoryline[];
  readonly scenes: readonly NarrativeScene[];
  readonly mounts: readonly SceneStorylineMount[];
  readonly currentChapter: number;
}): readonly LaneStat[] {
  return input.storylines.map((storyline) => {
    const last = lastBeatChapter(input.scenes, input.mounts, storyline.id);
    return {
      storyline,
      kind: storyline.kind,
      title: storyline.name,
      chaptersSinceLastBeat: last !== undefined ? Math.max(0, input.currentChapter - last) : undefined,
      active: storyline.lifecycle === "active" || storyline.lifecycle === "planned",
    };
  });
}

export function buildNextChapterPlan(input: {
  readonly chapters: readonly NarrativeChapterInfo[];
  readonly scenes: readonly NarrativeScene[];
  readonly storylines: readonly NarrativeStoryline[];
  readonly mounts: readonly SceneStorylineMount[];
  readonly foreshadows: readonly ForeshadowDebt[];
  readonly focus: CurrentFocusSnapshot | null;
  readonly currentChapter?: number;
}): NextChapterPlan {
  const latestChapter = input.chapters.length > 0 ? Math.max(...input.chapters.map((chapter) => chapter.number)) : 0;
  const currentChapter = input.currentChapter ?? latestChapter;
  const nextChapter = Math.max(currentChapter + 1, latestChapter + 1);

  const pending = (debt: ForeshadowDebt): number => debt.chaptersPending ?? -1;
  const overdue = input.foreshadows
    .filter((debt) => debt.urgency === "overdue")
    .sort((a, b) => pending(b) - pending(a));
  const watch = input.foreshadows
    .filter((debt) => debt.urgency === "watch")
    .sort((a, b) => pending(b) - pending(a));
  const healthy = input.foreshadows
    .filter((debt) => debt.urgency === "ok")
    .sort((a, b) => pending(b) - pending(a));

  const lanes = laneStats({ storylines: input.storylines, scenes: input.scenes, mounts: input.mounts, currentChapter });
  const activeLanes = lanes.filter((lane) => lane.active);

  const suggestions: NextChapterSuggestion[] = [];
  const focusLane = input.focus?.goal
    ? activeLanes.find((lane) => lane.kind === "main") ?? activeLanes[0]
    : undefined;
  if (focusLane) {
    suggestions.push({
      id: `focus:${focusLane.storyline!.id}`,
      storylineId: focusLane.storyline!.id,
      laneKind: focusLane.kind,
      laneTitle: focusLane.title,
      reason: "focus-named",
      reasonText: "焦点点名",
      ...(focusLane.chaptersSinceLastBeat !== undefined ? { chaptersSinceLastBeat: focusLane.chaptersSinceLastBeat } : {}),
    });
  }

  const stalled = activeLanes
    .filter((lane) => lane.chaptersSinceLastBeat !== undefined && lane.storyline !== focusLane?.storyline)
    .sort((a, b) => (b.chaptersSinceLastBeat ?? -1) - (a.chaptersSinceLastBeat ?? -1))[0];
  if (stalled) {
    suggestions.push({
      id: `stalled:${stalled.storyline!.id}`,
      storylineId: stalled.storyline!.id,
      laneKind: stalled.kind,
      laneTitle: stalled.title,
      reason: "longest-stalled",
      reasonText: `已 ${stalled.chaptersSinceLastBeat} 章未推进`,
      ...(stalled.chaptersSinceLastBeat !== undefined ? { chaptersSinceLastBeat: stalled.chaptersSinceLastBeat } : {}),
    });
  }

  const hookPlan = [...overdue, ...watch].slice(0, 3).map((debt) => ({
    debt,
    pendingChapters: debt.chaptersPending ?? null,
    headline: debt.reason || debt.title,
  }));

  return {
    nextChapter,
    focus: input.focus,
    hasStorylines: input.storylines.length > 0,
    suggestions,
    hookPlan,
    overdue,
    watch,
    healthy,
    narrativeSummary: `共 ${input.storylines.length} 条剧情线 · ${input.scenes.length} 个场景 · ${input.foreshadows.length} 条伏笔`,
  };
}
