/**
 * 因果画布的数据层：剧情线 × 场景（纯函数）。
 *
 * 场景与剧情线是多对多。旧的「剧情线 → 场景」树把同一个场景在每条线下各画一遍，
 * 节点身份重复，布局时互相覆盖、叠在一起——这块数据本质上是图，硬塞成树有损。
 * 这里改成图：
 *
 *   泳道    每条剧情线一条，最后是「未挂线」
 *   场景    只出现一次，住在它的主挂载所在的泳道（没有主挂载就住第一条辅助挂载的线）
 *   线路    每条剧情线把它服务的场景按章节先后串起来；场景同时服务别的线时，
 *           那条线会跨泳道经过它——一眼看出两条线在哪里交汇
 *   伏笔    场景里埋下的钩子连到之后回收它的场景（跨章因果）
 *
 * 取数不在这里：场景 / 剧情线 / 挂载来自 scene-store，伏笔标题来自经纬伏笔条目（唯一权威源）。
 * 与承载树同一条纪律：**不静默丢数据**。挂不上线的场景进「未挂线」泳道，而不是消失。
 */

import type { ForeshadowDebtStatus } from "./foreshadow-debts";

export interface CausalStorylineInput {
  readonly id: string;
  readonly name?: string;
  readonly kind?: string;
  readonly lifecycle?: string;
  readonly goal?: string;
  readonly status?: string;
}

export interface CausalSceneInput {
  readonly id: string;
  readonly chapterNumber: number;
  readonly ordinal: number;
  readonly title?: string;
  readonly summary?: string;
  readonly function?: string;
  /** needs-review 的场景要看得出来，否则作者会把机器猜测当成既定事实。 */
  readonly status?: string;
  readonly hooksPlanted?: readonly string[];
  readonly hooksUsed?: readonly string[];
}

export interface CausalMountInput {
  readonly sceneId: string;
  readonly storylineId: string;
  readonly role?: string;
}

/** 经纬伏笔条目：只用来把场景里的钩子标识换成作者认得的标题、判断是否已回收。 */
export interface CausalForeshadowInput {
  readonly id: string;
  readonly entryId?: string;
  readonly title: string;
  readonly status?: ForeshadowDebtStatus;
}

export interface BuildCausalGraphInput {
  readonly storylines?: readonly CausalStorylineInput[];
  readonly scenes?: readonly CausalSceneInput[];
  readonly mounts?: readonly CausalMountInput[];
  readonly foreshadows?: readonly CausalForeshadowInput[];
  /** 写到第几章：用来判断剧情线是否停滞。 */
  readonly currentChapter?: number;
  /** 连续这么多章没推进就算停滞。 */
  readonly stalledGap?: number;
}

export const UNMOUNTED_LANE_ID = "unmounted";

export const STORYLINE_KIND_LABEL: Record<string, string> = {
  main: "主线",
  sub: "支线",
  romance: "感情线",
  faction: "势力线",
  mystery: "悬疑线",
  "character-arc": "角色弧",
  other: "其他",
};

