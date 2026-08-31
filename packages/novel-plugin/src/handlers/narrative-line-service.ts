import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ChapterMeta, StorageDatabase } from "@vivy1024/novelfork-core";
import {
  emptyChapterStateProjection,
  getStorageDatabase,
  loadChapterStateProjection,
  type ChapterStateProjection,
  type DerivedCharacterState,
  type DerivedHook,
  type DerivedRelationship,
} from "@vivy1024/novelfork-core";

import type { CreateResourceCheckpointInput, ResourceCheckpointResult } from "./resource-checkpoint-service.js";

import type {
  ConflictThread,
  ForeshadowThread,
  NarrativeEdge,
  NarrativeLine,
  NarrativeLineMutationPreview,
  NarrativeLineSnapshot,
  NarrativeNode,
  NarrativeWarning,
  PayoffLink,
  StoryBeat,
} from "./narrative-line-types.js";

export interface NarrativeLineCheckpointService {
  readonly createCheckpoint: (input: CreateResourceCheckpointInput) => Promise<ResourceCheckpointResult>;
}

export interface NarrativeLineState {
  readonly loadChapterIndex: (bookId: string) => Promise<ReadonlyArray<ChapterMeta>>;
  readonly bookDir: (bookId: string) => string;
}

export interface NarrativeLineServiceOptions {
  readonly state: NarrativeLineState;
  readonly storage?: StorageDatabase;
  readonly now?: () => Date;
  readonly checkpoint?: NarrativeLineCheckpointService;
}

interface ChapterSummaryItem {
  readonly number: number;
  readonly title?: string;
  readonly summary: string;
}

interface NarrativeLineApplyAudit {
  readonly previewId: string;
  readonly approvedAt: string;
  readonly sessionId?: string;
  readonly confirmationId?: string;
  readonly checkpointId?: string;
  readonly targetNodeIds: readonly string[];
  readonly targetEdgeIds: readonly string[];
  readonly removedNodeIds?: readonly string[];
  readonly removedEdgeIds?: readonly string[];
  readonly summary: string;
  /** 驳回也要留痕，否则「作者已看过并否决」这个事实会丢失。 */
  readonly decision?: "approved" | "rejected";
  readonly reason?: string;
}

interface NarrativeLineStore {
  readonly version: 1;
  readonly nodes: readonly NarrativeNode[];
  readonly edges: readonly NarrativeEdge[];
  readonly appliedMutations: readonly NarrativeLineApplyAudit[];
}

export interface NarrativeLineApplyResult {
  readonly applied: boolean;
  readonly reason?: "rejected";
  readonly preview: NarrativeLineMutationPreview;
  readonly audit?: NarrativeLineApplyAudit;
  readonly snapshot?: NarrativeLineSnapshot;
  readonly checkpointId?: string;
}

const FORESHADOW_DUE_GAP = 10;
const STALLED_CONFLICT_GAP = 5;

export function createNarrativeLineService(options: NarrativeLineServiceOptions): NarrativeLineService {
  return new NarrativeLineService(options);
}

export class NarrativeLineService {
  private readonly state: NarrativeLineState;
  private readonly storage?: StorageDatabase;
  private readonly now: () => Date;
  private readonly checkpoint?: NarrativeLineCheckpointService;

  constructor(options: NarrativeLineServiceOptions) {
    this.state = options.state;
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
    this.checkpoint = options.checkpoint;
  }

