/**
 * 四张正图数据层（纯函数）。
 *
 *   关系树   —— 共现图的生成树（枢纽优先，节点只出现一次）
 *   世界观   —— 现有 NarraBench 分类树（buildStoryTree）
 *   章节分叉 —— 卷纲 → 章；没有卷就按章摘要铺开，不假装有分支
 *   总图     —— 三棵的浅层总览
 *
 * 布局交给 tidy-tree-layout；这里只负责树，不画坐标。
 */

import { looksLikeEntity, splitCompositeName } from "./entity-name-heuristics";
import {
  buildStoryTree,
  type BuildStoryTreeInput,
  type StoryTreeNode,
  type TreeEntryInput,
  type TreeRelationInput,
} from "./story-tree";
import type { LayoutInputNode } from "./tidy-tree-layout";

export type CanonicalTreeKind =
  | "relations"
  | "worldview"
  | "chapters"
  | "overview"
  | "timeline"
  | "chronicle"
  | "causal";

export type CanonicalNodeKind =
  | "root"
  | "group"
  | "entity"
  | "volume"
  | "chapter"
  | "beat"
  | "dimension"
  | "feature"
  | "category"
  | "entry"
  | "event"
  | "character"
  | "storyline"
  | "scene";

export interface CooccurrenceEdgeInput {
  readonly source?: string;
  readonly target?: string;
  readonly weight?: number;
  readonly coCount?: number;
}

export interface VolumeBeatInput {
  readonly id?: string;
  readonly title?: string;
  readonly status?: string;
  readonly notes?: string;
}

export interface VolumeTreeInput {
  readonly id?: string;
  readonly title?: string;
  readonly chapterRange?: { readonly from?: number; readonly to?: number };
  readonly status?: string;
  readonly goal?: string;
  readonly mainlineBeats?: readonly VolumeBeatInput[];
}

export interface TimelineEventInput {
  readonly id?: string;
  readonly chapterNumber?: number;
  readonly subject?: string;
  readonly predicate?: string;
  readonly object?: string;
  readonly eventType?: string;
  readonly evidenceText?: string;
  readonly causedBy?: readonly string[];
  readonly subjectEntryId?: string;
  readonly riskLevel?: string;
}

export interface CanonicalTreeNode {
  readonly id: string;
  readonly kind: CanonicalNodeKind;
  readonly label: string;
  readonly count: number;
  readonly children: readonly CanonicalTreeNode[];
  readonly defaultExpanded: boolean;
  readonly entryId?: string;
  readonly chapterNumber?: number;
  readonly subtitle?: string;
  readonly detail?: string;
  readonly status?: string;
  readonly degree?: number;
  readonly webNovelSpecific?: boolean;
}

export interface CanonicalForest {
  readonly kind: CanonicalTreeKind;
  readonly root: CanonicalTreeNode;
  readonly truncated: boolean;
  readonly emptyReason?: string;
}

export interface BuildCanonicalTreesInput extends BuildStoryTreeInput {
  readonly cooccurrence?: readonly CooccurrenceEdgeInput[];
  readonly volumes?: readonly VolumeTreeInput[];
  readonly events?: readonly TimelineEventInput[];
  readonly maxRelationHubs?: number;
  readonly maxRelationChildren?: number;
  readonly maxChaptersPerVolume?: number;
  readonly maxEventsPerChapter?: number;
}

export interface CanonicalTrees {
  readonly relations: CanonicalForest;
  readonly worldview: CanonicalForest;
  readonly chapters: CanonicalForest;
  readonly overview: CanonicalForest;
  readonly timeline: CanonicalForest;
  readonly chronicle: CanonicalForest;
  readonly causal: CanonicalForest;
}

const SETTING_CATEGORIES = new Set(["characters", "factions", "locations", "props"]);
const DEFAULT_MAX_HUBS = 16;
const DEFAULT_MAX_RELATION_CHILDREN = 8;
const DEFAULT_MAX_CHAPTERS = 40;
const OVERVIEW_DEPTH = 3;
const OVERVIEW_MAX_CHILDREN = 8;

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function toChapter(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function chapterFromTitle(title: string | undefined): number | undefined {
  if (!title) return undefined;
  const match = /第\s*(\d+)\s*章/u.exec(title);
  return match ? toChapter(match[1]) : undefined;
}

function parseChapterRange(value: unknown): { from: number; to: number } | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const match = /(\d+)\s*[-~～到至—]\s*(\d+)/u.exec(value);
    if (!match) return undefined;
    const from = toChapter(match[1]);
    const to = toChapter(match[2]);
    if (!from || !to || to < from) return undefined;
    return { from, to };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const from = toChapter(record.from ?? record.start);
    const to = toChapter(record.to ?? record.end);
    if (!from || !to || to < from) return undefined;
    return { from, to };
  }
  return undefined;
}

