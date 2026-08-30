/**
 * 故事地图情节板 · 数据层（纯函数）。
 *
 * X = 章，Y = 线索（冲突 / 伏笔 / 角色弧线）。格子是该线索在该章的节拍。
 * 不再把章节、冲突、伏笔、弧线混成一张 DAG。
 */

import type {
  NarrativeLineSnapshot,
  NarrativeNode,
  NarrativeNodeType,
} from "../../handlers/narrative-line-types";

export type StoryMapLane = "main" | "character_arc" | "conflict" | "foreshadow";
export type StoryMapThreadKind = "conflict" | "foreshadow" | "character_arc";
export type MissingPlanningKind = "冲突" | "角色弧线" | "设定" | "伏笔";

export interface StoryMapNodeData extends Record<string, unknown> {
  id: string;
  title: string;
  summary?: string;
  lane: StoryMapLane;
  laneLabel: string;
  nodeType: NarrativeNodeType;
  chapterNumber?: number;
  status?: string;
  characters?: readonly string[];
  hooks?: readonly string[];
}

export interface StoryMapBeat {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly chapterNumber?: number;
  readonly status?: string;
  readonly nodeType: NarrativeNodeType;
  readonly lane: StoryMapThreadKind;
}

export interface StoryMapChapterColumn {
  readonly chapterNumber: number;
  readonly title: string;
  readonly nodeId?: string;
}

export interface StoryMapThread {
  readonly id: string;
  readonly kind: StoryMapThreadKind;
  readonly title: string;
  readonly status?: string;
  readonly beatsByChapter: Readonly<Record<number, readonly StoryMapBeat[]>>;
  readonly unscheduled: readonly StoryMapBeat[];
}

export interface StoryMapBoard {
  readonly chapters: readonly StoryMapChapterColumn[];
  readonly threads: readonly StoryMapThread[];
}

export const LANE_LABEL: Record<StoryMapThreadKind, string> = {
  conflict: "冲突",
  foreshadow: "伏笔",
  character_arc: "弧线",
};

const PLANNING_KIND_LABELS: readonly MissingPlanningKind[] = ["冲突", "角色弧线", "设定", "伏笔"];

export function resolveStoryMapLane(nodeType: NarrativeNodeType): StoryMapLane {
  switch (nodeType) {
    case "chapter":
    case "event":
      return "main";
    case "character-arc":
    case "setting":
      return "character_arc";
    case "conflict":
    case "payoff":
      return "conflict";
    case "foreshadow":
      return "foreshadow";
    default:
      return "main";
  }
}

export function threadKindFromNode(nodeType: NarrativeNodeType): StoryMapThreadKind | null {
  if (nodeType === "conflict" || nodeType === "payoff") return "conflict";
  if (nodeType === "foreshadow") return "foreshadow";
  if (nodeType === "character-arc") return "character_arc";
  return null;
}

export function hasPlanningNodes(snapshot: NarrativeLineSnapshot | null | undefined): boolean {
  if (!snapshot || !Array.isArray(snapshot.nodes)) return false;
  return snapshot.nodes.some((node) => {
    const lane = resolveStoryMapLane(node.type);
    return lane !== "main" || (node.type !== "chapter" && node.type !== "event");
  });
}

export function computeMissingPlanningKinds(snapshot: NarrativeLineSnapshot | null | undefined): readonly MissingPlanningKind[] {
  if (!snapshot || !Array.isArray(snapshot.nodes)) return PLANNING_KIND_LABELS;
  const lanes = new Set(snapshot.nodes.map((node) => resolveStoryMapLane(node.type)));
  const missing: MissingPlanningKind[] = [];
  if (!lanes.has("conflict")) missing.push("冲突");
  if (!lanes.has("character_arc")) missing.push("角色弧线");
  if (!snapshot.nodes.some((node) => node.type === "setting")) missing.push("设定");
  if (!lanes.has("foreshadow")) missing.push("伏笔");
  return missing;
}

export function buildStoryMapPlanPrompt(chapterCount: number, missing?: readonly MissingPlanningKind[]): string {
  const missingKinds = missing && missing.length > 0 ? missing : PLANNING_KIND_LABELS;
  const needsDissect = missingKinds.some((kind) => kind === "角色弧线" || kind === "设定" || kind === "伏笔");
  const needsArcs = missingKinds.includes("角色弧线");
  const needsConflict = missingKinds.includes("冲突");

  const lines: string[] = [
    `故事地图目前只有 ${chapterCount} 个章节节点，缺这些规划节点：${missingKinds.join(" / ")}，情节板因此停在空态。`,
    "",
    "请按顺序执行：",
  ];
  let step = 1;
  if (needsDissect) {
    lines.push(
      `${step}. 用 book.dissect(apply=true) 拆解已有正文，提取角色卡 / 世界要素 / 关系 / 伏笔 / 章摘要（写入经纬 dynamic 层，status=needs-review）。`,
    );
    step += 1;
  }
  if (needsArcs) {
    lines.push(`${step}. 用 arc.character(action=sync) 抽取各角色的弧线 beats。`);
    step += 1;
  }
  if (needsConflict) {
    lines.push(`${step}. 用 lore.write 把主线冲突写进经纬 conflicts 分类（layer=dynamic、status=needs-review），等我确认后再升 canon。`);
    step += 1;
  }
  lines.push("", "完成后重读 narrative_line 快照，告诉我情节板点亮了哪些线索、还缺哪一类。");
  return lines.join("\n");
}

