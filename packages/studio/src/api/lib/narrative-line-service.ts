import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ChapterMeta, StateManager, StorageDatabase } from "@vivy1024/novelfork-core";
import {
  createBibleCharacterArcRepository,
  createBibleChapterSummaryRepository,
  createBibleConflictRepository,
  createBibleEventRepository,
  createBibleSettingRepository,
  getStorageDatabase,
} from "@vivy1024/novelfork-core";

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
} from "../../shared/agent-native-workspace.js";

export interface NarrativeLineServiceOptions {
  readonly state: StateManager;
  readonly storage?: StorageDatabase;
  readonly now?: () => Date;
}

interface ChapterSummaryItem {
  readonly number: number;
  readonly title?: string;
  readonly summary: string;
}

interface EventRecord {
  readonly id: string;
  readonly bookId?: string;
  readonly name?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly eventType?: string;
  readonly chapterStart?: number | null;
  readonly chapterEnd?: number | null;
  readonly foreshadowState?: string | null;
}

interface SettingRecord {
  readonly id: string;
  readonly bookId?: string;
  readonly name?: string;
  readonly title?: string;
  readonly category?: string;
  readonly content?: string;
}

interface ConflictRecord {
  readonly id: string;
  readonly bookId?: string;
  readonly name?: string;
  readonly title?: string;
  readonly stakes?: string;
  readonly resolutionState?: string;
  readonly evolutionPathJson?: string;
}

interface CharacterArcRecord {
  readonly id: string;
  readonly bookId?: string;
  readonly characterId?: string;
  readonly arcType?: string;
  readonly currentPosition?: string;
  readonly startingState?: string;
  readonly endingState?: string;
}

interface PendingHookItem {
  readonly id: string;
  readonly text: string;
  readonly sourceChapter: number;
}

interface ConflictEvolutionStep {
  readonly chapter?: number;
  readonly state?: string;
  readonly summary?: string;
}

interface NarrativeLineApplyAudit {
  readonly previewId: string;
  readonly approvedAt: string;
  readonly sessionId?: string;
  readonly confirmationId?: string;
  readonly targetNodeIds: readonly string[];
  readonly targetEdgeIds: readonly string[];
  readonly summary: string;
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
}

const FORESHADOW_DUE_GAP = 10;
const STALLED_CONFLICT_GAP = 5;

export function createNarrativeLineService(options: NarrativeLineServiceOptions): NarrativeLineService {
  return new NarrativeLineService(options);
}

export class NarrativeLineService {
  private readonly state: StateManager;
  private readonly storage?: StorageDatabase;
  private readonly now: () => Date;

  constructor(options: NarrativeLineServiceOptions) {
    this.state = options.state;
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
  }