  async getSnapshot(input: { readonly bookId: string; readonly includeWarnings?: boolean }): Promise<NarrativeLineSnapshot> {
    const generatedAt = this.now().toISOString();
    const chapters = await this.loadChapters(input.bookId);
    const currentChapter = Math.max(0, ...chapters.map((chapter) => chapter.number));
    const projection = await this.loadProjection(input.bookId);
    const summaryByChapter = new Map(projection.summaries.map((summary) => [summary.chapter, {
      number: summary.chapter,
      title: summary.title,
      summary: [summary.events, summary.stateChanges].filter(Boolean).join("；"),
    } satisfies ChapterSummaryItem]));

    const derivedNodes = [
      ...chapters.map((chapter) => chapterNode(input.bookId, chapter, summaryByChapter.get(chapter.number))),
      ...projection.characters.map((character) => characterArcNodeFromDelta(input.bookId, character)),
      ...projection.relationships.map((relationship) => relationshipNode(input.bookId, relationship)),
      ...projection.hooks.map((hook) => hookNode(input.bookId, hook)),
      ...projection.timeline.map((entry) => timelineNode(input.bookId, entry)),
    ];
    const store = await this.loadStore(input.bookId);
    const annotationNodes = store.nodes.map((node) => ({ ...node, layer: "annotation" as const }));
    const derivedIds = new Set(derivedNodes.map((node) => node.id));
    const nodes = [...derivedNodes, ...annotationNodes.filter((node) => !derivedIds.has(node.id))];

    const beats = chapters.map((chapter) => storyBeat(input.bookId, chapter, summaryByChapter.get(chapter.number)));
    const foreshadowThreads = projection.hooks.map((hook) => derivedHookThread(input.bookId, hook, currentChapter));
    const payoffLinks = projection.hooks
      .filter((hook) => hook.status === "resolved")
      .map((hook) => derivedPayoffLink(input.bookId, hook));
    const conflictThreads = projection.relationships
      .filter((relationship) => relationship.sentiment === "hostile" || relationship.status === "evolving")
      .map((relationship) => derivedConflictThread(input.bookId, relationship));
    const derivedEdges = [
      ...buildChapterEdges(input.bookId, chapters),
      ...buildDerivedEdges(input.bookId, projection),
    ];
    const annotationEdges = store.edges
      .map((edge) => ({ ...edge, layer: "annotation" as const, confidence: edge.confidence === "explicit" ? "agent-proposed" as const : edge.confidence }))
      .filter((edge) => !derivedEdges.some((derived) => derived.id === edge.id));
    const edges = [...derivedEdges, ...annotationEdges];
    const warnings = input.includeWarnings === false
      ? []
      : buildWarnings({ chapters, currentChapter, foreshadowThreads, conflictThreads });
    const lines = buildLines(input.bookId, nodes, edges);

    return {
      bookId: input.bookId,
      lines,
      nodes,
      edges,
      beats,
      conflictThreads,
      foreshadowThreads,
      payoffLinks,
      warnings,
      generatedAt,
      stateRevision: projection.stateRevision,
    };
  }

  async proposeChange(input: {
    readonly bookId: string;
    readonly summary: string;
    readonly nodes?: readonly unknown[];
    readonly edges?: readonly unknown[];
    readonly removeNodeIds?: readonly unknown[];
    readonly removeEdgeIds?: readonly unknown[];
    readonly reason?: string;
  }): Promise<NarrativeLineMutationPreview> {
    // 删除意图可以写在条目内联的 `_delete`，也可以走独立的 removeNodeIds。
    // 两种都归一到同一份删除集合，避免把删除请求当成新增静默落盘。
    const inlineNodeRemovals = collectInlineRemovals(input.nodes ?? []);
    const inlineEdgeRemovals = collectInlineRemovals(input.edges ?? []);
    const nodes = normalizeProposedNodes(input.bookId, keepNonRemovals(input.nodes ?? []));
    const edges = normalizeProposedEdges(input.bookId, keepNonRemovals(input.edges ?? []));
    const removeNodeIds = uniqueIds([...normalizeIdList(input.removeNodeIds), ...inlineNodeRemovals]);
    const removeEdgeIds = uniqueIds([...normalizeIdList(input.removeEdgeIds), ...inlineEdgeRemovals]);

    const store = await this.loadStore(input.bookId);
    const warnings = [
      ...validateMutationPreview(nodes, edges),
      ...validateRemovals(store, removeNodeIds, removeEdgeIds),
    ];
    return {
      id: `narrative-preview:${input.bookId}:${this.now().getTime()}`,
      bookId: input.bookId,
      summary: input.summary,
      nodes,
      edges,
      ...(removeNodeIds.length > 0 ? { removeNodeIds } : {}),
      ...(removeEdgeIds.length > 0 ? { removeEdgeIds } : {}),
      warnings,
    };
  }

