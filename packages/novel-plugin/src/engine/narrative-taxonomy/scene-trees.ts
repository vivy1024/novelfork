/**
 * 承载树的数据层（纯函数，与 canonical-trees 同一套输出结构，
 * 因此前端 TidyTreeCanvas 不必改就能画）。
 *
 *   承载树  卷 → 章 → 场景    在哪讲
 *   因果图  剧情线 × 场景      为什么发生（见 causal-graph.ts）
 *
 * 正交的含义是**同一个场景同时出现在两处**：它属于第 N 章（承载），也服务某几条剧情线（因果）。
 * 承载关系是真正的树（一个场景只属于一章）；剧情线与场景是多对多，是图——
 * 硬塞成树会让同一个场景在多条线下重复出现、布局时叠在一起，所以因果那一侧改由因果画布呈现。
 *
 * 取数不在这里：卷来自经纬 outline 条目（唯一权威源），章来自 writing_resource，
 * 场景来自 scene-store。这里只接收已取好的数据并组装。
 *
 * 一条纪律贯穿全文件：**不静默丢数据**。归不进卷的章、挂不上线的场景，
 * 都单独成组并写明原因，而不是从树上消失——作者看不见的缺口最伤信任。
 */

import type {
  CanonicalForest,
  CanonicalTreeNode,
  VolumeTreeInput,
} from "./canonical-trees";
import { SCENE_FUNCTION_LABEL } from "./causal-graph";

export interface ChapterTreeInput {
  readonly number: number;
  readonly title?: string;
}

export interface SceneTreeInput {
  readonly id: string;
  readonly chapterNumber: number;
  readonly ordinal: number;
  readonly title?: string;
  readonly summary?: string;
  readonly function?: string;
  /** needs-review 的场景要在树上看得出来，否则作者会把机器猜测当成既定事实。 */
  readonly status?: string;
}

export interface BuildCarrierTreeInput {
  readonly volumes?: readonly VolumeTreeInput[];
  readonly chapters?: readonly ChapterTreeInput[];
  readonly scenes?: readonly SceneTreeInput[];
  /** 每卷最多铺开的章数，超出截断并置 truncated。 */
  readonly maxChaptersPerVolume?: number;
}

const DEFAULT_MAX_CHAPTERS_PER_VOLUME = 60;

function emptyForest(id: string, label: string, reason: string): CanonicalForest {
  return {
    kind: "chapters",
    root: { id, kind: "root", label, count: 0, children: [], defaultExpanded: true },
    truncated: false,
    emptyReason: reason,
  };
}

function sceneNode(scene: SceneTreeInput): CanonicalTreeNode {
  const fn = SCENE_FUNCTION_LABEL[scene.function ?? "advance"] ?? scene.function ?? "";
  const label = scene.title?.trim() || `第 ${scene.ordinal} 场`;
  return {
    id: `scene:${scene.id}`,
    kind: "scene",
    label,
    count: 0,
    children: [],
    defaultExpanded: false,
    chapterNumber: scene.chapterNumber,
    ...(fn ? { subtitle: fn } : {}),
    ...(scene.summary?.trim() ? { detail: scene.summary.trim() } : {}),
    // 待审状态如实带出：作者要能一眼分清哪些是机器猜的。
    ...(scene.status ? { status: scene.status } : {}),
  };
}

function scenesByChapter(scenes: readonly SceneTreeInput[]): Map<number, SceneTreeInput[]> {
  const grouped = new Map<number, SceneTreeInput[]>();
  for (const scene of scenes) {
    const list = grouped.get(scene.chapterNumber);
    if (list) list.push(scene);
    else grouped.set(scene.chapterNumber, [scene]);
  }
  for (const list of grouped.values()) {
    // id 兜底：ordinal 没有唯一约束，重号时排序仍须确定。
    list.sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  }
  return grouped;
}

function chapterNode(
  chapter: ChapterTreeInput,
  scenes: readonly SceneTreeInput[],
): CanonicalTreeNode {
  return {
    id: `chapter:${chapter.number}`,
    kind: "chapter",
    label: chapter.title?.trim() ? `第 ${chapter.number} 章 ${chapter.title.trim()}` : `第 ${chapter.number} 章`,
    count: scenes.length,
    children: scenes.map(sceneNode),
    defaultExpanded: false,
    chapterNumber: chapter.number,
    // 没拆场景的章要说明，而不是显示成一个空节点让人以为加载失败。
    ...(scenes.length === 0 ? { subtitle: "尚未拆场景" } : {}),
  };
}