function emptyRoot(id: string, label: string, kind: CanonicalNodeKind = "root"): CanonicalTreeNode {
  return {
    id,
    kind,
    label,
    count: 0,
    children: [],
    defaultExpanded: true,
  };
}

function countLeaves(node: CanonicalTreeNode): number {
  if (node.children.length === 0) return node.kind === "root" || node.kind === "group" ? 0 : 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

export function collectDefaultExpanded(node: CanonicalTreeNode, into: Set<string> = new Set()): Set<string> {
  if (node.defaultExpanded) {
    into.add(node.id);
    for (const child of node.children) collectDefaultExpanded(child, into);
  }
  return into;
}

export function indexCanonicalTree(
  node: CanonicalTreeNode,
  into: Map<string, CanonicalTreeNode> = new Map(),
): Map<string, CanonicalTreeNode> {
  into.set(node.id, node);
  for (const child of node.children) indexCanonicalTree(child, into);
  return into;
}

export function toLayoutInput(node: CanonicalTreeNode, expanded: ReadonlySet<string>): LayoutInputNode {
  const open = expanded.has(node.id);
  return {
    id: node.id,
    children: open ? node.children.map((child) => toLayoutInput(child, expanded)) : [],
  };
}

export function pruneCanonicalTree(
  node: CanonicalTreeNode,
  depthLeft: number,
  maxChildren: number,
): CanonicalTreeNode {
  if (depthLeft <= 0 || node.children.length === 0) {
    if (node.children.length === 0) return node;
    return {
      ...node,
      children: [],
      subtitle: node.subtitle ?? `下有 ${node.count} 项，点开该图查看`,
    };
  }
  const visible = node.children.slice(0, maxChildren);
  const hidden = node.children.length - visible.length;
  const children = visible.map((child) => pruneCanonicalTree(child, depthLeft - 1, maxChildren));
  return {
    ...node,
    children,
    ...(hidden > 0 ? { subtitle: node.subtitle ?? `另有 ${hidden} 项未展开` } : {}),
  };
}

export function canonicalFromStoryNode(node: StoryTreeNode): CanonicalTreeNode {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    count: node.count,
    children: node.children.map(canonicalFromStoryNode),
    defaultExpanded: node.defaultExpanded,
    ...(node.entryId ? { entryId: node.entryId } : {}),
    ...(node.subtitle ? { subtitle: node.subtitle } : {}),
    ...(node.detail ? { detail: node.detail } : {}),
    ...(node.status ? { status: node.status } : {}),
    ...(node.degree !== undefined ? { degree: node.degree } : {}),
    ...(node.webNovelSpecific ? { webNovelSpecific: true } : {}),
  };
}

interface EntityRef {
  readonly name: string;
  readonly entryId?: string;
  readonly category?: string;
  readonly subtitle?: string;
}

function entityIndex(entries: readonly TreeEntryInput[]): Map<string, EntityRef> {
  const index = new Map<string, EntityRef>();
  const remember = (name: string, ref: EntityRef) => {
    const key = clean(name);
    if (!key) return;
    if (!index.has(key)) index.set(key, { ...ref, name: key });
  };
  for (const entry of entries) {
    const category = clean(entry.category);
    if (!SETTING_CATEGORIES.has(category)) continue;
    const name = clean(entry.fields?.name) || clean(entry.title);
    if (!name) continue;
    const subtitle = clean(entry.fields?.roleType) || clean(entry.fields?.type) || clean(entry.fields?.locationType);
    remember(name, {
      name,
      entryId: entry.id,
      category,
      ...(subtitle ? { subtitle } : {}),
    });
  }
  return index;
}

function acceptRelationName(name: string, known: ReadonlyMap<string, EntityRef>): boolean {
  const key = clean(name);
  if (!key) return false;
  if (known.has(key)) return true;
  return looksLikeEntity(key);
}

/**
 * 共现生成树：按度数从高到低 BFS，每个实体只出现一次，避免把网硬画成有环图。
 */