  async getSnapshot(input: { readonly bookId: string; readonly includeWarnings?: boolean }): Promise<NarrativeLineSnapshot> {
    const generatedAt = this.now().toISOString();
    const chapters = await this.loadChapters(input.bookId);
    const currentChapter = Math.max(0, ...chapters.map((chapter) => chapter.number));
    const [chapterSummaries, pendingHooks, events, settings, conflicts, arcs] = await Promise.all([
      this.loadChapterSummaries(input.bookId),
      this.loadPendingHooks(input.bookId),
      this.loadEvents(input.bookId),
      this.loadSettings(input.bookId),
      this.loadConflicts(input.bookId),
      this.loadCharacterArcs(input.bookId),
    ]);
    const summaryByChapter = new Map(chapterSummaries.map((summary) => [summary.number, summary]));

    const chapterNodes = chapters.map((chapter) => chapterNode(input.bookId, chapter, summaryByChapter.get(chapter.number)));
    const eventNodes = events.map((event) => eventNode(input.bookId, event));
    const settingNodes = settings.map((setting) => settingNode(input.bookId, setting));
    const conflictNodes = conflicts.map((conflict) => conflictNode(input.bookId, conflict));
    const arcNodes = arcs.map((arc) => characterArcNode(input.bookId, arc));
    const store = await this.loadStore(input.bookId);
    const nodes = mergeNodes([...chapterNodes, ...eventNodes, ...settingNodes, ...conflictNodes, ...arcNodes], store.nodes);

    const beats = chapters.map((chapter) => storyBeat(input.bookId, chapter, summaryByChapter.get(chapter.number)));
    const foreshadowThreads = [
      ...pendingHooks.map((hook) => pendingHookThread(input.bookId, hook, currentChapter)),
      ...events.filter(isOpenForeshadowEvent).map((event) => eventForeshadowThread(input.bookId, event, currentChapter)),
    ];
    const payoffLinks = events.filter(isPayoffEvent).map((event) => payoffLink(input.bookId, event));
    const conflictThreads = conflicts.map((conflict) => conflictThread(input.bookId, conflict));
    const edges = mergeEdges(buildEdges(input.bookId, chapters, events, conflicts), store.edges);
    const warnings = input.includeWarnings === false ? [] : buildWarnings({ chapters, currentChapter, foreshadowThreads, conflicts });
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
    };
  }

  async proposeChange(input: {
    readonly bookId: string;
    readonly summary: string;
    readonly nodes?: readonly unknown[];
    readonly edges?: readonly unknown[];
    readonly reason?: string;
  }): Promise<NarrativeLineMutationPreview> {
    const nodes = normalizeProposedNodes(input.bookId, input.nodes ?? []);
    const edges = normalizeProposedEdges(input.bookId, input.edges ?? []);
    const warnings = validateMutationPreview(nodes, edges);
    return {
      id: `narrative-preview:${input.bookId}:${this.now().getTime()}`,
      bookId: input.bookId,
      summary: input.summary,
      nodes,
      edges,
      warnings,
    };
  }

  async applyChange(input: {
    readonly bookId: string;
    readonly preview: NarrativeLineMutationPreview;
    readonly decision: "approved" | "rejected";
    readonly sessionId?: string;
    readonly confirmationId?: string;
  }): Promise<NarrativeLineApplyResult> {
    const preview = normalizePreviewForBook(input.bookId, input.preview);
    if (input.decision === "rejected") {
      return { applied: false, reason: "rejected", preview };
    }

    const store = await this.loadStore(input.bookId);
    const nodes = mergeNodes(store.nodes, preview.nodes ?? []);
    const edges = mergeEdges(store.edges, preview.edges ?? []);
    const audit: NarrativeLineApplyAudit = {
      previewId: preview.id,
      approvedAt: this.now().toISOString(),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.confirmationId ? { confirmationId: input.confirmationId } : {}),
      targetNodeIds: (preview.nodes ?? []).map((node) => node.id),
      targetEdgeIds: (preview.edges ?? []).map((edge) => edge.id),
      summary: preview.summary,
    };
    await this.writeStore(input.bookId, { version: 1, nodes, edges, appliedMutations: [...store.appliedMutations, audit] });
    const snapshot = await this.getSnapshot({ bookId: input.bookId });
    return { applied: true, preview, audit, snapshot };
  }

  private async loadChapters(bookId: string): Promise<readonly ChapterMeta[]> {
    try {
      return [...await this.state.loadChapterIndex(bookId)].sort((left, right) => left.number - right.number);
    } catch {
      return [];
    }
  }

  private async loadChapterSummaries(bookId: string): Promise<readonly ChapterSummaryItem[]> {
    const fromFile = parseChapterSummaries(await this.readStoryFile(bookId, "chapter_summaries.md"));
    const storage = await this.resolveStorage();
    if (!storage) return fromFile;
    try {
      const rows = await createBibleChapterSummaryRepository(storage).listByBook(bookId);
      const fromStorage = rows.map((row) => ({
        number: Number(row.chapterNumber),
        title: typeof row.title === "string" ? row.title : undefined,
        summary: typeof row.summary === "string" ? row.summary : "",
      })).filter((summary) => Number.isFinite(summary.number) && summary.summary.trim().length > 0);
      const merged = new Map<number, ChapterSummaryItem>();
      for (const summary of fromFile) merged.set(summary.number, summary);
      for (const summary of fromStorage) merged.set(summary.number, summary);
      return [...merged.values()].sort((left, right) => left.number - right.number);
    } catch {
      return fromFile;
    }
  }

  private async loadPendingHooks(bookId: string): Promise<readonly PendingHookItem[]> {
    return parsePendingHooks(await this.readStoryFile(bookId, "pending_hooks.md"));
  }

  private async loadEvents(bookId: string): Promise<readonly EventRecord[]> {
    const storage = await this.resolveStorage();
    if (!storage) return [];
    try {
      return await createBibleEventRepository(storage).listByBook(bookId) as EventRecord[];
    } catch {
      return [];
    }
  }

  private async loadSettings(bookId: string): Promise<readonly SettingRecord[]> {
    const storage = await this.resolveStorage();
    if (!storage) return [];
    try {
      return await createBibleSettingRepository(storage).listByBook(bookId) as SettingRecord[];
    } catch {
      return [];
    }
  }

  private async loadConflicts(bookId: string): Promise<readonly ConflictRecord[]> {
    const storage = await this.resolveStorage();
    if (!storage) return [];
    try {
      return await createBibleConflictRepository(storage).listByBook(bookId) as ConflictRecord[];
    } catch {
      return [];
    }
  }

  private async loadCharacterArcs(bookId: string): Promise<readonly CharacterArcRecord[]> {
    const storage = await this.resolveStorage();
    if (!storage) return [];
    try {
      return await createBibleCharacterArcRepository(storage).listByBook(bookId) as CharacterArcRecord[];
    } catch {
      return [];
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
    targetNodeIds: Array.isArray(value.targetNodeIds) ? value.targetNodeIds.filter((id): id is string => typeof id === "string") : [],
    targetEdgeIds: Array.isArray(value.targetEdgeIds) ? value.targetEdgeIds.filter((id): id is string => typeof id === "string") : [],
    summary: value.summary,
  }];
}

