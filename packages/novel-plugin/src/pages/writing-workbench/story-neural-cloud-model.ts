/**
 * 故事世界网点云 · 数据层（纯函数）。
 *
 * 点 = 经纬设定实体。边 = 关系总表。章脊来自出场章。
 * 结算事实只挂到 Inspector 的 currentState，不生成新点。
 */

import { routeNarrativeSpikes } from "../../engine/narrative-memory/wave/spike-routing";
import type { NarrativeEvent, NarrativeFact } from "./narrative-memory-graph-model";

export type NeuralCloudNodeKind = "character" | "place" | "faction" | "prop" | "hook" | "conflict" | "chapter";

export interface JingweiCloudEntry {
  readonly id: string;
  readonly category?: string;
  readonly title?: string;
  readonly contentMd?: string;
  readonly fields?: Record<string, unknown>;
}

export interface NeuralCloudNode {
  readonly id: string;
  readonly kind: NeuralCloudNodeKind;
  readonly label: string;
  readonly chapterNumber?: number;
  readonly entryId?: string;
  readonly evidenceText?: string;
  readonly subtitle?: string;
  readonly secret?: string;
  readonly currentState?: string;
}

export interface NeuralCloudEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly weight: number;
  readonly kind: "relation" | "sequence" | "cooccur";
  readonly label?: string;
  readonly sentiment?: string;
  readonly status?: string;
}

export interface NeuralCloudLayoutNode extends NeuralCloudNode {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface NeuralCloudModel {
  readonly nodes: readonly NeuralCloudLayoutNode[];
  readonly edges: readonly NeuralCloudEdge[];
  readonly chapters: readonly number[];
  readonly truncated: boolean;
}

export interface NeuralCloudActivation {
  readonly seedId: string;
  readonly energyById: ReadonlyMap<string, { energy: number; hop: number }>;
  readonly litEdgeIds: readonly string[];
}

export const NEURAL_CLOUD_MAX_NODES = 240;
export const NEURAL_CLOUD_MAX_EDGES = 360;
export const NEURAL_CLOUD_MIN_WEIGHT = 0.18;

const PLACEHOLDER = "未命名";

function clean(value: unknown, fallback = PLACEHOLDER): string {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return normalized || fallback;
}

function entityId(name: string): string {
  return `entity:${encodeURIComponent(name)}`;
}

function chapterId(chapter: number): string {
  return `chapter:${chapter}`;
}

const SETTING_CATEGORIES = new Set(["characters", "factions", "locations", "props", "conflicts", "foreshadowing"]);

function fieldText(fields: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!fields) return undefined;
  for (const key of keys) {
    const value = clean(fields[key], "");
    if (value) return value;
  }
  return undefined;
}