export function buildRelationTree(input: {
  readonly edges?: readonly CooccurrenceEdgeInput[];
  readonly entries?: readonly TreeEntryInput[];
  readonly maxHubs?: number;
  readonly maxChildren?: number;
}): CanonicalForest {
  const known = entityIndex(input.entries ?? []);
  const maxHubs = input.maxHubs ?? DEFAULT_MAX_HUBS;
  const maxChildren = input.maxChildren ?? DEFAULT_MAX_RELATION_CHILDREN;
  const adjacency = new Map<string, Map<string, { weight: number; coCount: number }>>();
  const bump = (source: string, target: string, weight: number, coCount: number) => {
    if (source === target) return;
    if (!acceptRelationName(source, known) || !acceptRelationName(target, known)) return;
    const from = adjacency.get(source) ?? new Map();
    const existing = from.get(target);
    if (!existing || weight > existing.weight) from.set(target, { weight, coCount });
    adjacency.set(source, from);
  };

  for (const edge of input.edges ?? []) {
    const source = clean(edge.source);
    const target = clean(edge.target);
    if (!source || !target) continue;
    const weight = typeof edge.weight === "number" && Number.isFinite(edge.weight) ? edge.weight : 1;
    const coCount = typeof edge.coCount === "number" && edge.coCount > 0 ? edge.coCount : 1;
    bump(source, target, weight, coCount);
    bump(target, source, weight, coCount);
  }

  if (adjacency.size === 0) {
    return {
      kind: "relations",
      root: emptyRoot("relations", "关系树"),
      truncated: false,
      emptyReason: "还没有共现边。正文结算后，同场出现的人物/地点才会连上。",
    };
  }

  const degree = [...adjacency.entries()]
    .map(([name, neighbors]) => ({ name, degree: neighbors.size }))
    .sort((left, right) => right.degree - left.degree || left.name.localeCompare(right.name, "zh"));

  const used = new Set<string>();
  let truncated = degree.length > maxHubs;
  const hubs: CanonicalTreeNode[] = [];

  const makeEntityNode = (
    name: string,
    children: readonly CanonicalTreeNode[],
    expanded: boolean,
  ): CanonicalTreeNode => {
    const ref = known.get(name);
    return {
      id: `rel:${encodeURIComponent(name)}`,
      kind: "entity",
      label: name,
      count: Math.max(1, children.length),
      children,
      defaultExpanded: expanded,
      degree: adjacency.get(name)?.size ?? 0,
      ...(ref?.entryId ? { entryId: ref.entryId } : {}),
      ...(ref?.subtitle ? { subtitle: ref.subtitle } : {}),
    };
  };

  for (const hub of degree) {
    if (hubs.length >= maxHubs) {
      truncated = true;
      break;
    }
    if (used.has(hub.name)) continue;
    used.add(hub.name);
    const neighbors = [...(adjacency.get(hub.name)?.entries() ?? [])]
      .filter(([name]) => !used.has(name))
      .sort((left, right) => right[1].weight - left[1].weight || left[0].localeCompare(right[0], "zh"));
    const visible = neighbors.slice(0, maxChildren);
    if (neighbors.length > visible.length) truncated = true;
    const childNodes = visible.map(([name, meta]) => {
      used.add(name);
      const child = makeEntityNode(name, [], false);
      return {
        ...child,
        subtitle: [child.subtitle, meta.coCount > 1 ? `同场 ${meta.coCount} 次` : undefined]
          .filter(Boolean)
          .join(" · ") || child.subtitle,
      };
    });
    hubs.push(makeEntityNode(hub.name, childNodes, true));
  }

  const leftover = degree.length - used.size;
  if (leftover > 0) truncated = true;

  const root: CanonicalTreeNode = {
    id: "relations",
    kind: "root",
    label: "关系树",
    count: used.size,
    children: hubs,
    defaultExpanded: true,
    subtitle: truncated ? `按共现枢纽展开，已省略部分节点` : `按同场共现连边，${used.size} 个实体`,
  };

  return { kind: "relations", root, truncated };
}

export function relationsFromCooccurrence(
  edges: readonly CooccurrenceEdgeInput[] | undefined,
): TreeRelationInput[] {
  const relations: TreeRelationInput[] = [];
  for (const edge of edges ?? []) {
    const source = clean(edge.source);
    const target = clean(edge.target);
    if (!source || !target || source === target) continue;
    relations.push({
      sourceName: source,
      targetName: target,
      kind: "cooccurrence",
      predicate: "共现",
    });
  }
  return relations;
}

export function buildWorldviewTree(input: BuildStoryTreeInput): CanonicalForest {
  const tree = buildStoryTree(input);
  if (tree.totalEntries === 0) {
    return {
      kind: "worldview",
      root: emptyRoot("worldview", "世界观"),
      truncated: false,
      emptyReason: "经纬里还没有条目。先建立角色、地点、设定，或对已有正文跑一次拆书。",
    };
  }
  const converted = canonicalFromStoryNode(tree.root);
  return {
    kind: "worldview",
    root: {
      ...converted,
      id: "worldview",
      label: "世界观",
    },
    truncated: tree.root.children.some((dimension) =>
      dimension.children.some((feature) =>
        feature.children.some((category) => Boolean(category.subtitle?.includes("另有"))),
      ),
    ),
  };
}

interface ChapterRef {
  readonly chapterNumber: number;
  readonly title: string;
  readonly entryId?: string;
  readonly detail?: string;
}