function normalizePreviewForBook(bookId: string, preview: NarrativeLineMutationPreview): NarrativeLineMutationPreview {
  return {
    id: preview.id,
    bookId,
    summary: preview.summary,
    nodes: normalizeProposedNodes(bookId, preview.nodes ?? []),
    edges: normalizeProposedEdges(bookId, preview.edges ?? []),
    warnings: preview.warnings ?? [],
  };
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
    sourceRef: { kind: "chapter", id: `chapter:${bookId}:${chapter.number}`, bookId, title: chapter.title },
  };
}

function eventNode(bookId: string, event: EventRecord): NarrativeNode {
  const type = isPayoffEvent(event) ? "payoff" : isForeshadowEvent(event) ? "foreshadow" : "event";
  return {
    id: `event:${event.id}`,
    bookId,
    type,
    title: event.name ?? event.title ?? event.id,
    summary: event.summary,
    chapterNumber: normalizeChapterNumber(event.chapterStart ?? event.chapterEnd),
    status: event.foreshadowState ?? event.eventType,
    sourceRef: { kind: "jingwei", id: event.id, bookId, title: event.name ?? event.title ?? event.id },
  };
}

function settingNode(bookId: string, setting: SettingRecord): NarrativeNode {
  return {
    id: `setting:${setting.id}`,
    bookId,
    type: "setting",
    title: setting.name ?? setting.title ?? setting.id,
    summary: setting.content,
    status: setting.category,
    sourceRef: { kind: "jingwei", id: setting.id, bookId, title: setting.name ?? setting.title ?? setting.id },
  };
}