/**
 * 承载树：卷 → 章 → 场景。
 *
 * 卷不是实体表，章归哪一卷由 chapterRange 推导（权威源是经纬 outline 条目，
 * 按「能派生的状态不存储」不在章上落 volume_id）。推导的代价是区间可能有
 * 重叠或空洞，所以这里显式处理两种边界：落在多个卷区间内的章归第一个匹配的卷；
 * 不落在任何区间内的章进「未归卷」组而不是消失。
 */
export function buildCarrierTree(input: BuildCarrierTreeInput): CanonicalForest {
  const scenes = input.scenes ?? [];
  const chapters = [...(input.chapters ?? [])].sort((a, b) => a.number - b.number);
  const volumes = input.volumes ?? [];
  const maxChapters = input.maxChaptersPerVolume ?? DEFAULT_MAX_CHAPTERS_PER_VOLUME;

  if (chapters.length === 0 && scenes.length === 0) {
    return emptyForest("carrier", "承载树", "这本书还没有章节，也没有场景；写下第一章后这里会铺开。");
  }

  const grouped = scenesByChapter(scenes);
  // 场景可能落在还没有章节行的章号上（例如先规划后写），这些章号也要出现在树上。
  const knownChapterNumbers = new Set(chapters.map((chapter) => chapter.number));
  const allChapters: ChapterTreeInput[] = [...chapters];
  for (const chapterNumber of grouped.keys()) {
    if (!knownChapterNumbers.has(chapterNumber)) allChapters.push({ number: chapterNumber });
  }
  allChapters.sort((a, b) => a.number - b.number);

  let truncated = false;
  const assigned = new Set<number>();
  const volumeNodes: CanonicalTreeNode[] = [];

  for (const volume of volumes) {
    const from = volume.chapterRange?.from ?? 0;
    const to = volume.chapterRange?.to ?? 0;
    const within = allChapters.filter(
      (chapter) => !assigned.has(chapter.number) && chapter.number >= from && chapter.number <= to,
    );
    for (const chapter of within) assigned.add(chapter.number);

    const shown = within.slice(0, maxChapters);
    if (shown.length < within.length) truncated = true;

    const sceneCount = within.reduce((sum, chapter) => sum + (grouped.get(chapter.number)?.length ?? 0), 0);
    volumeNodes.push({
      id: `volume:${volume.id ?? `${from}-${to}`}`,
      kind: "volume",
      label: volume.title?.trim() || `第 ${from}–${to} 章`,
      count: sceneCount,
      children: shown.map((chapter) => chapterNode(chapter, grouped.get(chapter.number) ?? [])),
      defaultExpanded: volumeNodes.length === 0,
      ...(volume.status ? { status: volume.status } : {}),
      subtitle: `${within.length} 章 · ${sceneCount} 场`,
      ...(volume.goal?.trim() ? { detail: volume.goal.trim() } : {}),
    });
  }

  const orphanChapters = allChapters.filter((chapter) => !assigned.has(chapter.number));
  if (orphanChapters.length > 0) {
    const shown = orphanChapters.slice(0, maxChapters);
    if (shown.length < orphanChapters.length) truncated = true;
    const sceneCount = orphanChapters.reduce(
      (sum, chapter) => sum + (grouped.get(chapter.number)?.length ?? 0),
      0,
    );
    volumeNodes.push({
      id: "volume:unassigned",
      kind: "group",
      label: volumes.length === 0 ? "全部章节" : "未归卷",
      count: sceneCount,
      children: shown.map((chapter) => chapterNode(chapter, grouped.get(chapter.number) ?? [])),
      defaultExpanded: volumes.length === 0,
      subtitle:
        volumes.length === 0
          ? `${orphanChapters.length} 章 · ${sceneCount} 场 · 还没有卷纲`
          : `${orphanChapters.length} 章 · ${sceneCount} 场 · 不在任何卷的章节区间内`,
    });
  }

  return {
    kind: "chapters",
    root: {
      id: "carrier",
      kind: "root",
      label: "承载树",
      count: scenes.length,
      children: volumeNodes,
      defaultExpanded: true,
      subtitle: `${allChapters.length} 章 · ${scenes.length} 场`,
    },
    truncated,
  };
}