  async applyChange(input: {
    readonly bookId: string;
    readonly preview: NarrativeLineMutationPreview;
    readonly decision: "approved" | "rejected";
    readonly sessionId?: string;
    readonly confirmationId?: string;
    readonly reason?: string;
  }): Promise<NarrativeLineApplyResult> {
    const preview = normalizePreviewForBook(input.bookId, input.preview);
    const store = await this.loadStore(input.bookId);

    if (input.decision === "rejected") {
      // 驳回同样进审批台账：只是不改动 nodes/edges。
      const rejectedAudit: NarrativeLineApplyAudit = {
        previewId: preview.id,
        approvedAt: this.now().toISOString(),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.confirmationId ? { confirmationId: input.confirmationId } : {}),
        targetNodeIds: (preview.nodes ?? []).map((node) => node.id),
        targetEdgeIds: (preview.edges ?? []).map((edge) => edge.id),
        summary: preview.summary,
        decision: "rejected",
        ...(input.reason ? { reason: input.reason } : {}),
      };
      await this.writeStore(input.bookId, {
        version: 1,
        nodes: store.nodes,
        edges: store.edges,
        appliedMutations: [...store.appliedMutations, rejectedAudit],
      });
      return { applied: false, reason: "rejected", preview, audit: rejectedAudit };
    }