function fieldChapter(fields: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!fields) return undefined;
  for (const key of keys) {
    const raw = fields[key];
    const value = typeof raw === "number" ? raw : Number(raw);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

function kindFromCategory(category: string | undefined): NeuralCloudNodeKind | undefined {
  switch (category) {
    case "characters": return "character";
    case "factions": return "faction";
    case "locations": return "place";
    case "props": return "prop";
    case "conflicts": return "conflict";
    case "foreshadowing": return "hook";
    default: return undefined;
  }
}

function hash01(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

export function buildNeuralCloudModel(input: {
  readonly entries?: readonly JingweiCloudEntry[];
  readonly facts?: readonly NarrativeFact[];
  readonly events?: readonly NarrativeEvent[];
  readonly currentChapter?: number;
}): NeuralCloudModel {
  const entries = input.entries ?? [];
  const facts = input.facts ?? [];
  const events = input.events ?? [];
  const nodes = new Map<string, NeuralCloudNode>();
  const edges = new Map<string, NeuralCloudEdge>();

  const remember = (node: NeuralCloudNode) => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return;
    }
    nodes.set(node.id, {
      ...existing,
      entryId: existing.entryId ?? node.entryId,
      evidenceText: existing.evidenceText ?? node.evidenceText,
      subtitle: existing.subtitle ?? node.subtitle,
      secret: existing.secret ?? node.secret,
      currentState: node.currentState ?? existing.currentState,
      chapterNumber: existing.chapterNumber ?? node.chapterNumber,
    });
  };

  const rememberEdge = (edge: NeuralCloudEdge) => {
    const existing = edges.get(edge.id);
    if (!existing || edge.weight > existing.weight) edges.set(edge.id, edge);
  };

  const settingEntries = entries.filter((entry) => SETTING_CATEGORIES.has(entry.category ?? ""));
  const relationEntries = entries.filter((entry) => entry.category === "relationships");

  for (const entry of settingEntries) {
    const kind = kindFromCategory(entry.category);
    if (!kind) continue;
    const label = clean(entry.fields?.name ?? entry.title);
    remember({
      id: entityId(label),
      kind,
      label,
      chapterNumber: fieldChapter(entry.fields, "firstChapter", "plantedChapter", "chapterStart", "resolutionChapter", "chapterNumber"),
      entryId: entry.id,
      evidenceText: clean(entry.contentMd, "") || fieldText(entry.fields, "stakes", "description", "summary", "effect"),
      subtitle: fieldText(entry.fields, "roleType", "type", "locationType", "realm")
        ?? ([fieldText(entry.fields, "protagonistSide"), fieldText(entry.fields, "antagonistSide")].filter(Boolean).join(" vs ") || undefined),
      secret: fieldText(entry.fields, "secret"),
      currentState: fieldText(entry.fields, "currentState"),
    });
  }

  for (const entry of relationEntries) {
    const sourceName = clean(entry.fields?.sourceName);
    const targetName = clean(entry.fields?.targetName);
    if (!sourceName || !targetName || sourceName === PLACEHOLDER || targetName === PLACEHOLDER || sourceName === targetName) continue;
    remember({ id: entityId(sourceName), kind: "character", label: sourceName });
    remember({ id: entityId(targetName), kind: "character", label: targetName });
    const relationType = fieldText(entry.fields, "relationType") ?? "关联";
    const status = fieldText(entry.fields, "status");
    rememberEdge({
      id: `rel:${entityId(sourceName)}->${entityId(targetName)}:${relationType}`,
      source: entityId(sourceName),
      target: entityId(targetName),
      weight: status === "已收束" || status === "已结束" ? 0.35 : 0.85,
      kind: "relation",
      label: relationType,
      sentiment: fieldText(entry.fields, "sentiment"),
      status,
    });
  }

  const patchState = (name: string, text: string, chapter?: number, entryId?: string) => {
    const id = entityId(clean(name));
    const existing = nodes.get(id);
    if (!existing) return;
    remember({
      ...existing,
      currentState: text,
      evidenceText: existing.evidenceText ?? text,
      chapterNumber: existing.chapterNumber ?? chapter,
      entryId: existing.entryId ?? entryId,
    });
    if (chapter && chapter > 0) {
      remember({ id: chapterId(chapter), kind: "chapter", label: `第 ${chapter} 章`, chapterNumber: chapter });
      rememberEdge({
        id: `co:${chapterId(chapter)}->${id}`,
        source: chapterId(chapter),
        target: id,
        weight: 0.4,
        kind: "cooccur",
      });
    }
  };

  for (const fact of facts) {
    const text = `${clean(fact.predicate)} · ${clean(fact.object)}`;
    patchState(fact.subject, text, fact.sourceChapter, fact.subjectEntryId);
  }
  for (const event of events) {
    const text = `${clean(event.predicate)} · ${clean(event.object)}`;
    patchState(event.subject, text, event.chapterNumber, event.subjectEntryId);
  }

  const dataChapters = [
    ...[...nodes.values()].map((node) => node.chapterNumber),
    input.currentChapter,
  ].filter((chapter): chapter is number => Number.isInteger(chapter) && (chapter ?? 0) > 0);
  const hasSetting = settingEntries.length > 0 || relationEntries.length > 0;
  const chapters = [...new Set(hasSetting ? dataChapters : [])].sort((a, b) => a - b);

  for (const chapter of chapters) {
    remember({
      id: chapterId(chapter),
      kind: "chapter",
      label: `第 ${chapter} 章`,
      chapterNumber: chapter,
    });
  }
  for (let index = 1; index < chapters.length; index += 1) {
    const source = chapterId(chapters[index - 1]!);
    const target = chapterId(chapters[index]!);
    rememberEdge({
      id: `seq:${source}->${target}`,
      source,
      target,
      weight: 0.95,
      kind: "sequence",
      label: "章序",
    });
  }

  const rankedNodes = [...nodes.values()].sort((a, b) => {
    if (a.kind === "chapter" && b.kind !== "chapter") return -1;
    if (b.kind === "chapter" && a.kind !== "chapter") return 1;
    return a.label.localeCompare(b.label, "zh");
  });
  const truncatedNodes = rankedNodes.slice(0, NEURAL_CLOUD_MAX_NODES);
  const visibleIds = new Set(truncatedNodes.map((node) => node.id));
  const rankedEdges = [...edges.values()]
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target) && edge.weight >= NEURAL_CLOUD_MIN_WEIGHT)
    .sort((a, b) => b.weight - a.weight);
  const truncatedEdges = rankedEdges.slice(0, NEURAL_CLOUD_MAX_EDGES);
  const layoutNodes = layoutNeuralCloud(truncatedNodes, truncatedEdges, chapters, input.currentChapter);

  return {
    nodes: layoutNodes,
    edges: truncatedEdges,
    chapters,
    truncated: rankedNodes.length > truncatedNodes.length || rankedEdges.length > truncatedEdges.length,
  };
}

