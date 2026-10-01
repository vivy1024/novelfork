import { describe, expect, it } from "vitest";

import type { ForeshadowDebt } from "../../engine/narrative-taxonomy/foreshadow-debts.js";
import type { NarrativeScene, NarrativeStoryline } from "../../engine/narrative-memory/scene-store.js";
import type { SceneStorylineMount } from "../../engine/narrative-memory/scene-store.js";

import { buildNextChapterPlan } from "./next-chapter-plan";

function storyline(overrides: Partial<NarrativeStoryline>): NarrativeStoryline {
  return {
    id: "line-1",
    bookId: "book-1",
    title: "主线",
    kind: "main",
    lifecycle: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as NarrativeStoryline;
}

function scene(id: string, chapterNumber: number): NarrativeScene {
  return {
    id,
    bookId: "book-1",
    chapterNumber,
    ordinal: chapterNumber,
    title: `场 ${chapterNumber}`,
    summary: "",
    locationText: null,
    status: "confirmed",
    layer: "canon",
    source: "manual",
    canonStatus: "confirmed",
    canonSourceRef: null,
    conflictWith: [],
    provenance: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as NarrativeScene;
}

function mount(sceneId: string, storylineId: string): SceneStorylineMount {
  return {
    id: `${sceneId}-${storylineId}`,
    sceneId,
    storylineId,
    role: "primary",
    createdAt: "2026-01-01T00:00:00Z",
  } as SceneStorylineMount;
}

function debt(id: string, urgency: ForeshadowDebt["urgency"], pending?: number): ForeshadowDebt {
  return {
    id,
    entryId: `entry-${id}`,
    title: `伏笔 ${id}`,
    status: "planted",
    plantedChapter: 1,
    ...(pending !== undefined ? { chaptersPending: pending } : {}),
    urgency,
    reason: pending !== undefined ? `已悬置 ${pending} 章` : "已悬置",
  };
}

describe("下一章计划组装", () => {
  it("下一章 = 最新章 +1；没有剧情线时给引导而不是空建议", () => {
    const plan = buildNextChapterPlan({
      chapters: [{ chapterNumber: 12 } as never],
      scenes: [],
      storylines: [],
      mounts: [],
      foreshadows: [],
      focus: null,
    });
    expect(plan.nextChapter).toBe(13);
    expect(plan.hasStorylines).toBe(false);
    expect(plan.suggestions).toEqual([]);
  });

  it("有焦点时建议焦点点名线 + 最长的另一条停滞线", () => {
    const main = storyline({ id: "main", kind: "main", title: "夺回师门" });
    const romance = storyline({ id: "rom", kind: "romance", title: "感情线" });
    const chapterList = [scene("s10", 10), scene("s2", 2)] as const;
    const mounts = [mount("s10", "main"), mount("s2", "rom")];
    const plan = buildNextChapterPlan({
      chapters: [{ chapterNumber: 12 } as never],
      scenes: [...chapterList],
      storylines: [main, romance],
      mounts,
      foreshadows: [],
      focus: { goal: "让主线在守擂战退一档", why: "拍卖前压住张力" },
      currentChapter: 12,
    });
    expect(plan.suggestions).toHaveLength(2);
    expect(plan.suggestions[0]).toMatchObject({ storylineId: "main", reason: "focus-named", chaptersSinceLastBeat: 2 });
    expect(plan.suggestions[1]).toMatchObject({ storylineId: "rom", reason: "longest-stalled", chaptersSinceLastBeat: 10 });
  });

  it("焦点线与最长停滞线相同（或唯一线）时只出一条", () => {
    const main = storyline({ id: "main", kind: "main", title: "主线" });
    const s = scene("s1", 8);
    const plan = buildNextChapterPlan({
      chapters: [{ chapterNumber: 12 } as never],
      scenes: [s],
      storylines: [main],
      mounts: [mount("s1", "main")],
      foreshadows: [],
      focus: { goal: "推进主线" },
      currentChapter: 12,
    });
    expect(plan.suggestions).toHaveLength(1);
  });

  it("暂无焦点且只有一条活跃线时 fallback 只给最长停滞线", () => {
    const main = storyline({ id: "main", kind: "main", title: "主线" });
    const plan = buildNextChapterPlan({
      chapters: [{ chapterNumber: 12 } as never],
      scenes: [scene("s5", 5)],
      storylines: [main],
      mounts: [mount("s5", "main")],
      foreshadows: [],
      focus: null,
      currentChapter: 12,
    });
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]!.reason).toBe("longest-stalled");
    expect(plan.suggestions[0]!.chaptersSinceLastBeat).toBe(7);
  });

  it("伏笔按 urgency 分区并按悬置章数降序；hookPlan 先超期后临近，最多 3 条", () => {
    const foreshadows = [
      debt("a-overdue-old", "overdue", 15),
      debt("b-overdue-new", "overdue", 13),
      debt("c-watch", "watch", 6),
      debt("d-ok", "ok", 2),
      debt("e-no-age", "overdue"),
    ];
    const plan = buildNextChapterPlan({
      chapters: [{ chapterNumber: 20 } as never],
      scenes: [],
      storylines: [],
      mounts: [],
      foreshadows,
      focus: null,
    });
    expect(plan.overdue.map((d) => d.id)).toEqual(["a-overdue-old", "b-overdue-new", "e-no-age"]);
    expect(plan.watch.map((d) => d.id)).toEqual(["c-watch"]);
    expect(plan.healthy.map((d) => d.id)).toEqual(["d-ok"]);
    expect(plan.hookPlan.map((item) => item.debt.id)).toEqual(["a-overdue-old", "b-overdue-new", "e-no-age"]);
    expect(plan.hookPlan[0]!.headline).toContain("15 章");
  });

  it("已完结（resolved）与已放弃的剧情线不出现在建议里", () => {
    const active = storyline({ id: "a", title: "活跃" });
    const done = storyline({ id: "d", title: "完结", lifecycle: "resolved" });
    const s1 = scene("s1", 10);
    const s2 = scene("s2", 9);
    const plan = buildNextChapterPlan({
      chapters: [{ chapterNumber: 12 } as never],
      scenes: [s1, s2],
      storylines: [active, done],
      mounts: [mount("s1", "a"), mount("s2", "d")],
      foreshadows: [],
      focus: null,
      currentChapter: 12,
    });
    expect(plan.suggestions.every((suggestion) => suggestion.storylineId !== "d")).toBe(true);
  });
});
