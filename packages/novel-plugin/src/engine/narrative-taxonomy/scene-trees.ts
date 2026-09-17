/**
 * 两棵正交叙事树的数据层（纯函数，与 canonical-trees 同一套输出结构，
 * 因此前端 TidyTreeCanvas 不必改就能画）。
 *
 *   承载树  卷 → 章 → 场景    在哪讲
 *   因果树  剧情线 → 场景      为什么发生
 *
 * 正交的含义不是「有两棵树」，而是**同一个场景同时出现在两棵树上**：
 * 它属于第 N 章（承载），也服务某条剧情线（因果）。这要求场景有身份——
 * 在 narrative_scene 建表之前，本产品最小的有身份单元是章，所以这两棵树
 * 一棵是残的、一棵根本长不出来。
 *
 * 取数不在这里：卷来自经纬 outline 条目（唯一权威源），章来自 writing_resource，
 * 场景与剧情线来自 scene-store。这里只接收已取好的数据并组装。
 *
 * 一条纪律贯穿全文件：**不静默丢数据**。归不进卷的章、挂不上线的场景，
 * 都单独成组并写明原因，而不是从树上消失——作者看不见的缺口最伤信任。
 */

import type {
  CanonicalForest,
  CanonicalTreeNode,
  VolumeTreeInput,
} from "./canonical-trees";

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

export interface StorylineTreeInput {
  readonly id: string;
  readonly name?: string;
  readonly kind?: string;
  readonly lifecycle?: string;
  readonly goal?: string;
  readonly status?: string;
}

export interface SceneMountInput {
  readonly sceneId: string;
  readonly storylineId: string;
  readonly role?: string;
}

export interface BuildCarrierTreeInput {
  readonly volumes?: readonly VolumeTreeInput[];
  readonly chapters?: readonly ChapterTreeInput[];
  readonly scenes?: readonly SceneTreeInput[];
  /** 每卷最多铺开的章数，超出截断并置 truncated。 */
  readonly maxChaptersPerVolume?: number;
}

export interface BuildCausalTreeInput {
  readonly storylines?: readonly StorylineTreeInput[];
  readonly scenes?: readonly SceneTreeInput[];
  readonly mounts?: readonly SceneMountInput[];
  /** 只看主挂载（role=primary）时传 true；默认两种角色都铺。 */
  readonly primaryOnly?: boolean;
  readonly maxScenesPerStoryline?: number;
}

const DEFAULT_MAX_CHAPTERS_PER_VOLUME = 60;
const DEFAULT_MAX_SCENES_PER_STORYLINE = 80;

const SCENE_FUNCTION_LABEL: Record<string, string> = {
  advance: "推进",
  reveal: "揭示",
  plant: "埋设",
  payoff: "回收",
  relationship: "关系",
  transition: "过渡",
  setup: "铺垫",
  climax: "高潮",
  other: "其他",
};

const STORYLINE_KIND_LABEL: Record<string, string> = {
  main: "主线",
  sub: "支线",
  romance: "感情线",
  faction: "势力线",
  mystery: "悬疑线",
  "character-arc": "角色弧",
  other: "其他",
};

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

/**
 * 因果树：剧情线 → 场景。
 *
 * 场景与剧情线是多对多，所以同一个场景会出现在多条线下——这不是重复，
 * 正是「一个场景同时推进主线和感情线」在树上的样子。
 */
export function buildCausalTree(input: BuildCausalTreeInput): CanonicalForest {
  const storylines = input.storylines ?? [];
  const scenes = input.scenes ?? [];
  const mounts = input.mounts ?? [];
  const maxScenes = input.maxScenesPerStoryline ?? DEFAULT_MAX_SCENES_PER_STORYLINE;

  if (storylines.length === 0) {
    return emptyForest(
      "causal",
      "因果树",
      scenes.length > 0
        ? "已经有场景，但还没有剧情线；建立剧情线后就能看出哪条线在推进、哪条线停了。"
        : "还没有剧情线，也没有场景；这棵树描述「为什么发生」，需要先有剧情线。",
    );
  }

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const byStoryline = new Map<string, SceneTreeInput[]>();
  const mountedSceneIds = new Set<string>();

  for (const mount of mounts) {
    if (input.primaryOnly && (mount.role ?? "primary") !== "primary") continue;
    const scene = sceneById.get(mount.sceneId);
    if (!scene) continue;
    mountedSceneIds.add(scene.id);
    const list = byStoryline.get(mount.storylineId);
    if (list) list.push(scene);
    else byStoryline.set(mount.storylineId, [scene]);
  }

  let truncated = false;
  const storylineNodes: CanonicalTreeNode[] = [];

  for (const line of storylines) {
    const onLine = (byStoryline.get(line.id) ?? []).sort(
      (a, b) => a.chapterNumber - b.chapterNumber || a.ordinal - b.ordinal || a.id.localeCompare(b.id),
    );
    const shown = onLine.slice(0, maxScenes);
    if (shown.length < onLine.length) truncated = true;

    const lastChapter = onLine.at(-1)?.chapterNumber;
    const kindLabel = STORYLINE_KIND_LABEL[line.kind ?? "other"] ?? line.kind ?? "";
    storylineNodes.push({
      id: `storyline:${line.id}`,
      kind: "storyline",
      label: line.name?.trim() || "未命名剧情线",
      count: onLine.length,
      children: shown.map(sceneNode),
      defaultExpanded: (line.kind ?? "") === "main",
      ...(line.lifecycle ? { status: line.lifecycle } : {}),
      // 「这条线上次推进是哪章」——数据层第一次能回答，直接写在副标题上。
      subtitle: onLine.length === 0
        ? `${kindLabel} · 还没有场景挂上来`
        : `${kindLabel} · ${onLine.length} 场 · 最近推进第 ${lastChapter} 章`,
      ...(line.goal?.trim() ? { detail: line.goal.trim() } : {}),
    });
  }

  // 没挂任何线的场景单独成组：它们不是不存在，是还没被归因。
  const unmounted = scenes.filter((scene) => !mountedSceneIds.has(scene.id));
  if (unmounted.length > 0) {
    const shown = unmounted
      .slice()
      .sort((a, b) => a.chapterNumber - b.chapterNumber || a.ordinal - b.ordinal || a.id.localeCompare(b.id))
      .slice(0, maxScenes);
    if (shown.length < unmounted.length) truncated = true;
    storylineNodes.push({
      id: "storyline:unmounted",
      kind: "group",
      label: "未挂线",
      count: unmounted.length,
      children: shown.map(sceneNode),
      defaultExpanded: false,
      subtitle: `${unmounted.length} 场 · 还没有归到任何剧情线`,
    });
  }

  return {
    kind: "chapters",
    root: {
      id: "causal",
      kind: "root",
      label: "因果树",
      count: scenes.length,
      children: storylineNodes,
      defaultExpanded: true,
      subtitle: `${storylines.length} 条线 · ${scenes.length} 场`,
    },
    truncated,
  };
}