export const SCENE_FUNCTION_LABEL: Record<string, string> = {
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

export interface CausalLane {
  readonly id: string;
  readonly storyline?: CausalStorylineInput;
  readonly label: string;
  readonly kindLabel: string;
  /** 这条线服务的场景数（主 + 辅）。 */
  readonly sceneCount: number;
  readonly lastChapter?: number;
  /** 已停滞的章数（只在超过阈值、且剧情线仍在进行时给出）。 */
  readonly stalledChapters?: number;
}

export interface CausalSceneMount {
  readonly storylineId: string;
  readonly role: "primary" | "supporting";
}

export interface CausalSceneNode {
  readonly scene: CausalSceneInput;
  /** 住在哪条泳道。 */
  readonly laneId: string;
  /** 按泳道顺序排好的挂载；主挂载在前。 */
  readonly mounts: readonly CausalSceneMount[];
  /** 这里埋下、之后没有场景回收、经纬里也没标回收的钩子。 */
  readonly openHooks: readonly string[];
}

export interface CausalLineLink {
  readonly id: string;
  readonly storylineId: string;
  readonly source: string;
  readonly target: string;
}

export interface CausalHookLink {
  readonly id: string;
  readonly hook: string;
  readonly label: string;
  readonly source: string;
  readonly target: string;
}

export interface CausalGraph {
  readonly lanes: readonly CausalLane[];
  readonly scenes: readonly CausalSceneNode[];
  readonly lineLinks: readonly CausalLineLink[];
  readonly hookLinks: readonly CausalHookLink[];
  /** 有场景的章号，升序。 */
  readonly chapters: readonly number[];
}

const DEFAULT_STALLED_GAP = 3;
const ACTIVE_LIFECYCLES = new Set(["planned", "active", "paused", undefined]);

function byStoryOrder(a: CausalSceneInput, b: CausalSceneInput): number {
  // id 兜底：ordinal 没有唯一约束，重号时顺序仍须确定。
  return a.chapterNumber - b.chapterNumber || a.ordinal - b.ordinal || a.id.localeCompare(b.id);
}

function cleanHooks(hooks: readonly string[] | undefined): string[] {
  return [...new Set((hooks ?? []).map((hook) => hook.trim()).filter(Boolean))];
}

export function buildCausalGraph(input: BuildCausalGraphInput): CausalGraph {
  const storylines = input.storylines ?? [];
  const scenes = [...(input.scenes ?? [])].sort(byStoryOrder);
  const laneIndex = new Map(storylines.map((line, index) => [line.id, index]));
  const sceneIds = new Set(scenes.map((scene) => scene.id));

  // 挂载：指向已删除场景 / 剧情线的安静跳过，不产出悬空连线。
  const mountsByScene = new Map<string, CausalSceneMount[]>();
  for (const mount of input.mounts ?? []) {
    if (!sceneIds.has(mount.sceneId) || !laneIndex.has(mount.storylineId)) continue;
    const list = mountsByScene.get(mount.sceneId) ?? [];
    if (list.some((existing) => existing.storylineId === mount.storylineId)) continue;
    list.push({ storylineId: mount.storylineId, role: mount.role === "supporting" ? "supporting" : "primary" });
    mountsByScene.set(mount.sceneId, list);
  }
  for (const list of mountsByScene.values()) {
    list.sort((a, b) => (a.role === b.role ? 0 : a.role === "primary" ? -1 : 1) || laneIndex.get(a.storylineId)! - laneIndex.get(b.storylineId)!);
  }

  // 伏笔：钩子标识可能是伏笔 id、经纬条目 id 或标题，统一换成作者认得的标题。
  const foreshadowOf = (hook: string) =>
    (input.foreshadows ?? []).find((item) => item.id === hook || item.entryId === hook || item.title === hook);
  const hookLinks: CausalHookLink[] = [];
  const usedLater = new Set<string>();
  for (const [index, scene] of scenes.entries()) {
    for (const hook of cleanHooks(scene.hooksUsed)) {
      // 回收连到它之前最近一次埋下这个钩子的场景。
      for (let back = index - 1; back >= 0; back--) {
        const planted = scenes[back]!;
        if (!cleanHooks(planted.hooksPlanted).includes(hook)) continue;
        usedLater.add(`${planted.id}\u0000${hook}`);
        hookLinks.push({
          id: `hook:${planted.id}:${scene.id}:${hook}`,
          hook,
          label: foreshadowOf(hook)?.title ?? hook,
          source: planted.id,
          target: scene.id,
        });
        break;
      }
    }
  }

  const sceneNodes: CausalSceneNode[] = scenes.map((scene) => {
    const mounts = mountsByScene.get(scene.id) ?? [];
    return {
      scene,
      laneId: mounts[0]?.storylineId ?? UNMOUNTED_LANE_ID,
      mounts,
      openHooks: cleanHooks(scene.hooksPlanted).filter(
        (hook) => !usedLater.has(`${scene.id}\u0000${hook}`) && foreshadowOf(hook)?.status !== "paid_off",
      ),
    };
  });

  const lineLinks: CausalLineLink[] = [];
  const stalledGap = input.stalledGap ?? DEFAULT_STALLED_GAP;
  const lanes: CausalLane[] = storylines.map((line) => {
    const onLine = sceneNodes.filter((node) => node.mounts.some((mount) => mount.storylineId === line.id));
    onLine.forEach((node, index) => {
      if (index === 0) return;
      const previous = onLine[index - 1]!;
      lineLinks.push({ id: `line:${line.id}:${previous.scene.id}:${node.scene.id}`, storylineId: line.id, source: previous.scene.id, target: node.scene.id });
    });
    const lastChapter = onLine.at(-1)?.scene.chapterNumber;
    const gap = lastChapter !== undefined && input.currentChapter !== undefined ? input.currentChapter - lastChapter : undefined;
    return {
      id: line.id,
      storyline: line,
      label: line.name?.trim() || "未命名剧情线",
      kindLabel: STORYLINE_KIND_LABEL[line.kind ?? "other"] ?? line.kind ?? "",
      sceneCount: onLine.length,
      ...(lastChapter !== undefined ? { lastChapter } : {}),
      ...(gap !== undefined && gap >= stalledGap && ACTIVE_LIFECYCLES.has(line.lifecycle) ? { stalledChapters: gap } : {}),
    };
  });
  // 「未挂线」泳道始终在：它既装没归因的场景，也是把场景从所有线上摘下的落点。
  lanes.push({
    id: UNMOUNTED_LANE_ID,
    label: "未挂线",
    kindLabel: "",
    sceneCount: sceneNodes.filter((node) => node.laneId === UNMOUNTED_LANE_ID).length,
  });

  return {
    lanes,
    scenes: sceneNodes,
    lineLinks,
    hookLinks,
    chapters: [...new Set(scenes.map((scene) => scene.chapterNumber))].sort((a, b) => a - b),
  };
}