/**
 * 节点半径按度数的**平方根**缩放。
 *
 * 用 sqrt 而不是线性：线性会让超级节点（主角、主线冲突）巨大化，
 * 把周围点全压住——这正是「叠墙」的成因之一。sqrt 让差异可见但有界。
 * 业界同款（sigma.js / Obsidian graph / Reagraph）。
 */
export function nodeRadius(degree: number, base = 3.2, k = 1.1, max = 9): number {
  const safeDegree = Number.isFinite(degree) && degree > 0 ? degree : 0;
  return Math.min(max, base + k * Math.sqrt(safeDegree));
}

/**
 * 标签 LOD：低缩放只显示度数最高的若干节点，避免文字糊成一片。
 * 返回「应当常显标签」的节点 id 集合（hover / 激活节点由渲染层额外补显）。
 */
export function pickLabeledNodeIds(
  nodes: readonly NeuralCloudLayoutNode[],
  edges: readonly NeuralCloudEdge[],
  scale: number,
): Set<string> {
  // 缩放越大看得越细，可显示的标签越多
  const budget = scale >= 1.3 ? nodes.length : scale >= 0.95 ? 40 : scale >= 0.7 ? 22 : 12;
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const ranked = [...nodes].sort((a, b) => (
    (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
    || b.radius - a.radius
    || a.label.localeCompare(b.label, "zh")
  ));
  return new Set(ranked.slice(0, Math.max(0, budget)).map((node) => node.id));
}

/** 与某节点直接相连的邻居（含自身）：hover 时做 focus+context 高亮。 */
export function neighborIds(edges: readonly NeuralCloudEdge[], nodeId: string): Set<string> {
  const result = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (edge.source === nodeId) result.add(edge.target);
    else if (edge.target === nodeId) result.add(edge.source);
  }
  return result;
}