    const removeNodeIds = new Set(preview.removeNodeIds ?? []);
    const removeEdgeIds = new Set(preview.removeEdgeIds ?? []);
    const checkpoint = this.checkpoint
      ? await this.checkpoint.createCheckpoint({
          bookId: input.bookId,
          sessionId: input.sessionId ?? "workbench",
          ...(input.confirmationId ? { toolUseId: input.confirmationId } : {}),
          reason: "narrative-line-apply",
          resources: [{ kind: "narrative-line", id: `narrative-line:${input.bookId}`, path: "story/narrative_line.json" }],
        })
      : null;
    const checkpointId = checkpoint?.ok ? checkpoint.checkpoint.id : undefined;
    const nodes = mergeNodes(store.nodes, preview.nodes ?? []).filter((node) => !removeNodeIds.has(node.id));
    // 删掉节点后，指向它的作者边会变成悬空引用，一并清理。
    const survivingNodeIds = new Set(nodes.map((node) => node.id));
    const edges = mergeEdges(store.edges, preview.edges ?? []).filter((edge) => (
      !removeEdgeIds.has(edge.id)
      && !(removeNodeIds.has(edge.fromNodeId) && !survivingNodeIds.has(edge.fromNodeId))
      && !(removeNodeIds.has(edge.toNodeId) && !survivingNodeIds.has(edge.toNodeId))
    ));
    const audit: NarrativeLineApplyAudit = {
      previewId: preview.id,
      approvedAt: this.now().toISOString(),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.confirmationId ? { confirmationId: input.confirmationId } : {}),
      ...(checkpointId ? { checkpointId } : {}),
      targetNodeIds: (preview.nodes ?? []).map((node) => node.id),
      targetEdgeIds: (preview.edges ?? []).map((edge) => edge.id),
      ...(removeNodeIds.size > 0 ? { removedNodeIds: [...removeNodeIds] } : {}),
      ...(removeEdgeIds.size > 0 ? { removedEdgeIds: [...removeEdgeIds] } : {}),
      summary: preview.summary,
      decision: "approved",
      ...(input.reason ? { reason: input.reason } : {}),
    };
    await this.writeStore(input.bookId, { version: 1, nodes, edges, appliedMutations: [...store.appliedMutations, audit] });
    const snapshot = await this.getSnapshot({ bookId: input.bookId });
    return { applied: true, preview, audit, snapshot, ...(checkpointId ? { checkpointId } : {}) };
  }

  /** 审批台账：作者已批准/已驳回的叙事线变更历史。offset 支持追加式分页。 */
  async listApprovals(input: {
    readonly bookId: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly NarrativeLineApplyAudit[]> {
    const store = await this.loadStore(input.bookId);
    const ordered = [...store.appliedMutations].reverse();
    const offset = typeof input.offset === "number" && input.offset > 0 ? Math.floor(input.offset) : 0;
    const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : undefined;
    return limit === undefined ? ordered.slice(offset) : ordered.slice(offset, offset + limit);
  }

  private async loadChapters(bookId: string): Promise<readonly ChapterMeta[]> {
    try {
      return [...await this.state.loadChapterIndex(bookId)].sort((left, right) => left.number - right.number);
    } catch {
      return [];
    }
  }

  private async loadProjection(bookId: string): Promise<ChapterStateProjection> {
    const storage = await this.resolveStorage();
    if (!storage) return emptyChapterStateProjection();
    try {
      return loadChapterStateProjection(storage, bookId);
    } catch {
      return emptyChapterStateProjection();
    }
  }

  private async loadStore(bookId: string): Promise<NarrativeLineStore> {
    const raw = await this.readStoryFile(bookId, "narrative_line.json");
    if (!raw) return emptyStore();
    try {
      return normalizeStore(JSON.parse(raw) as unknown, bookId);
    } catch {
      return emptyStore();
    }
  }

  private async writeStore(bookId: string, store: NarrativeLineStore): Promise<void> {
    const storyDir = join(this.state.bookDir(bookId), "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "narrative_line.json"), `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  }

  private async readStoryFile(bookId: string, fileName: string): Promise<string | null> {
    try {
      return await readFile(join(this.state.bookDir(bookId), "story", fileName), "utf-8");
    } catch {
      return null;
    }
  }

  private async resolveStorage(): Promise<StorageDatabase | null> {
    if (this.storage) return this.storage;
    try {
      return getStorageDatabase();
    } catch {
      return null;
    }
  }
}

function emptyStore(): NarrativeLineStore {
  return { version: 1, nodes: [], edges: [], appliedMutations: [] };
}

function normalizeStore(value: unknown, bookId: string): NarrativeLineStore {
  if (!isRecord(value)) return emptyStore();
  return {
    version: 1,
    nodes: normalizeProposedNodes(bookId, Array.isArray(value.nodes) ? value.nodes : []),
    edges: normalizeProposedEdges(bookId, Array.isArray(value.edges) ? value.edges : []),
    appliedMutations: Array.isArray(value.appliedMutations)
      ? value.appliedMutations.flatMap((entry) => normalizeAudit(entry))
      : [],
  };
}

function normalizeAudit(value: unknown): readonly NarrativeLineApplyAudit[] {
  if (!isRecord(value) || typeof value.previewId !== "string" || typeof value.approvedAt !== "string" || typeof value.summary !== "string") {
    return [];
  }
  return [{
    previewId: value.previewId,
    approvedAt: value.approvedAt,
    ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
    ...(typeof value.confirmationId === "string" ? { confirmationId: value.confirmationId } : {}),
    ...(typeof value.checkpointId === "string" ? { checkpointId: value.checkpointId } : {}),
    targetNodeIds: Array.isArray(value.targetNodeIds) ? value.targetNodeIds.filter((id): id is string => typeof id === "string") : [],
    targetEdgeIds: Array.isArray(value.targetEdgeIds) ? value.targetEdgeIds.filter((id): id is string => typeof id === "string") : [],
    ...(Array.isArray(value.removedNodeIds) ? { removedNodeIds: value.removedNodeIds.filter((id): id is string => typeof id === "string") } : {}),
    ...(Array.isArray(value.removedEdgeIds) ? { removedEdgeIds: value.removedEdgeIds.filter((id): id is string => typeof id === "string") } : {}),
    summary: value.summary,
    // 历史条目没有 decision 字段；它们只可能是已批准的应用记录。
    decision: value.decision === "rejected" ? "rejected" : "approved",
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  }];
}

function normalizePreviewForBook(bookId: string, preview: NarrativeLineMutationPreview): NarrativeLineMutationPreview {
  const removeNodeIds = uniqueIds(normalizeIdList(preview.removeNodeIds));
  const removeEdgeIds = uniqueIds(normalizeIdList(preview.removeEdgeIds));
  return {
    id: preview.id,
    bookId,
    summary: preview.summary,
    nodes: normalizeProposedNodes(bookId, preview.nodes ?? []),
    edges: normalizeProposedEdges(bookId, preview.edges ?? []),
    ...(removeNodeIds.length > 0 ? { removeNodeIds } : {}),
    ...(removeEdgeIds.length > 0 ? { removeEdgeIds } : {}),
    warnings: preview.warnings ?? [],
  };
}

/** 收集条目内联声明的删除目标（`{ id, _delete: true }`）。 */
function collectInlineRemovals(values: readonly unknown[]): readonly string[] {
  return values.flatMap((value) => {
    if (!isRecord(value) || value._delete !== true) return [];
    return typeof value.id === "string" && value.id.trim().length > 0 ? [value.id.trim()] : [];
  });
}

/** 过滤掉声明为删除的条目，避免它们又被当成新增项归一化。 */
function keepNonRemovals(values: readonly unknown[]): readonly unknown[] {
  return values.filter((value) => !(isRecord(value) && value._delete === true));
}

function normalizeIdList(values: readonly unknown[] | undefined): readonly string[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => (
    typeof value === "string" && value.trim().length > 0 ? [value.trim()] : []
  ));
}

function uniqueIds(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * 删除请求的可执行性检查。
 *
   * 章节、Delta 派生节点由权威源计算得出，删除 store 里的覆盖项不会让它们
   * 从快照消失。与其静默无效，不如在 preview 阶段就说清楚。
 */
function validateRemovals(
  store: NarrativeLineStore,
  removeNodeIds: readonly string[],
  removeEdgeIds: readonly string[],
): readonly NarrativeWarning[] {
  const authorNodeIds = new Set(store.nodes.map((node) => node.id));
  const authorEdgeIds = new Set(store.edges.map((edge) => edge.id));
  return [
    ...removeNodeIds.flatMap((id) => authorNodeIds.has(id) ? [] : [{
      type: "mutation-preview-risk",
      severity: "warning" as const,
      summary: `节点 ${id} 不在作者备注层中：它可能来自章节或 Delta 派生事实，删除请求不会生效。请到对应权威源处理。`,
      nodeIds: [id],
    }]),
    ...removeEdgeIds.flatMap((id) => authorEdgeIds.has(id) ? [] : [{
      type: "mutation-preview-risk",
      severity: "warning" as const,
      summary: `边 ${id} 不在作者叙事线覆盖层中：它由章节/事件推导得出，删除请求不会生效。`,
    }]),
  ];
}

function normalizeProposedNodes(bookId: string, values: readonly unknown[]): readonly NarrativeNode[] {
  return values.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const title = typeof value.title === "string" && value.title.trim().length > 0 ? value.title.trim() : "未命名叙事节点";
    const type = normalizeNodeType(value.type);
    return [{
      id: typeof value.id === "string" && value.id.trim().length > 0 ? value.id.trim() : `agent-node:${bookId}:${index + 1}`,
      bookId,
      type,
      title,
      layer: "annotation",
      ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
      ...(normalizeChapterNumber(value.chapterNumber) ? { chapterNumber: normalizeChapterNumber(value.chapterNumber) } : {}),
      ...(typeof value.status === "string" ? { status: value.status } : {}),
    }];
  });
}

function normalizeProposedEdges(bookId: string, values: readonly unknown[]): readonly NarrativeEdge[] {
  return values.flatMap((value, index) => {
    if (!isRecord(value) || typeof value.fromNodeId !== "string" || typeof value.toNodeId !== "string") return [];
    return [{
      id: typeof value.id === "string" && value.id.trim().length > 0 ? value.id.trim() : `agent-edge:${bookId}:${index + 1}`,
      bookId,
      fromNodeId: value.fromNodeId,
      toNodeId: value.toNodeId,
      type: normalizeEdgeType(value.type),
      ...(typeof value.label === "string" ? { label: value.label } : {}),
      confidence: "agent-proposed",
      layer: "annotation",
    }];
  });
}

function validateMutationPreview(nodes: readonly NarrativeNode[], edges: readonly NarrativeEdge[]): readonly NarrativeWarning[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return edges.flatMap((edge) => {
    if (nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId)) return [];
    return [{
      type: "mutation-preview-risk",
      severity: "info" as const,
      summary: `边 ${edge.id} 引用的节点可能来自现有叙事线，apply 前需确认。`,
      nodeIds: [edge.fromNodeId, edge.toNodeId],
    }];
  });
}