function readChapters(entries: readonly TreeEntryInput[]): ChapterRef[] {
  const byNumber = new Map<number, ChapterRef>();
  for (const entry of entries) {
    if (clean(entry.category) !== "chapter-summaries") continue;
    const fields = entry.fields ?? {};
    const chapterNumber = toChapter(fields.chapterNumber)
      ?? toChapter(fields.chapter_number)
      ?? chapterFromTitle(entry.title);
    if (!chapterNumber) continue;
    const title = clean(fields.title) || clean(entry.title) || `第 ${chapterNumber} 章`;
    const detail = clean(entry.summaryMd) || clean(entry.contentMd) || clean(fields.summary);
    const existing = byNumber.get(chapterNumber);
    const next: ChapterRef = {
      chapterNumber,
      title,
      entryId: entry.id,
      ...(detail ? { detail } : {}),
    };
    if (!existing || (detail && !existing.detail) || (detail && existing.detail && detail.length > existing.detail.length)) {
      byNumber.set(chapterNumber, next);
    }
  }
  return [...byNumber.values()].sort((left, right) => left.chapterNumber - right.chapterNumber);
}

function readVolumesFromEntries(entries: readonly TreeEntryInput[]): VolumeTreeInput[] {
  const volumes: VolumeTreeInput[] = [];
  for (const entry of entries) {
    if (clean(entry.category) !== "outline") continue;
    const fields = entry.fields ?? {};
    if (Array.isArray(fields.volumes)) {
      for (const item of fields.volumes) {
        if (!item || typeof item !== "object") continue;
        volumes.push(item as VolumeTreeInput);
      }
      continue;
    }
    const title = clean(fields.name) || clean(entry.title);
    const range = parseChapterRange(fields.chapterRange)
      ?? parseChapterRange(fields.chapters)
      ?? parseChapterRange(fields.chapterRangeText);
    if (!title || !range) continue;
    volumes.push({
      id: entry.id,
      title,
      chapterRange: range,
      goal: clean(fields.goal),
      status: clean(fields.status) || clean(entry.status),
    });
  }
  return volumes;
}

function normalizeVolumes(volumes: readonly VolumeTreeInput[]): Array<{
  id: string;
  title: string;
  from: number;
  to: number;
  status?: string;
  goal?: string;
  mainlineBeats: readonly VolumeBeatInput[];
}> {
  const out: Array<{
    id: string;
    title: string;
    from: number;
    to: number;
    status?: string;
    goal?: string;
    mainlineBeats: readonly VolumeBeatInput[];
  }> = [];
  for (const [index, volume] of volumes.entries()) {
    const title = clean(volume.title) || `第 ${index + 1} 卷`;
    const range = parseChapterRange(volume.chapterRange);
    if (!range) continue;
    out.push({
      id: clean(volume.id) || `vol-${index + 1}`,
      title,
      from: range.from,
      to: range.to,
      ...(clean(volume.status) ? { status: clean(volume.status) } : {}),
      ...(clean(volume.goal) ? { goal: clean(volume.goal) } : {}),
      mainlineBeats: volume.mainlineBeats ?? [],
    });
  }
  return out.sort((left, right) => left.from - right.from);
}

function chapterNode(ref: ChapterRef, placeholder: boolean): CanonicalTreeNode {
  return {
    id: `chapter:${ref.chapterNumber}`,
    kind: "chapter",
    label: /第\s*\d+\s*章/u.test(ref.title) ? ref.title : `第 ${ref.chapterNumber} 章 ${ref.title}`,
    count: 1,
    children: [],
    defaultExpanded: false,
    chapterNumber: ref.chapterNumber,
    ...(ref.entryId ? { entryId: ref.entryId } : {}),
    ...(ref.detail ? { detail: ref.detail } : {}),
    ...(placeholder ? { subtitle: "尚无摘要" } : {}),
  };
}