export function layoutNeuralCloud(
  nodes: readonly NeuralCloudNode[],
  edges: readonly NeuralCloudEdge[],
  chapters: readonly number[],
  currentChapter?: number,
): NeuralCloudLayoutNode[] {
  const chapterIndex = new Map(chapters.map((chapter, index) => [chapter, index]));
  const spineX = (chapter: number): number => {
    const index = chapterIndex.get(chapter) ?? 0;
    return 96 + index * 92;
  };
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const clouds = nodes.filter((node) => node.kind !== "chapter");
  const cloudsByChapter = new Map<number, NeuralCloudNode[]>();
  const unattached: NeuralCloudNode[] = [];
  for (const node of clouds) {
    const chapter = node.chapterNumber && chapterIndex.has(node.chapterNumber)
      ? node.chapterNumber
      : undefined;
    if (chapter === undefined) {
      unattached.push(node);
      continue;
    }
    const group = cloudsByChapter.get(chapter) ?? [];
    group.push(node);
    cloudsByChapter.set(chapter, group);
  }

  const laid: NeuralCloudLayoutNode[] = [];
  for (const node of nodes.filter((item) => item.kind === "chapter")) {
    const chapter = node.chapterNumber ?? 0;
    const isHead = currentChapter !== undefined && chapter === currentChapter;
    laid.push({
      ...node,
      x: spineX(chapter),
      y: 220,
      // 章脊是骨架，比同度数的云点略大；当前章再加一档
      radius: nodeRadius(degree.get(node.id) ?? 0, isHead ? 5 : 4, 0.9, isHead ? 9 : 7),
    });
  }

  for (const [chapter, group] of cloudsByChapter) {
    const sorted = [...group].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.label.localeCompare(b.label, "zh"));
    sorted.forEach((node, index) => {
      const ring = Math.floor(index / 8);
      const slot = index % 8;
      const angle = -Math.PI / 2 + slot * (Math.PI / 4) + hash01(node.id) * 0.18;
      const radius = 54 + ring * 36;
      laid.push({
        ...node,
        x: spineX(chapter) + Math.cos(angle) * radius,
        y: 220 + Math.sin(angle) * radius * 0.72,
        radius: nodeRadius(degree.get(node.id) ?? 0),
      });
    });
  }

  unattached.forEach((node, index) => {
    const column = index % 6;
    const row = Math.floor(index / 6);
    laid.push({
      ...node,
      x: 80 + column * 70,
      y: 420 + row * 42,
      radius: nodeRadius(degree.get(node.id) ?? 0),
    });
  });

  return laid;
}

export function activateNeuralCloud(
  model: NeuralCloudModel,
  seedId: string,
  config?: { maxHops?: number; firingThreshold?: number },
): NeuralCloudActivation {
  const walkable = model.edges.flatMap((edge) => {
    const forward = { sourceTagId: edge.source, targetTagId: edge.target, weight: edge.weight };
    if (edge.kind === "sequence") return [forward];
    return [
      forward,
      { sourceTagId: edge.target, targetTagId: edge.source, weight: Math.max(0.18, edge.weight * 0.85) },
    ];
  });
  const spike = routeNarrativeSpikes({
    seedTagIds: [seedId],
    edges: walkable,
    logicDepth: 0.35,
    config: {
      maxHops: config?.maxHops ?? 2,
      firingThreshold: config?.firingThreshold ?? 0.12,
      maxEmergentNodes: 48,
      maxNeighborsPerNode: 8,
    },
  });
  const energyById = new Map<string, { energy: number; hop: number }>(
    spike.activatedTags.map((item) => [item.tagId, { energy: item.energy, hop: item.hop }]),
  );
  energyById.set(seedId, { energy: 1, hop: 0 });
  const lit = new Set(energyById.keys());
  const litEdgeIds = model.edges
    .filter((edge) => lit.has(edge.source) && lit.has(edge.target))
    .map((edge) => edge.id);
  return { seedId, energyById, litEdgeIds };
}

export const NEURAL_CLOUD_KIND_COLOR: Record<NeuralCloudNodeKind, string> = {
  chapter: "hsl(var(--primary))",
  character: "#d97706",
  place: "#0ea5e9",
  faction: "#7c3aed",
  prop: "#059669",
  hook: "#db2777",
  conflict: "#dc2626",
};