function mergeNodes(base: readonly NarrativeNode[], overlay: readonly NarrativeNode[]): readonly NarrativeNode[] {
  return mergeById(base, overlay);
}

function mergeEdges(base: readonly NarrativeEdge[], overlay: readonly NarrativeEdge[]): readonly NarrativeEdge[] {
  return mergeById(base, overlay);
}

function mergeById<T extends { readonly id: string }>(base: readonly T[], overlay: readonly T[]): readonly T[] {
  const merged = new Map<string, T>();
  for (const item of base) merged.set(item.id, item);
  for (const item of overlay) merged.set(item.id, item);
  return [...merged.values()];
}

function normalizeNodeType(value: unknown): NarrativeNode["type"] {
  return value === "chapter" || value === "event" || value === "conflict" || value === "foreshadow" || value === "payoff" || value === "character-arc" || value === "setting"
    ? value
    : "event";
}

function normalizeEdgeType(value: unknown): NarrativeEdge["type"] {
  return value === "causes" || value === "reveals" || value === "escalates" || value === "resolves" || value === "foreshadows" || value === "pays-off" || value === "contradicts" || value === "supports"
    ? value
    : "supports";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function chapterNode(bookId: string, chapter: ChapterMeta, summary?: ChapterSummaryItem): NarrativeNode {
  return {
    id: `chapter:${bookId}:${chapter.number}`,
    bookId,
    type: "chapter",
    title: `第${chapter.number}章 ${chapter.title ?? "未命名"}`,
    summary: summary?.summary,
    chapterNumber: chapter.number,
    status: chapter.status,
    layer: "derived",
    sourceRef: { kind: "chapter", id: `chapter:${bookId}:${chapter.number}`, bookId, title: chapter.title },
  };
}

function characterArcNodeFromDelta(bookId: string, character: DerivedCharacterState): NarrativeNode {
  const titleName = character.name ?? character.characterId;
  return {
    id: `character-arc:${character.characterId}`,
    bookId,
    type: "character-arc",
    title: `${titleName} · 人物弧光`,
    summary: character.currentState ?? character.arcProgress ?? character.currentGoal,
    chapterNumber: character.lastChapter,
    status: character.arcProgress ?? character.currentState,
    layer: "derived",
    sourceRef: { kind: "delta", id: character.characterId, bookId, title: titleName, chapterNumber: character.lastChapter },
  };
}

function relationshipNode(bookId: string, relationship: DerivedRelationship): NarrativeNode {
  return {
    id: relationshipNodeId(relationship),
    bookId,
    type: "conflict",
    title: `${relationship.source} → ${relationship.target}`,
    summary: relationship.description || relationship.relationType,
    chapterNumber: relationship.lastChapter,
    status: relationship.status,
    layer: "derived",
    sourceRef: { kind: "delta", id: relationshipNodeId(relationship), bookId, title: relationship.relationType, chapterNumber: relationship.lastChapter },
  };
}

function hookNode(bookId: string, hook: DerivedHook): NarrativeNode {
  return {
    id: `foreshadow:${hook.hookId}`,
    bookId,
    type: hook.status === "resolved" ? "payoff" : "foreshadow",
    title: hook.expectedPayoff || hook.notes || hook.hookId,
    summary: hook.notes || hook.expectedPayoff,
    chapterNumber: hook.lastAdvancedChapter,
    status: hook.status,
    layer: "derived",
    sourceRef: { kind: "delta", id: hook.hookId, bookId, title: hook.hookId, chapterNumber: hook.startChapter },
  };
}

function timelineNode(bookId: string, entry: { readonly chapter: number; readonly storyTime?: string; readonly label?: string }): NarrativeNode {
  return {
    id: `timeline:${bookId}:${entry.chapter}`,
    bookId,
    type: "event",
    title: entry.label || entry.storyTime || `第${entry.chapter}章时间`,
    summary: [entry.storyTime, entry.label].filter(Boolean).join(" · "),
    chapterNumber: entry.chapter,
    status: "timeline",
    layer: "derived",
    sourceRef: { kind: "delta", id: `timeline:${entry.chapter}`, bookId, title: entry.label, chapterNumber: entry.chapter },
  };
}

function relationshipNodeId(relationship: DerivedRelationship): string {
  return `relationship:${relationship.source}:${relationship.target}:${relationship.relationType}`;
}

function storyBeat(bookId: string, chapter: ChapterMeta, summary?: ChapterSummaryItem): StoryBeat {
  return {
    id: `beat:${bookId}:${chapter.number}`,
    bookId,
    title: summary?.title ?? chapter.title ?? `第${chapter.number}章`,
    summary: summary?.summary,
    chapterNumber: chapter.number,
    nodeIds: [`chapter:${bookId}:${chapter.number}`],
  };
}

function derivedHookThread(bookId: string, hook: DerivedHook, currentChapter: number): ForeshadowThread {
  const dueChapter = hook.startChapter > 0 ? hook.startChapter + FORESHADOW_DUE_GAP : undefined;
  const status = hook.status === "resolved"
    ? "paid-off"
    : dueChapter && currentChapter >= dueChapter && hook.status !== "deferred"
      ? "due"
      : hook.status === "deferred"
        ? "abandoned"
        : "open";
  return {
    id: `foreshadow:${hook.hookId}`,
    bookId,
    title: hook.expectedPayoff || hook.notes || hook.hookId,
    status,
    setupNodeIds: [
      ...(hook.startChapter > 0 ? [`chapter:${bookId}:${hook.startChapter}`] : []),
      `foreshadow:${hook.hookId}`,
    ],
    ...(dueChapter ? { dueChapter } : {}),
  };
}

function derivedPayoffLink(bookId: string, hook: DerivedHook): PayoffLink {
  return {
    id: `payoff:${hook.hookId}`,
    bookId,
    foreshadowThreadId: `foreshadow:${hook.hookId}`,
    payoffNodeId: `foreshadow:${hook.hookId}`,
    summary: hook.notes || hook.expectedPayoff,
  };
}

function derivedConflictThread(bookId: string, relationship: DerivedRelationship): ConflictThread {
  return {
    id: `conflict-thread:${relationshipNodeId(relationship)}`,
    bookId,
    title: `${relationship.source} / ${relationship.target}`,
    status: relationship.status === "broken"
      ? "resolved"
      : relationship.status === "dormant"
        ? "paused"
        : relationship.status === "evolving" || relationship.sentiment === "hostile"
          ? "escalating"
          : "open",
    nodeIds: [
      relationshipNodeId(relationship),
      `chapter:${bookId}:${relationship.lastChapter}`,
    ],
    nextExpectedChapter: relationship.lastChapter + STALLED_CONFLICT_GAP,
  };
}

function buildLines(bookId: string, nodes: readonly NarrativeNode[], edges: readonly NarrativeEdge[]): readonly NarrativeLine[] {
  return [{
    id: `line:${bookId}:main`,
    bookId,
    title: "主叙事线",
    summary: nodes.length > 0 ? `已纳入 ${nodes.length} 个叙事节点。` : "暂无可计算叙事节点。",
    nodeIds: nodes.map((node) => node.id),
    edgeIds: edges.map((edge) => edge.id),
  }];
}

function buildChapterEdges(bookId: string, chapters: readonly ChapterMeta[]): readonly NarrativeEdge[] {
  const edges: NarrativeEdge[] = [];
  for (let index = 1; index < chapters.length; index += 1) {
    const previous = chapters[index - 1]!;
    const current = chapters[index]!;
    edges.push({
      id: `edge:${bookId}:chapter:${previous.number}->${current.number}`,
      bookId,
      fromNodeId: `chapter:${bookId}:${previous.number}`,
      toNodeId: `chapter:${bookId}:${current.number}`,
      type: "causes",
      label: "章节推进",
      confidence: "inferred",
      layer: "derived",
    });
  }
  return edges;
}

function buildDerivedEdges(bookId: string, projection: ChapterStateProjection): readonly NarrativeEdge[] {
  const edges: NarrativeEdge[] = [];
  for (const character of projection.characters) {
    edges.push({
      id: `edge:${bookId}:chapter:${character.lastChapter}->character:${character.characterId}`,
      bookId,
      fromNodeId: `chapter:${bookId}:${character.lastChapter}`,
      toNodeId: `character-arc:${character.characterId}`,
      type: "reveals",
      label: character.currentState ?? "角色状态",
      confidence: "explicit",
      layer: "derived",
    });
  }
  for (const relationship of projection.relationships) {
    edges.push({
      id: `edge:${bookId}:chapter:${relationship.lastChapter}->${relationshipNodeId(relationship)}`,
      bookId,
      fromNodeId: `chapter:${bookId}:${relationship.lastChapter}`,
      toNodeId: relationshipNodeId(relationship),
      type: relationship.sentiment === "hostile" ? "escalates" : relationship.status === "broken" ? "resolves" : "supports",
      label: relationship.relationType,
      confidence: "explicit",
      layer: "derived",
    });
  }
  for (const hook of projection.hooks) {
    edges.push({
      id: `edge:${bookId}:chapter:${hook.startChapter}->foreshadow:${hook.hookId}`,
      bookId,
      fromNodeId: `chapter:${bookId}:${hook.startChapter}`,
      toNodeId: `foreshadow:${hook.hookId}`,
      type: hook.status === "resolved" ? "pays-off" : "foreshadows",
      label: hook.status,
      confidence: "explicit",
      layer: "derived",
    });
  }
  for (const entry of projection.timeline) {
    edges.push({
      id: `edge:${bookId}:chapter:${entry.chapter}->timeline:${entry.chapter}`,
      bookId,
      fromNodeId: `chapter:${bookId}:${entry.chapter}`,
      toNodeId: `timeline:${bookId}:${entry.chapter}`,
      type: "causes",
      label: entry.storyTime || "时间推进",
      confidence: "explicit",
      layer: "derived",
    });
  }
  return edges;
}

function buildWarnings({
  chapters,
  currentChapter,
  foreshadowThreads,
  conflictThreads,
}: {
  readonly chapters: readonly ChapterMeta[];
  readonly currentChapter: number;
  readonly foreshadowThreads: readonly ForeshadowThread[];
  readonly conflictThreads: readonly ConflictThread[];
}): readonly NarrativeWarning[] {
  const warnings: NarrativeWarning[] = [];
  if (chapters.length === 0) {
    warnings.push({ type: "chapter-drift", severity: "info", summary: "暂无章节，叙事线尚未形成。" });
  }
  for (let index = 1; index < chapters.length; index += 1) {
    const previous = chapters[index - 1]!;
    const current = chapters[index]!;
    if (current.number !== previous.number + 1) {
      warnings.push({ type: "chapter-drift", severity: "warning", summary: `第${previous.number}章到第${current.number}章之间存在章节推进缺口。`, nodeIds: [`chapter:${previous.number}`, `chapter:${current.number}`] });
    }
  }
  for (const thread of foreshadowThreads) {
    if (thread.status === "open" || thread.status === "due") {
      warnings.push({ type: "open-foreshadow", severity: thread.status === "due" ? "warning" : "info", summary: `伏笔未回收：${thread.title}`, nodeIds: thread.setupNodeIds });
    }
    if (thread.status === "due") {
      warnings.push({ type: "missing-payoff", severity: "warning", summary: `伏笔已到回收窗口：${thread.title}`, nodeIds: thread.setupNodeIds });
    }
  }
  for (const thread of conflictThreads) {
    const lastChapter = Math.max(0, ...thread.nodeIds.flatMap((id) => {
      const match = id.match(/:(\d+)$/);
      return match ? [Number.parseInt(match[1]!, 10)] : [];
    }));
    if ((thread.status === "open" || thread.status === "escalating") && lastChapter > 0 && currentChapter - lastChapter >= STALLED_CONFLICT_GAP) {
      warnings.push({ type: "stalled-conflict", severity: "warning", summary: `冲突长期未推进：${thread.title}`, nodeIds: thread.nodeIds });
    }
  }
  if (chapters.length >= 3 && conflictThreads.length === 0) {
    warnings.push({ type: "mainline-risk", severity: "info", summary: "当前章节已有推进，但未记录主线冲突。" });
  }
  return warnings;
}

function normalizeChapterNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