export function buildChapterForkTree(input: {
  readonly entries?: readonly TreeEntryInput[];
  readonly volumes?: readonly VolumeTreeInput[];
  readonly maxChaptersPerVolume?: number;
}): CanonicalForest {
  const chapters = readChapters(input.entries ?? []);
  const volumes = normalizeVolumes(
    (input.volumes && input.volumes.length > 0) ? input.volumes : readVolumesFromEntries(input.entries ?? []),
  );
  const maxChapters = input.maxChaptersPerVolume ?? DEFAULT_MAX_CHAPTERS;
  const chapterByNumber = new Map(chapters.map((chapter) => [chapter.chapterNumber, chapter]));

  if (volumes.length === 0 && chapters.length === 0) {
    return {
      kind: "chapters",
      root: emptyRoot("chapters", "章节"),
      truncated: false,
      emptyReason: "还没有卷纲，也没有章节摘要。先写卷纲或对已写章节做摘要。",
    };
  }

  let truncated = false;
  const assigned = new Set<number>();

  const makeChapterChildren = (from: number, to: number): CanonicalTreeNode[] => {
    const nodes: CanonicalTreeNode[] = [];
    const total = to - from + 1;
    const limit = Math.min(total, maxChapters);
    if (total > limit) truncated = true;
    for (let chapterNumber = from; chapterNumber < from + limit; chapterNumber += 1) {
      assigned.add(chapterNumber);
      const existing = chapterByNumber.get(chapterNumber);
      nodes.push(chapterNode(
        existing ?? { chapterNumber, title: `第 ${chapterNumber} 章` },
        !existing,
      ));
    }
    return nodes;
  };

  const volumeNodes: CanonicalTreeNode[] = volumes.map((volume) => {
    const beats: CanonicalTreeNode[] = [];
    for (const [index, beat] of volume.mainlineBeats.entries()) {
      const title = clean(beat.title);
      if (!title) continue;
      beats.push({
        id: `beat:${volume.id}:${clean(beat.id) || index}`,
        kind: "beat",
        label: title,
        count: 1,
        children: [],
        defaultExpanded: false,
        ...(clean(beat.status) ? { status: clean(beat.status) } : {}),
        ...(clean(beat.notes) ? { detail: clean(beat.notes) } : {}),
      });
    }
    const chapterChildren = makeChapterChildren(volume.from, volume.to);
    return {
      id: `volume:${volume.id}`,
      kind: "volume",
      label: volume.title,
      count: volume.to - volume.from + 1,
      children: [...beats, ...chapterChildren],
      defaultExpanded: true,
      subtitle: `第 ${volume.from}–${volume.to} 章`,
      ...(volume.status ? { status: volume.status } : {}),
      ...(volume.goal ? { detail: volume.goal } : {}),
    };
  });

  const leftover = chapters.filter((chapter) => !assigned.has(chapter.chapterNumber));
  if (volumes.length > 0 && leftover.length > 0) {
    truncated = leftover.length > maxChapters || truncated;
    volumeNodes.push({
      id: "volume:unassigned",
      kind: "volume",
      label: "未分卷",
      count: leftover.length,
      children: leftover.slice(0, maxChapters).map((chapter) => chapterNode(chapter, false)),
      defaultExpanded: false,
      subtitle: "有摘要但不在任何卷区间里",
    });
  }

  const chapterOnly = volumes.length === 0
    ? chapters.slice(0, maxChapters).map((chapter) => chapterNode(chapter, false))
    : [];
  if (volumes.length === 0 && chapters.length > maxChapters) truncated = true;

  const children = volumeNodes.length > 0 ? volumeNodes : chapterOnly;
  const total = volumes.length > 0
    ? volumes.reduce((sum, volume) => sum + (volume.to - volume.from + 1), 0) + leftover.length
    : chapters.length;

  return {
    kind: "chapters",
    root: {
      id: "chapters",
      kind: "root",
      label: "章节",
      count: total,
      children,
      defaultExpanded: true,
      subtitle: volumes.length > 0
        ? `${volumes.length} 卷 · ${total} 章`
        : `${chapters.length} 章（还没有卷纲，按摘要平铺）`,
    },
    truncated,
  };
}

const ARC_EVENT_TYPES = new Set(["character_state_changed", "relationship_changed"]);
const DEFAULT_MAX_EVENTS = 12;

function eventDetail(event: TimelineEventInput): string | undefined {
  const evidence = clean(event.evidenceText);
  if (evidence) return evidence;
  const predicate = clean(event.predicate);
  const object = clean(event.object);
  const joined = [predicate, object].filter(Boolean).join(" · ");
  return joined || undefined;
}

function eventLabel(event: TimelineEventInput): string {
  const subject = clean(event.subject);
  const predicate = clean(event.predicate);
  const object = clean(event.object);
  const core = [subject, predicate, object].filter(Boolean).join(" ");
  return core || clean(event.eventType) || "未命名事件";
}

function eventNode(event: TimelineEventInput, children: readonly CanonicalTreeNode[] = []): CanonicalTreeNode {
  const id = clean(event.id) || `event:${event.chapterNumber}:${eventLabel(event)}`;
  const detail = eventDetail(event);
  return {
    id: `event:${id}`,
    kind: "event",
    label: eventLabel(event),
    count: Math.max(1, children.length),
    children,
    defaultExpanded: children.length > 0,
    ...(toChapter(event.chapterNumber) ? { chapterNumber: toChapter(event.chapterNumber) } : {}),
    ...(clean(event.subjectEntryId) ? { entryId: clean(event.subjectEntryId) } : {}),
    ...(detail ? { detail } : {}),
    ...(clean(event.eventType) ? { subtitle: clean(event.eventType) } : {}),
    ...(clean(event.riskLevel) ? { status: clean(event.riskLevel) } : {}),
  };
}

