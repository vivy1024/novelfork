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
 *
 * 这是「下一章写什么 / 该收哪条伏笔」的唯一规则：故事画布「下一章」页与故事推进侧栏的
 * 下一步卡都引用同一份计划与同一句建议（describeNextChapterSuggestion），不另算第二套。
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
  // 「近期可用」是还开着、能排进下一章的伏笔；已回收的债 urgency 也是 ok，但不能再拿来排。
  const healthy = input.foreshadows
    .filter((debt) => debt.urgency === "ok" && debt.status !== "paid_off")
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

const STORYLINE_KIND_LABEL: Readonly<Record<string, string>> = {
  main: "主线",
  sub: "支线",
  romance: "感情线",
  faction: "势力线",
  mystery: "悬疑线",
  "character-arc": "人物成长",
  conflict: "矛盾线",
  character: "人物线",
  foreshadow: "伏笔线",
  other: "其他",
};

/** 剧情线类型的作者语言；认不出的原样显示。 */
export function storylineKindLabel(kind: string): string {
  return STORYLINE_KIND_LABEL[kind] ?? kind;
}

/**
 * 下一章建议的一句话：「下一章建议：第 N 章 · 主线「…」（焦点点名）· 顺手回收「…」」。
 * 画布「下一章」页的建议行与侧栏下一步卡共用这一句，口径只有一处。
 */
export function describeNextChapterSuggestion(plan: NextChapterPlan): string {
  const lanes = !plan.hasStorylines
    ? " · 还没有剧情线"
    : plan.suggestions.length > 0
      ? ` · ${plan.suggestions.map((s) => `${storylineKindLabel(s.laneKind)}「${s.laneTitle}」（${s.reasonText}）`).join("；")}`
      : " · 活跃剧情线都在推进中";
  const hook = plan.hookPlan.length > 0 ? ` · 顺手回收「${plan.hookPlan[0]!.debt.title}」` : "";
  return `下一章建议：第 ${plan.nextChapter} 章${lanes}${hook}`;
}