function conflictNode(bookId: string, conflict: ConflictRecord): NarrativeNode {
  return {
    id: `conflict:${conflict.id}`,
    bookId,
    type: "conflict",
    title: conflict.name ?? conflict.title ?? conflict.id,
    summary: conflict.stakes,
    status: conflict.resolutionState,
    sourceRef: { kind: "jingwei", id: conflict.id, bookId, title: conflict.name ?? conflict.title ?? conflict.id },
  };
}

function characterArcNode(bookId: string, arc: CharacterArcRecord): NarrativeNode {
  return {
    id: `character-arc:${arc.id}`,
    bookId,
    type: "character-arc",
    title: `${arc.characterId ?? "角色"} · ${arc.arcType ?? "人物弧光"}`,
    summary: arc.currentPosition ?? arc.endingState ?? arc.startingState,
    sourceRef: { kind: "jingwei", id: arc.id, bookId, title: arc.arcType ?? arc.id },
  };
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

function pendingHookThread(bookId: string, hook: PendingHookItem, currentChapter: number): ForeshadowThread {
  const dueChapter = hook.sourceChapter > 0 ? hook.sourceChapter + FORESHADOW_DUE_GAP : undefined;
  return {
    id: `foreshadow:${hook.id}`,
    bookId,
    title: hook.text,
    status: dueChapter && currentChapter >= dueChapter ? "due" : "open",
    setupNodeIds: hook.sourceChapter > 0 ? [`chapter:${bookId}:${hook.sourceChapter}`] : [],
    ...(dueChapter ? { dueChapter } : {}),
  };
}

function eventForeshadowThread(bookId: string, event: EventRecord, currentChapter: number): ForeshadowThread {
  const sourceChapter = normalizeChapterNumber(event.chapterStart ?? event.chapterEnd);
  const dueChapter = sourceChapter ? sourceChapter + FORESHADOW_DUE_GAP : undefined;
  return {
    id: `foreshadow:${event.id}`,
    bookId,
    title: event.name ?? event.title ?? event.id,
    status: event.foreshadowState === "paid-off" ? "paid-off" : dueChapter && currentChapter >= dueChapter ? "due" : "open",
    setupNodeIds: sourceChapter ? [`chapter:${bookId}:${sourceChapter}`, `event:${event.id}`] : [`event:${event.id}`],
    ...(dueChapter ? { dueChapter } : {}),
  };
}

function payoffLink(bookId: string, event: EventRecord): PayoffLink {
  return {
    id: `payoff:${event.id}`,
    bookId,
    foreshadowThreadId: `foreshadow:${event.id}`,
    payoffNodeId: `event:${event.id}`,
    summary: event.summary,
  };
}

function conflictThread(bookId: string, conflict: ConflictRecord): ConflictThread {
  const evolution = parseEvolutionPath(conflict.evolutionPathJson);
  return {
    id: `conflict-thread:${conflict.id}`,
    bookId,
    title: conflict.name ?? conflict.title ?? conflict.id,
    status: normalizeConflictStatus(conflict.resolutionState),
    nodeIds: [`conflict:${conflict.id}`, ...evolution.flatMap((step) => typeof step.chapter === "number" ? [`chapter:${bookId}:${step.chapter}`] : [])],
    nextExpectedChapter: nextConflictChapter(evolution),
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

function buildEdges(bookId: string, chapters: readonly ChapterMeta[], events: readonly EventRecord[], conflicts: readonly ConflictRecord[]): readonly NarrativeEdge[] {
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
    });
  }
  for (const event of events) {
    const chapter = normalizeChapterNumber(event.chapterStart ?? event.chapterEnd);
    if (!chapter) continue;
    edges.push({
      id: `edge:${bookId}:chapter:${chapter}->event:${event.id}`,
      bookId,
      fromNodeId: `chapter:${bookId}:${chapter}`,
      toNodeId: `event:${event.id}`,
      type: isPayoffEvent(event) ? "pays-off" : isForeshadowEvent(event) ? "foreshadows" : "causes",
      confidence: "explicit",
    });
  }
  for (const conflict of conflicts) {
    for (const step of parseEvolutionPath(conflict.evolutionPathJson)) {
      if (typeof step.chapter !== "number") continue;
      edges.push({
        id: `edge:${bookId}:conflict:${conflict.id}->chapter:${step.chapter}`,
        bookId,
        fromNodeId: `conflict:${conflict.id}`,
        toNodeId: `chapter:${bookId}:${step.chapter}`,
        type: "escalates",
        label: step.summary,
        confidence: "explicit",
      });
    }
  }
  return edges;
}