/**
 * 发展历程：章 → 该章事件。同章因果才往下挂，跨章只在副标题标明来源，不把树拧成网。
 */
export function buildTimelineTree(input: {
  readonly events?: readonly TimelineEventInput[];
  readonly entries?: readonly TreeEntryInput[];
  readonly maxEventsPerChapter?: number;
}): CanonicalForest {
  const maxEvents = input.maxEventsPerChapter ?? DEFAULT_MAX_EVENTS;
  const chapters = readChapters(input.entries ?? []);
  const chapterByNumber = new Map(chapters.map((chapter) => [chapter.chapterNumber, chapter]));
  const validEvents = (input.events ?? []).filter((event) => toChapter(event.chapterNumber));
  const byId = new Map<string, TimelineEventInput>();
  for (const event of validEvents) {
    const id = clean(event.id);
    if (id) byId.set(id, event);
  }

  const childrenOf = new Map<string, TimelineEventInput[]>();
  const nested = new Set<string>();
  for (const event of validEvents) {
    const id = clean(event.id);
    if (!id) continue;
    const causes = (event.causedBy ?? []).map(clean).filter(Boolean);
    const sameChapterCause = causes
      .map((causeId) => byId.get(causeId))
      .find((cause) => cause && toChapter(cause.chapterNumber) === toChapter(event.chapterNumber));
    if (!sameChapterCause) continue;
    const causeId = clean(sameChapterCause.id);
    if (!causeId || causeId === id) continue;
    const bucket = childrenOf.get(causeId) ?? [];
    bucket.push(event);
    childrenOf.set(causeId, bucket);
    nested.add(id);
  }

  const byChapter = new Map<number, TimelineEventInput[]>();
  for (const event of validEvents) {
    const id = clean(event.id);
    if (id && nested.has(id)) continue;
    const chapterNumber = toChapter(event.chapterNumber)!;
    const bucket = byChapter.get(chapterNumber) ?? [];
    bucket.push(event);
    byChapter.set(chapterNumber, bucket);
  }

  const chapterNumbers = [...new Set([
    ...chapters.map((chapter) => chapter.chapterNumber),
    ...byChapter.keys(),
  ])].sort((left, right) => left - right);

  if (chapterNumbers.length === 0) {
    return {
      kind: "timeline",
      root: emptyRoot("timeline", "发展历程"),
      truncated: false,
      emptyReason: "还没有叙事事件。写完章并结算后，发展历程会按章挂上发生过的事。",
    };
  }

  let truncated = false;
  const makeEventForest = (event: TimelineEventInput): CanonicalTreeNode => {
    const id = clean(event.id);
    const nestedEvents = id ? (childrenOf.get(id) ?? []) : [];
    return eventNode(event, nestedEvents.map(makeEventForest));
  };

  const chapterNodes: CanonicalTreeNode[] = chapterNumbers.map((chapterNumber) => {
    const events = byChapter.get(chapterNumber) ?? [];
    if (events.length > maxEvents) truncated = true;
    const existing = chapterByNumber.get(chapterNumber);
    const eventChildren = events.slice(0, maxEvents).map(makeEventForest);
    return {
      ...chapterNode(existing ?? { chapterNumber, title: `第 ${chapterNumber} 章` }, !existing),
      count: Math.max(1, events.length),
      children: eventChildren,
      defaultExpanded: true,
      subtitle: events.length > 0 ? `${events.length} 件事` : existing ? "有摘要，还没有事件" : "尚无摘要",
    };
  });

  return {
    kind: "timeline",
    root: {
      id: "timeline",
      kind: "root",
      label: "发展历程",
      count: validEvents.length,
      children: chapterNodes,
      defaultExpanded: true,
      subtitle: `${chapterNumbers.length} 章 · ${validEvents.length} 个事件`,
    },
    truncated,
  };
}