function toBeat(node: NarrativeNode, kind: StoryMapThreadKind): StoryMapBeat {
  return {
    id: node.id,
    title: node.title,
    summary: node.summary,
    chapterNumber: node.chapterNumber,
    status: node.status,
    nodeType: node.type,
    lane: kind,
  };
}

function beatToNodeData(beat: StoryMapBeat): StoryMapNodeData {
  return {
    id: beat.id,
    title: beat.title,
    summary: beat.summary,
    lane: beat.lane,
    laneLabel: LANE_LABEL[beat.lane],
    nodeType: beat.nodeType,
    chapterNumber: beat.chapterNumber,
    status: beat.status,
    hooks: beat.lane === "foreshadow" ? [beat.title] : undefined,
  };
}

function pushBeat(bucket: Map<number, StoryMapBeat[]>, unscheduled: StoryMapBeat[], beat: StoryMapBeat) {
  if (typeof beat.chapterNumber === "number" && beat.chapterNumber > 0) {
    const list = bucket.get(beat.chapterNumber) ?? [];
    list.push(beat);
    bucket.set(beat.chapterNumber, list);
  } else {
    unscheduled.push(beat);
  }
}

function freezeThread(
  id: string,
  kind: StoryMapThreadKind,
  title: string,
  status: string | undefined,
  bucket: Map<number, StoryMapBeat[]>,
  unscheduled: StoryMapBeat[],
): StoryMapThread {
  const beatsByChapter: Record<number, readonly StoryMapBeat[]> = {};
  for (const [chapter, beats] of bucket) beatsByChapter[chapter] = beats;
  return { id, kind, title, status, beatsByChapter, unscheduled };
}

export function snapshotToPlotBoard(snapshot: NarrativeLineSnapshot | null | undefined): StoryMapBoard {
  if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
    return { chapters: [], threads: [] };
  }

  const nodes = snapshot.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const claimed = new Set<string>();

  const chapterColumns = new Map<number, StoryMapChapterColumn>();
  for (const node of nodes) {
    if (node.type === "chapter" && typeof node.chapterNumber === "number" && node.chapterNumber > 0) {
      chapterColumns.set(node.chapterNumber, {
        chapterNumber: node.chapterNumber,
        title: node.title,
        nodeId: node.id,
      });
    }
  }
  for (const node of nodes) {
    if (threadKindFromNode(node.type) && typeof node.chapterNumber === "number" && node.chapterNumber > 0 && !chapterColumns.has(node.chapterNumber)) {
      chapterColumns.set(node.chapterNumber, {
        chapterNumber: node.chapterNumber,
        title: `第 ${node.chapterNumber} 章`,
      });
    }
  }
  const chapters = [...chapterColumns.values()].sort((a, b) => a.chapterNumber - b.chapterNumber);

  const threads: StoryMapThread[] = [];

  for (const thread of snapshot.conflictThreads ?? []) {
    const bucket = new Map<number, StoryMapBeat[]>();
    const unscheduled: StoryMapBeat[] = [];
    for (const nodeId of thread.nodeIds) {
      const node = byId.get(nodeId);
      if (!node) continue;
      claimed.add(node.id);
      pushBeat(bucket, unscheduled, toBeat(node, "conflict"));
    }
    threads.push(freezeThread(thread.id, "conflict", thread.title, thread.status, bucket, unscheduled));
  }

  for (const thread of snapshot.foreshadowThreads ?? []) {
    const bucket = new Map<number, StoryMapBeat[]>();
    const unscheduled: StoryMapBeat[] = [];
    for (const nodeId of thread.setupNodeIds) {
      const node = byId.get(nodeId);
      if (!node) continue;
      claimed.add(node.id);
      pushBeat(bucket, unscheduled, toBeat(node, "foreshadow"));
    }
    threads.push(freezeThread(thread.id, "foreshadow", thread.title, thread.status, bucket, unscheduled));
  }

  for (const node of nodes) {
    if (claimed.has(node.id)) continue;
    const kind = threadKindFromNode(node.type);
    if (!kind) continue;
    const bucket = new Map<number, StoryMapBeat[]>();
    const unscheduled: StoryMapBeat[] = [];
    pushBeat(bucket, unscheduled, toBeat(node, kind));
    threads.push(freezeThread(node.id, kind, node.title, node.status, bucket, unscheduled));
  }

  return { chapters, threads };
}

export function beatsForChapter(thread: StoryMapThread, chapterNumber: number): readonly StoryMapBeat[] {
  return thread.beatsByChapter[chapterNumber] ?? [];
}

export function storyMapBeatToNodeData(beat: StoryMapBeat): StoryMapNodeData {
  return beatToNodeData(beat);
}