function buildWarnings({
  chapters,
  currentChapter,
  foreshadowThreads,
  conflicts,
}: {
  readonly chapters: readonly ChapterMeta[];
  readonly currentChapter: number;
  readonly foreshadowThreads: readonly ForeshadowThread[];
  readonly conflicts: readonly ConflictRecord[];
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
  for (const conflict of conflicts) {
    const status = normalizeConflictStatus(conflict.resolutionState);
    const lastChapter = lastConflictChapter(parseEvolutionPath(conflict.evolutionPathJson));
    if ((status === "open" || status === "escalating") && lastChapter > 0 && currentChapter - lastChapter >= STALLED_CONFLICT_GAP) {
      warnings.push({ type: "stalled-conflict", severity: "warning", summary: `冲突长期未推进：${conflict.name ?? conflict.title ?? conflict.id}`, nodeIds: [`conflict:${conflict.id}`] });
    }
  }
  if (chapters.length >= 3 && conflicts.length === 0) {
    warnings.push({ type: "mainline-risk", severity: "info", summary: "当前章节已有推进，但未记录主线冲突。" });
  }
  return warnings;
}

function parseChapterSummaries(content: string | null): readonly ChapterSummaryItem[] {
  if (!content) return [];
  return content.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^-\s*第\s*(\d+)\s*章[：:](.+)$/);
    if (!match) return [];
    return [{ number: Number.parseInt(match[1]!, 10), summary: match[2]!.trim() }];
  });
}

function parsePendingHooks(content: string | null): readonly PendingHookItem[] {
  if (!content) return [];
  return content.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- [ ]")) return [];
    const text = trimmed.replace(/^- \[ \]\s*/, "").trim();
    if (!text) return [];
    const chapterMatch = text.match(/第\s*(\d+)\s*章/);
    return [{
      id: `pending-hook-${index + 1}`,
      text,
      sourceChapter: chapterMatch ? Number.parseInt(chapterMatch[1]!, 10) : 0,
    }];
  });
}

function isForeshadowEvent(event: EventRecord): boolean {
  return event.eventType === "foreshadow" || Boolean(event.foreshadowState);
}

function isOpenForeshadowEvent(event: EventRecord): boolean {
  return isForeshadowEvent(event) && event.foreshadowState !== "paid-off" && event.foreshadowState !== "resolved";
}

function isPayoffEvent(event: EventRecord): boolean {
  return event.eventType === "payoff" || event.foreshadowState === "paid-off" || event.foreshadowState === "resolved";
}

function normalizeChapterNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function parseEvolutionPath(raw: string | undefined): readonly ConflictEvolutionStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ConflictEvolutionStep => typeof item === "object" && item !== null);
  } catch {
    return [];
  }
}

function normalizeConflictStatus(value: string | undefined): ConflictThread["status"] {
  if (value === "resolved") return "resolved";
  if (value === "paused") return "paused";
  if (value === "escalating") return "escalating";
  return "open";
}

function lastConflictChapter(evolution: readonly ConflictEvolutionStep[]): number {
  return Math.max(0, ...evolution.map((step) => typeof step.chapter === "number" ? step.chapter : 0));
}

function nextConflictChapter(evolution: readonly ConflictEvolutionStep[]): number | undefined {
  const last = lastConflictChapter(evolution);
  return last > 0 ? last + STALLED_CONFLICT_GAP : undefined;
}