function tensionOf(entry: TreeEntryInput): number | undefined {
  const fields = entry.fields ?? {};
  const raw = fields.tensionScore ?? fields.tension_score;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * 章节脉络：表世界（章面摘要）与里世界（角色内在变化）分成两枝。
 * 不再画对照条或螺旋。
 */
export function buildChronicleTree(input: {
  readonly entries?: readonly TreeEntryInput[];
  readonly events?: readonly TimelineEventInput[];
  readonly maxEventsPerChapter?: number;
}): CanonicalForest {
  const chapters = readChapters(input.entries ?? []);
  const maxEvents = input.maxEventsPerChapter ?? DEFAULT_MAX_EVENTS;
  const surface: CanonicalTreeNode[] = chapters.map((chapter) => {
    const source = (input.entries ?? []).find((entry) => {
      if (clean(entry.category) !== "chapter-summaries") return false;
      const fields = entry.fields ?? {};
      return (toChapter(fields.chapterNumber) ?? toChapter(fields.chapter_number) ?? chapterFromTitle(entry.title)) === chapter.chapterNumber;
    });
    const tension = source ? tensionOf(source) : undefined;
    return {
      ...chapterNode(chapter, false),
      defaultExpanded: false,
      ...(tension !== undefined ? { subtitle: `张力 ${tension}` } : {}),
    };
  });

  const innerByCharacter = new Map<string, { entryId?: string; events: TimelineEventInput[] }>();
  for (const event of input.events ?? []) {
    const type = clean(event.eventType);
    if (type && !ARC_EVENT_TYPES.has(type)) continue;
    if (!toChapter(event.chapterNumber)) continue;
    const names = [
      ...splitCompositeName(event.subject ?? "").names,
      ...(type === "relationship_changed" ? splitCompositeName(event.object ?? "").names : []),
    ];
    for (const name of names) {
      const key = clean(name);
      if (!key || !looksLikeEntity(key)) continue;
      const bucket = innerByCharacter.get(key) ?? { events: [] };
      if (!bucket.entryId && clean(event.subjectEntryId)) bucket.entryId = clean(event.subjectEntryId);
      bucket.events.push({ ...event, subject: key });
      innerByCharacter.set(key, bucket);
    }
  }

  const inner: CanonicalTreeNode[] = [...innerByCharacter.entries()]
    .sort((left, right) => right[1].events.length - left[1].events.length || left[0].localeCompare(right[0], "zh"))
    .map(([name, bucket]) => {
      const events = [...bucket.events].sort((left, right) => (toChapter(left.chapterNumber) ?? 0) - (toChapter(right.chapterNumber) ?? 0));
      const visible = events.slice(0, maxEvents);
      return {
        id: `character:${encodeURIComponent(name)}`,
        kind: "character" as const,
        label: name,
        count: events.length,
        children: visible.map((event) => eventNode(event)),
        defaultExpanded: false,
        ...(bucket.entryId ? { entryId: bucket.entryId } : {}),
        subtitle: `${events.length} 次内在变化`,
      } satisfies CanonicalTreeNode;
    });

  const turning: CanonicalTreeNode[] = [];
  for (const chapter of chapters) {
    const source = (input.entries ?? []).find((entry) => {
      if (clean(entry.category) !== "chapter-summaries") return false;
      const fields = entry.fields ?? {};
      return (toChapter(fields.chapterNumber) ?? chapterFromTitle(entry.title)) === chapter.chapterNumber;
    });
    const tension = source ? tensionOf(source) : undefined;
    const highRisk = (input.events ?? []).some((event) =>
      toChapter(event.chapterNumber) === chapter.chapterNumber && clean(event.riskLevel) === "high",
    );
    if ((tension !== undefined && tension >= 8) || highRisk) {
      turning.push({
        ...chapterNode(chapter, false),
        id: `turning:${chapter.chapterNumber}`,
        subtitle: highRisk ? "高风险" : `张力 ${tension}`,
      });
    }
  }

  const branches: CanonicalTreeNode[] = [];
  if (surface.length > 0) {
    branches.push({
      id: "chronicle:surface",
      kind: "group",
      label: "表世界",
      count: surface.length,
      children: surface,
      defaultExpanded: true,
      subtitle: "章面摘要",
    });
  }
  if (inner.length > 0) {
    branches.push({
      id: "chronicle:inner",
      kind: "group",
      label: "里世界",
      count: inner.reduce((sum, node) => sum + node.count, 0),
      children: inner,
      defaultExpanded: true,
      subtitle: "角色内在变化",
    });
  }
  if (turning.length > 0) {
    branches.push({
      id: "chronicle:turning",
      kind: "group",
      label: "转折",
      count: turning.length,
      children: turning,
      defaultExpanded: true,
      subtitle: "高张力或高风险章",
    });
  }

  if (branches.length === 0) {
    return {
      kind: "chronicle",
      root: emptyRoot("chronicle", "章节脉络"),
      truncated: false,
      emptyReason: "还没有章摘要或角色内在变化。结算后表世界挂摘要，里世界挂角色状态变化。",
    };
  }

  return {
    kind: "chronicle",
    root: {
      id: "chronicle",
      kind: "root",
      label: "章节脉络",
      count: branches.reduce((sum, node) => sum + node.count, 0),
      children: branches,
      defaultExpanded: true,
      subtitle: "表世界 / 里世界分枝，不画对照条",
    },
    truncated: false,
  };
}

function attachOverviewBranch(
  id: string,
  label: string,
  forest: CanonicalForest,
): CanonicalTreeNode | null {
  if (forest.root.children.length === 0) return null;
  const pruned = pruneCanonicalTree(
    {
      ...forest.root,
      id,
      kind: "group",
      label,
      defaultExpanded: true,
    },
    OVERVIEW_DEPTH,
    OVERVIEW_MAX_CHILDREN,
  );
  return pruned;
}

export function buildOverviewTree(forests: {
  readonly relations: CanonicalForest;
  readonly worldview: CanonicalForest;
  readonly chapters: CanonicalForest;
}): CanonicalForest {
  const children = [
    attachOverviewBranch("overview:relations", "关系树", forests.relations),
    attachOverviewBranch("overview:worldview", "世界观", forests.worldview),
    attachOverviewBranch("overview:chapters", "章节", forests.chapters),
  ].filter((node): node is CanonicalTreeNode => node !== null);

  if (children.length === 0) {
    return {
      kind: "overview",
      root: emptyRoot("overview", "总图"),
      truncated: false,
      emptyReason: "关系、世界观、章节都还是空的，总图没有可挂的分支。",
    };
  }

  const truncated = forests.relations.truncated || forests.worldview.truncated || forests.chapters.truncated
    || children.some((child) => Boolean(child.subtitle?.includes("另有") || child.subtitle?.includes("下有")));

  return {
    kind: "overview",
    root: {
      id: "overview",
      kind: "root",
      label: "总图",
      count: children.reduce((sum, child) => sum + child.count, 0),
      children,
      defaultExpanded: true,
      subtitle: "三张正图的浅层总览，点开各图看全量",
    },
    truncated,
  };
}

export function buildCanonicalTrees(input: BuildCanonicalTreesInput): CanonicalTrees {
  const mergedRelations = [
    ...(input.relations ?? []),
    ...relationsFromCooccurrence(input.cooccurrence),
  ];
  const worldview = buildWorldviewTree({
    ...(input.entries ? { entries: input.entries } : {}),
    relations: mergedRelations,
    ...(input.dimensions ? { dimensions: input.dimensions } : {}),
    ...(input.maxEntriesPerCategory ? { maxEntriesPerCategory: input.maxEntriesPerCategory } : {}),
  });
  const relations = buildRelationTree({
    ...(input.cooccurrence ? { edges: input.cooccurrence } : {}),
    ...(input.entries ? { entries: input.entries } : {}),
    ...(input.maxRelationHubs ? { maxHubs: input.maxRelationHubs } : {}),
    ...(input.maxRelationChildren ? { maxChildren: input.maxRelationChildren } : {}),
  });
  const chapters = buildChapterForkTree({
    ...(input.entries ? { entries: input.entries } : {}),
    ...(input.volumes ? { volumes: input.volumes } : {}),
    ...(input.maxChaptersPerVolume ? { maxChaptersPerVolume: input.maxChaptersPerVolume } : {}),
  });
  const overview = buildOverviewTree({ relations, worldview, chapters });
  const timeline = buildTimelineTree({
    ...(input.events ? { events: input.events } : {}),
    ...(input.entries ? { entries: input.entries } : {}),
    ...(input.maxEventsPerChapter ? { maxEventsPerChapter: input.maxEventsPerChapter } : {}),
  });
  const chronicle = buildChronicleTree({
    ...(input.entries ? { entries: input.entries } : {}),
    ...(input.events ? { events: input.events } : {}),
    ...(input.maxEventsPerChapter ? { maxEventsPerChapter: input.maxEventsPerChapter } : {}),
  });
  const causal: CanonicalForest = {
    kind: "causal",
    root: { id: "causal", kind: "root", label: "因果树", count: 0, children: [], defaultExpanded: true },
    truncated: false,
    emptyReason: "还没有剧情线，也没有场景；这棵树描述「为什么发生」，需要先有剧情线。",
  };
  return { relations, worldview, chapters, overview, timeline, chronicle, causal };
}

export function forestHasContent(forest: CanonicalForest): boolean {
  return forest.root.children.length > 0 || countLeaves(forest.root) > 0;
}

export const CANONICAL_TREE_VIEWS: readonly {
  readonly id: CanonicalTreeKind;
  readonly label: string;
  readonly description: string;
}[] = [
  { id: "worldview", label: "世界观", description: "按叙事分类看设定层级" },
  { id: "relations", label: "关系树", description: "按共现枢纽看谁和谁同场" },
  { id: "chapters", label: "章节", description: "卷纲到章的分叉骨架" },
  { id: "causal", label: "因果树", description: "按剧情线看场景与因果推进" },
  { id: "timeline", label: "发展历程", description: "按章看已经发生的事" },
  { id: "chronicle", label: "章节脉络", description: "表世界摘要与里世界角色变化" },
  { id: "overview", label: "总图", description: "结构树的浅层总览" },
] as const;
