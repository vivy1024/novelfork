import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ResourceWorkspaceLayout, SectionLayout } from "../components/layouts";
import { useAiModelGate } from "../../hooks/use-ai-model-gate";
import {
  buildStudioResourceTree,
  type StudioResourceEmptyState,
  type StudioResourceNode,
  type StudioResourceTreeInput,
} from "./resource-adapter";
import { NarratorPanel } from "../../components/ChatWindow";
import { PublishPanel } from "./PublishPanel";
import { fetchJson, postApi, useApi } from "../../hooks/use-api";
import { appStore } from "../../stores/app-store";
import type { AiAction, AiGateResult } from "../../lib/ai-gate";
import type { BookDetail, ChapterSummary, CreateChapterResponse, DraftResource, GeneratedChapterCandidate, PublishReportResource } from "../../shared/contracts";
import { normalizeBookStatus, normalizeChapterStatus } from "../../../../core/src/models/status";
import { ChapterHookGenerator, type GeneratedHookOption } from "../../components/writing-tools/ChapterHookGenerator";
import { DialogueAnalysis, type DialogueAnalysisResult } from "../../components/writing-tools/DialogueAnalysis";
import { RhythmChart, type RhythmChartAnalysis } from "../../components/writing-tools/RhythmChart";
import { DailyProgressTracker } from "../../components/writing-tools/DailyProgressTracker";
import { InlineWritePanel } from "../../components/writing-modes/InlineWritePanel";
import { DialogueGenerator } from "../../components/writing-modes/DialogueGenerator";
import { VariantCompare } from "../../components/writing-modes/VariantCompare";
import { OutlineBrancher } from "../../components/writing-modes/OutlineBrancher";
import { BookHealthDashboard } from "../../components/writing-tools/BookHealthDashboard";
import { ConflictMap } from "../../components/writing-tools/ConflictMap";
import { CharacterArcDashboard } from "../../components/writing-tools/CharacterArcDashboard";
import { ToneDriftAlert } from "../../components/writing-tools/ToneDriftAlert";
import { InlineError, RunStatus } from "../components/feedback";
import { InkEditor, getMarkdown } from "../../components/InkEditor";
import type { CanvasArtifact, CanvasContext, OpenResourceTab, WorkspaceResourceViewKind } from "../../shared/agent-native-workspace";
import type { NarratorSessionRecord } from "../../shared/session-types";
import { Button } from "../../components/ui/button";
import { useWindowStore } from "../../stores/windowStore";
import {
  BibleCategoryView,
  DraftEditor,
  MarkdownViewer,
  MaterialViewer,
  OutlineEditor,
  PublishReportViewer,
  resolveWorkspaceNodeViewKind,
  UnsupportedWorkspaceNodeView,
} from "./resource-view-registry";

/* ── API response shapes ── */

interface BookListItem {
  readonly id: string;
  readonly title: string;
  readonly status?: string;
  readonly totalChapters?: number;
  readonly progress?: number;
}

interface BookDetailResponse {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly status?: string;
    readonly genre?: string;
    readonly platform?: string;
    readonly chapterWordCount?: number;
    readonly targetChapters?: number;
    readonly language?: string;
    readonly createdAt?: string;
    readonly updatedAt?: string;
  };
  readonly chapters: ReadonlyArray<{
    readonly number: number;
    readonly title?: string;
    readonly status?: string;
    readonly wordCount?: number;
    readonly fileName?: string;
  }>;
  readonly nextChapter: number;
}

interface BookExportResponse {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: string;
  readonly chapterCount: number;
}

interface CandidatesResponse {
  readonly candidates: ReadonlyArray<GeneratedChapterCandidate>;
}

interface WorkspaceTextFileSummary {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
}

interface WorkspaceTextFileListResponse {
  readonly files: ReadonlyArray<WorkspaceTextFileSummary>;
}

export interface WorkspaceChapterApi {
  readonly loadChapter: (bookId: string, chapterNumber: number) => Promise<{ readonly content: string }>;
  readonly saveChapter: (bookId: string, chapterNumber: number, content: string) => Promise<void>;
}

export type CandidateAcceptAction = "merge" | "replace" | "draft";

export interface CandidateMutationResult {
  readonly candidate?: GeneratedChapterCandidate;
  readonly draft?: DraftResource;
}

export interface WorkspaceCandidateApi {
  readonly acceptCandidate: (bookId: string, candidateId: string, action: CandidateAcceptAction) => Promise<CandidateMutationResult | void>;
  readonly rejectCandidate: (bookId: string, candidateId: string) => Promise<CandidateMutationResult | void>;
}

export type WorkspaceAssistantActionId = "write-next" | "continue" | "audit" | "rewrite" | "de-ai" | "continuity";

const CHAPTER_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  writing: "撰写中",
  "ready-for-review": "待审阅",
  approved: "已定稿",
  published: "已发布",
};

function chapterStatusLabel(value: string | undefined): string {
  return value ? CHAPTER_STATUS_LABELS[value] ?? "状态待确认" : "状态待确认";
}

function normalizeWorkspaceChapterSummary(chapter: {
  readonly number: number;
  readonly title?: string;
  readonly status?: string;
  readonly wordCount?: number;
  readonly auditIssueCount?: number;
  readonly updatedAt?: string;
  readonly fileName?: string | null;
}): ChapterSummary {
  return {
    number: chapter.number,
    title: chapter.title ?? `第${chapter.number}章`,
    status: normalizeChapterStatus(chapter.status),
    wordCount: chapter.wordCount ?? 0,
    auditIssueCount: chapter.auditIssueCount ?? 0,
    updatedAt: chapter.updatedAt ?? "",
    fileName: chapter.fileName ?? null,
  };
}

function createChapterResourceNode(bookId: string, chapter: ChapterSummary): StudioResourceNode {
  return {
    id: `chapter:${bookId}:${chapter.number}`,
    kind: "chapter",
    title: chapter.title,
    subtitle: `第 ${chapter.number} 章 · ${chapter.wordCount} 字`,
    status: chapter.status,
    count: chapter.wordCount,
    metadata: {
      bookId,
      chapterNumber: chapter.number,
      auditIssueCount: chapter.auditIssueCount,
      updatedAt: chapter.updatedAt,
      fileName: chapter.fileName,
    },
  };
}

export interface WorkspaceAssistantContext {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly selectedNodeId: string;
  readonly selectedNodeTitle: string;
}

export interface WorkspaceAssistantActionResult {
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly resourceMutationTarget?: WorkspaceResourceMutationTarget;
}

export interface WorkspaceAssistantApi {
  readonly runAction: (action: WorkspaceAssistantActionId, context: WorkspaceAssistantContext) => Promise<WorkspaceAssistantActionResult>;
}

type WorkspaceResourceMutationTarget = "chapters" | "candidates" | "drafts" | "candidate-draft" | "candidate-chapter" | "story-files" | "all";
type WorkspaceResourceMutationHandler = (target: WorkspaceResourceMutationTarget) => Promise<void>;
type WorkspaceCanvasDirtyAction = "save" | "discard" | "save-as-candidate";
type WritingModeApplyTarget = "candidate" | "draft" | "chapter-insert" | "chapter-replace";

interface WritingModeApplyPayload {
  readonly target: WritingModeApplyTarget;
  readonly title?: string;
  readonly content: string;
  readonly sourceMode: string;
  readonly chapterNumber?: number;
}

interface WritingModeApplyResponse {
  readonly target: "candidate" | "draft";
  readonly requestedTarget: WritingModeApplyTarget;
  readonly resourceId: string;
  readonly status: string;
  readonly metadata?: Record<string, unknown>;
}

interface PendingWritingModeApply {
  readonly content: string;
  readonly sourceMode: string;
  readonly title: string;
}

export interface WorkspaceModelGate {
  readonly blockedResult: Extract<AiGateResult, { ok: false }> | null;
  readonly closeGate: () => void;
  readonly ensureModelFor: (action: AiAction) => boolean;
}

interface WorkspacePageProps {
  readonly assistantApi?: WorkspaceAssistantApi;
  readonly candidateApi?: WorkspaceCandidateApi;
  readonly chapterApi?: WorkspaceChapterApi;
  readonly modelGate?: WorkspaceModelGate;
}

const DEFAULT_CHAPTER_API: WorkspaceChapterApi = {
  loadChapter: (bookId, chapterNumber) => fetchJson<{ content: string }>(`/books/${bookId}/chapters/${chapterNumber}`),
  saveChapter: async (bookId, chapterNumber, content) => {
    await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  },
};

const DEFAULT_CANDIDATE_API: WorkspaceCandidateApi = {
  acceptCandidate: async (bookId, candidateId, action) => fetchJson<CandidateMutationResult>(`/books/${bookId}/candidates/${candidateId}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  }),
  rejectCandidate: async (bookId, candidateId) => {
    await fetchJson(`/books/${bookId}/candidates/${candidateId}/reject`, { method: "POST" });
  },
};

interface WorkspaceAssistantActionRouteConfig {
  readonly route: (context: WorkspaceAssistantContext) => string;
  readonly method?: "POST";
  readonly body?: (context: WorkspaceAssistantContext) => Record<string, unknown>;
  readonly message: string;
  readonly resourceMutationTarget?: WorkspaceResourceMutationTarget;
}

function resolveAssistantChapterNumber(context: WorkspaceAssistantContext): number {
  return context.chapterNumber ?? 1;
}

const WORKSPACE_ASSISTANT_ACTION_ROUTE_MAP: Record<WorkspaceAssistantActionId, WorkspaceAssistantActionRouteConfig> = {
  "write-next": {
    route: (context) => `/books/${context.bookId}/write-next`,
    method: "POST",
    message: "AI 输出已进入生成章节候选",
    resourceMutationTarget: "candidates",
  },
  continue: {
    route: (context) => `/books/${context.bookId}/inline-write`,
    method: "POST",
    body: (context) => ({
      mode: "continuation",
      chapterNumber: resolveAssistantChapterNumber(context),
      selectedText: "",
      beforeText: context.selectedNodeTitle,
    }),
    message: "续写当前段落已生成提示词预览，请在写作模式面板确认后写入。"
  },
  audit: {
    route: (context) => `/books/${context.bookId}/audit/${resolveAssistantChapterNumber(context)}`,
    method: "POST",
    message: "审校当前章已完成。",
  },
  rewrite: {
    route: (context) => `/books/${context.bookId}/revise/${resolveAssistantChapterNumber(context)}`,
    method: "POST",
    body: () => ({ mode: "rewrite" }),
    message: "改写请求已提交到修订 route。",
  },
  "de-ai": {
    route: (context) => `/books/${context.bookId}/detect/${resolveAssistantChapterNumber(context)}`,
    method: "POST",
    message: "去 AI 味检测已完成。",
  },
  continuity: {
    route: (context) => `/books/${context.bookId}/audit/${resolveAssistantChapterNumber(context)}`,
    method: "POST",
    message: "连续性检查已完成。",
  },
};

const DEFAULT_ASSISTANT_API: WorkspaceAssistantApi = {
  runAction: async (action, context) => {
    const routeConfig = WORKSPACE_ASSISTANT_ACTION_ROUTE_MAP[action];
    const body = routeConfig.body?.(context);
    const request: { method: "POST"; headers?: Record<string, string>; body?: string } = { method: routeConfig.method ?? "POST" };
    if (body) {
      request.headers = { "Content-Type": "application/json" };
      request.body = JSON.stringify(body);
    }
    const data = await fetchJson(routeConfig.route(context), request) as Record<string, unknown>;
    return {
      message: routeConfig.message,
      data,
      resourceMutationTarget: routeConfig.resourceMutationTarget,
    };
  },
};

const CANVAS_ARTIFACT_EVENT = "novelfork:open-canvas-artifact";

declare global {
  interface Window {
    __NOVELFORK_OPEN_CANVAS_ARTIFACT__?: (artifact: CanvasArtifact) => void;
  }
}

type CanvasNavigationRequest =
  | { readonly type: "node"; readonly nodeId: string; readonly source: "user" | "agent" }
  | { readonly type: "artifact"; readonly artifact: CanvasArtifact }
  | { readonly type: "tab"; readonly tabId: string }
  | { readonly type: "close"; readonly tabId: string };

interface PendingCanvasNavigation {
  readonly dirtyTabId: string;
  readonly next: CanvasNavigationRequest;
}

function createOpenResourceTabFromNode(node: StudioResourceNode, source: "user" | "agent"): OpenResourceTab {
  return {
    id: node.id,
    nodeId: node.id,
    kind: resolveWorkspaceNodeViewKind(node) as WorkspaceResourceViewKind,
    title: node.title,
    dirty: false,
    source,
  };
}

function createOpenResourceTabFromArtifact(artifact: CanvasArtifact): OpenResourceTab {
  return {
    id: artifact.id,
    nodeId: artifact.resourceRef?.id ?? artifact.id,
    kind: resolveArtifactViewKind(artifact),
    title: artifact.title,
    dirty: false,
    source: "agent",
    payloadRef: artifact.payloadRef,
    artifact,
  };
}

function createCanvasContext(activeTab: OpenResourceTab | null, activeNode: StudioResourceNode | undefined, openTabs: readonly OpenResourceTab[]): CanvasContext {
  const activeResource = activeTab?.artifact?.resourceRef ?? (activeNode ? createCanvasResourceRef(activeNode) : undefined);
  const selection = currentCanvasSelection();
  return {
    activeTabId: activeTab?.id ?? activeNode?.id,
    activeResource,
    dirty: activeTab?.dirty ?? false,
    ...(selection ? { selection } : {}),
    openTabs: openTabs.map((tab) => ({
      id: tab.id,
      nodeId: tab.nodeId,
      kind: tab.kind,
      title: tab.title,
      dirty: tab.dirty,
      source: tab.source,
      ...(tab.payloadRef ? { payloadRef: tab.payloadRef } : {}),
    })),
  };
}

function createCanvasResourceRef(node: StudioResourceNode): NonNullable<CanvasContext["activeResource"]> {
  const bookId = typeof node.metadata?.bookId === "string" ? node.metadata.bookId : undefined;
  const path = typeof node.metadata?.path === "string"
    ? node.metadata.path
    : typeof node.metadata?.fileName === "string"
      ? node.metadata.fileName
      : undefined;
  return {
    kind: node.kind,
    id: node.id,
    ...(bookId ? { bookId } : {}),
    title: node.title,
    ...(path ? { path } : {}),
  };
}

function currentCanvasSelection(): CanvasContext["selection"] | undefined {
  if (typeof window === "undefined") return undefined;
  const text = window.getSelection?.()?.toString().trim();
  return text ? { text } : undefined;
}

function resolveArtifactViewKind(artifact: CanvasArtifact): WorkspaceResourceViewKind {
  switch (artifact.kind) {
    case "guided-plan":
      return "guided-plan";
    case "tool-result":
      return "tool-result";
    case "narrative-line":
      return "narrative-line";
    case "candidate":
      return "candidate-editor";
    case "chapter":
      return "chapter-editor";
    case "draft":
      return "draft-editor";
    case "outline":
      return "outline-editor";
    case "jingwei":
      return "bible-entry-editor";
    case "story-file":
    case "truth-file":
      return "markdown-viewer";
    case "material":
      return "material-viewer";
    case "publish-report":
      return "publish-report-viewer";
    default:
      return artifact.renderer === "guided.plan" ? "guided-plan" : artifact.renderer === "narrative.line" ? "narrative-line" : "tool-result";
  }
}

function resolveArtifactNodeId(artifact: CanvasArtifact): string | null {
  const ref = artifact.resourceRef;
  const kind = String(ref?.kind ?? artifact.kind);
  const id = String(ref?.id ?? "").trim();
  const bookId = ref?.bookId;
  if (!id) return null;
  switch (kind) {
    case "candidate":
      return `generated:${id}`;
    case "chapter":
      return bookId ? `chapter:${bookId}:${id}` : null;
    case "draft":
      return `draft:${id}`;
    case "story-file":
      return `story-file:${id}`;
    case "truth-file":
      return `truth-file:${id}`;
    case "material":
      return `material:${id}`;
    case "publish-report":
      return `publish-report:${id}`;
    default:
      return null;
  }
}

function isCanvasArtifact(value: unknown): value is CanvasArtifact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const artifact = value as Record<string, unknown>;
  return typeof artifact.id === "string" && typeof artifact.kind === "string" && typeof artifact.title === "string";
}

export function WorkspacePage({
  assistantApi = DEFAULT_ASSISTANT_API,
  candidateApi = DEFAULT_CANDIDATE_API,
  chapterApi = DEFAULT_CHAPTER_API,
  modelGate,
}: WorkspacePageProps = {}) {
  const runtimeModelGate = useAiModelGate();
  const effectiveModelGate = modelGate ?? runtimeModelGate;

  /* ── load books list ── */
  const { data: booksData } = useApi<{ books: BookListItem[] }>("/books");
  const books = booksData?.books ?? [];
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const activeBookId = selectedBookId ?? books[0]?.id ?? null;

  // Sync to global appStore so Agent/ChatWindow can read current book
  useEffect(() => {
    appStore.setState((prev) => {
      if (prev.activeBookId === activeBookId) return prev;
      return { ...prev, activeBookId };
    });
  }, [activeBookId]);

  /* ── load selected book detail + candidates ── */
  const { data: bookDetail, refetch: refetchBookDetail } = useApi<BookDetailResponse>(activeBookId ? `/books/${activeBookId}` : null);
  const { data: candidatesData, refetch: refetchCandidates } = useApi<CandidatesResponse>(activeBookId ? `/books/${activeBookId}/candidates` : null);
  const { data: storyFilesData, refetch: refetchStoryFiles } = useApi<WorkspaceTextFileListResponse>(activeBookId ? `/books/${activeBookId}/story-files` : null);
  const { data: truthFilesData, refetch: refetchTruthFiles } = useApi<WorkspaceTextFileListResponse>(activeBookId ? `/books/${activeBookId}/truth-files` : null);
  const { data: draftsData, refetch: refetchDrafts } = useApi<{ drafts: DraftResource[] }>(activeBookId ? `/books/${activeBookId}/drafts` : null);
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [createChapterError, setCreateChapterError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [runningEmptyAction, setRunningEmptyAction] = useState<StudioResourceEmptyState["action"] | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importText, setImportText] = useState("");
  const [importingChapters, setImportingChapters] = useState(false);
  const [importChapterError, setImportChapterError] = useState<string | null>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportFormat, setExportFormat] = useState<"markdown" | "txt">("markdown");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<BookExportResponse | null>(null);
  const [publishReports, setPublishReports] = useState<PublishReportResource[]>([]);
  const [optimisticChapterNodes, setOptimisticChapterNodes] = useState<StudioResourceNode[]>([]);

  useEffect(() => {
    setCreateChapterError(null);
    setWorkspaceNotice(null);
    setRunningEmptyAction(null);
    setShowImportPanel(false);
    setImportText("");
    setImportChapterError(null);
    setShowExportPanel(false);
    setExportError(null);
    setExportResult(null);
    setPublishReports([]);
    setOptimisticChapterNodes([]);
    setOpenTabs([]);
    setActiveCanvasTabId(null);
    setPendingCanvasNavigation(null);
  }, [activeBookId]);

  const refreshWorkspaceResources: WorkspaceResourceMutationHandler = async (target) => {
    const refreshers: Array<Promise<unknown>> = [];
    if (target === "all" || target === "chapters" || target === "candidate-chapter") refreshers.push(refetchBookDetail());
    if (target === "all" || target === "candidates" || target === "candidate-draft" || target === "candidate-chapter") refreshers.push(refetchCandidates());
    if (target === "all" || target === "drafts" || target === "candidate-draft") refreshers.push(refetchDrafts());
    if (target === "all" || target === "story-files") refreshers.push(refetchStoryFiles());
    if (target === "all") refreshers.push(refetchTruthFiles());
    await Promise.all(refreshers);
  };

  /* ── build resource tree from real data or fallback ── */
  const treeInput: StudioResourceTreeInput = useMemo(() => {
    if (!bookDetail?.book) return {
      book: {
        id: "", title: "加载中...", status: "drafting", platform: "other", genre: "",
        targetChapters: 0, chapters: 0, chapterCount: 0, lastChapterNumber: 0,
        totalWords: 0, approvedChapters: 0, pendingReview: 0, pendingReviewChapters: 0,
        failedReview: 0, failedChapters: 0, updatedAt: "", createdAt: "", chapterWordCount: 0, language: null,
      },
      chapters: [], generatedChapters: [], drafts: [], bibleCounts: {}, bibleEntries: [], storyFiles: [], truthFiles: [], materials: [], publishReports: [],
    };
    const b = bookDetail.book;
    const chs = bookDetail.chapters ?? [];
    const chaptersFromBook: ChapterSummary[] = chs.map((c) => normalizeWorkspaceChapterSummary(c));
    const chapters = [...chaptersFromBook].sort((left, right) => left.number - right.number);
    const book: BookDetail = {
      id: b.id, title: b.title, status: normalizeBookStatus(b.status), platform: (b.platform ?? "other") as BookDetail["platform"],
      genre: b.genre ?? "", targetChapters: b.targetChapters ?? 100,
      chapters: chapters.length, chapterCount: chapters.length, lastChapterNumber: Math.max(0, ...chapters.map((chapter) => chapter.number)),
      totalWords: chapters.reduce((s, c) => s + (c.wordCount ?? 0), 0),
      approvedChapters: chapters.filter((c) => c.status === "approved").length,
      pendingReview: chapters.filter((c) => c.status === "ready-for-review").length,
      pendingReviewChapters: chapters.filter((c) => c.status === "ready-for-review").length,
      failedReview: 0, failedChapters: 0,
      updatedAt: b.updatedAt ?? "", createdAt: b.createdAt ?? "",
      chapterWordCount: b.chapterWordCount ?? 3000, language: (b.language ?? "zh") as "zh" | "en",
    };
    const candidates = (candidatesData?.candidates ?? []).filter((c) => c.status === "candidate");
    const draftResources = [...(draftsData?.drafts ?? [])]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const storyFiles = (storyFilesData?.files ?? []).map((file) => ({
      id: file.name,
      title: (file as { label?: string }).label ?? file.name,
      label: (file as { label?: string }).label,
      path: `story/${file.name}`,
      fileType: file.name.endsWith(".json") ? "text" as const : "markdown" as const,
    }));
    const truthFiles = (truthFilesData?.files ?? []).map((file) => ({
      id: file.name,
      title: (file as { label?: string }).label ?? file.name,
      label: (file as { label?: string }).label,
      path: `truth/${file.name}`,
      fileType: file.name.endsWith(".json") ? "text" as const : "markdown" as const,
    }));
    return {
      book,
      chapters,
      generatedChapters: candidates,
      drafts: draftResources,
      bibleCounts: {},
      bibleEntries: [],
      storyFiles,
      truthFiles,
      materials: [],
      publishReports,
    };
  }, [bookDetail, candidatesData, draftsData, storyFilesData, truthFilesData, publishReports]);

  const baseTree = useMemo(() => buildStudioResourceTree(treeInput), [treeInput]);
  const tree = useMemo(() => mergeOptimisticChapterNodes(baseTree, optimisticChapterNodes), [baseTree, optimisticChapterNodes]);
  const defaultNodeId = tree[0]?.children?.[0]?.children?.[0]?.children?.[0]?.id ?? tree[0]?.children?.[0]?.children?.[0]?.id ?? tree[0]?.id ?? "";
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const activeNodeId = selectedNodeId ?? defaultNodeId;
  const selectedNode = findNode(tree, activeNodeId) ?? tree[0]!;
  const [openTabs, setOpenTabs] = useState<OpenResourceTab[]>([]);
  const [activeCanvasTabId, setActiveCanvasTabId] = useState<string | null>(null);
  const [pendingCanvasNavigation, setPendingCanvasNavigation] = useState<PendingCanvasNavigation | null>(null);
  const activeCanvasTab = activeCanvasTabId ? openTabs.find((tab) => tab.id === activeCanvasTabId) ?? null : null;
  const activeCanvasNode = activeCanvasTab ? findNode(tree, activeCanvasTab.nodeId) : undefined;
  const activeNarratorCanvasContext = useMemo(
    () => createCanvasContext(activeCanvasTab, activeCanvasNode ?? selectedNode, openTabs),
    [activeCanvasNode, activeCanvasTab, openTabs, selectedNode],
  );
  const narratorWindowId = useDefaultNarratorWindow(activeBookId, bookDetail?.book?.title);

  const markCanvasTabDirty = useCallback((tabId: string, dirty = true) => {
    setOpenTabs((tabs) => tabs.map((tab) => tab.id === tabId ? { ...tab, dirty } : tab));
  }, []);

  const openCanvasRequest = useCallback((request: CanvasNavigationRequest, force = false) => {
    const dirtyActiveTab = activeCanvasTab?.dirty ? activeCanvasTab : null;
    const isSameTarget = request.type === "node" ? request.nodeId === dirtyActiveTab?.nodeId : request.type === "tab" || request.type === "close" ? request.tabId === dirtyActiveTab?.id : request.type === "artifact" ? request.artifact.id === dirtyActiveTab?.id : false;
    if (!force && dirtyActiveTab && !isSameTarget) {
      setPendingCanvasNavigation({ dirtyTabId: dirtyActiveTab.id, next: request });
      return;
    }

    if (request.type === "node") {
      const node = findNode(tree, request.nodeId);
      if (!node) return;
      const tab = createOpenResourceTabFromNode(node, request.source);
      const nodeId = node.id;
      setOpenTabs((tabs) => tabs.some((item) => item.id === tab.id) ? tabs : [...tabs, tab]);
      setActiveCanvasTabId(tab.id);
      setSelectedNodeId(nodeId);
      return;
    }

    if (request.type === "artifact") {
      const nodeId = resolveArtifactNodeId(request.artifact);
      const node = nodeId ? findNode(tree, nodeId) : undefined;
      const tab = node ? createOpenResourceTabFromNode(node, "agent") : createOpenResourceTabFromArtifact(request.artifact);
      setOpenTabs((tabs) => tabs.some((item) => item.id === tab.id) ? tabs : [...tabs, tab]);
      setActiveCanvasTabId(tab.id);
      if (node) setSelectedNodeId(node.id);
      return;
    }

    if (request.type === "tab") {
      const tab = openTabs.find((item) => item.id === request.tabId);
      if (!tab) return;
      setActiveCanvasTabId(tab.id);
      if (findNode(tree, tab.nodeId)) setSelectedNodeId(tab.nodeId);
      return;
    }

    setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== request.tabId));
    if (activeCanvasTabId === request.tabId) {
      const remaining = openTabs.filter((tab) => tab.id !== request.tabId);
      const nextTab = remaining[remaining.length - 1] ?? null;
      setActiveCanvasTabId(nextTab?.id ?? null);
      if (nextTab && findNode(tree, nextTab.nodeId)) setSelectedNodeId(nextTab.nodeId);
    }
  }, [activeCanvasTab, activeCanvasTabId, openTabs, tree]);

  useEffect(() => {
    if (!defaultNodeId || openTabs.length > 0) return;
    openCanvasRequest({ type: "node", nodeId: defaultNodeId, source: "user" });
  }, [defaultNodeId, openCanvasRequest, openTabs.length]);

  useEffect(() => {
    const openArtifact = (artifact: CanvasArtifact) => {
      if (artifact.openInCanvas === false) return;
      openCanvasRequest({ type: "artifact", artifact });
    };
    const handleArtifactEvent = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isCanvasArtifact(detail)) openArtifact(detail);
    };
    window.__NOVELFORK_OPEN_CANVAS_ARTIFACT__ = openArtifact;
    window.addEventListener(CANVAS_ARTIFACT_EVENT, handleArtifactEvent);
    return () => {
      if (window.__NOVELFORK_OPEN_CANVAS_ARTIFACT__ === openArtifact) delete window.__NOVELFORK_OPEN_CANVAS_ARTIFACT__;
      window.removeEventListener(CANVAS_ARTIFACT_EVENT, handleArtifactEvent);
    };
  }, [openCanvasRequest]);

  const resolvePendingCanvasNavigation = (action: WorkspaceCanvasDirtyAction) => {
    if (!pendingCanvasNavigation) return;
    if (action === "save-as-candidate") {
      setWorkspaceNotice("另存为候选将在任务 17 接入会话确认门；本次已阻止覆盖当前未保存资源。");
      return;
    }
    if (action === "save") {
      setWorkspaceNotice("请先使用当前编辑器的保存按钮保存资源，再继续切换。已保持当前资源不变。");
      return;
    }
    markCanvasTabDirty(pendingCanvasNavigation.dirtyTabId, false);
    const next = pendingCanvasNavigation.next;
    setPendingCanvasNavigation(null);
    openCanvasRequest(next, true);
  };

  const handleCreateChapter = async () => {
    if (!activeBookId) {
      setCreateChapterError("请先选择作品");
      return;
    }
    setCreatingChapter(true);
    setCreateChapterError(null);
    try {
      const response = await fetchJson<CreateChapterResponse>(`/books/${activeBookId}/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.chapter || typeof response.chapter.number !== "number") {
        throw new Error("新建章节接口未返回章节编号");
      }
      const chapter = normalizeWorkspaceChapterSummary(response.chapter);
      const optimisticNode = createChapterResourceNode(activeBookId, chapter);
      setOptimisticChapterNodes((nodes) => [
        ...nodes.filter((node) => node.id !== optimisticNode.id),
        optimisticNode,
      ]);
      setSelectedNodeId(optimisticNode.id);
      setOpenTabs((tabs) => tabs.some((tab) => tab.id === optimisticNode.id) ? tabs : [...tabs, createOpenResourceTabFromNode(optimisticNode, "user")]);
      setActiveCanvasTabId(optimisticNode.id);
      setShowPublishPanel(false);
      await refreshWorkspaceResources("chapters");
    } catch (error) {
      setCreateChapterError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingChapter(false);
    }
  };

  const handleGenerateNextFromResourceTree = async () => {
    if (!activeBookId) {
      setWorkspaceNotice("请先选择作品");
      return;
    }

    setWorkspaceNotice(null);
    setRunningEmptyAction("generate-next");
    try {
      const result = await assistantApi.runAction("write-next", {
        bookId: activeBookId,
        chapterNumber: typeof selectedNode.metadata?.chapterNumber === "number" ? selectedNode.metadata.chapterNumber : undefined,
        selectedNodeId: selectedNode.id,
        selectedNodeTitle: selectedNode.title,
      });
      await refreshWorkspaceResources(result.resourceMutationTarget ?? "candidates");
      setWorkspaceNotice(result.message);
    } catch (error) {
      setWorkspaceNotice(`生成下一章失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunningEmptyAction(null);
    }
  };

  const handleImportChapters = async () => {
    if (!activeBookId) {
      setImportChapterError("请先选择作品");
      return;
    }
    if (!importText.trim()) {
      setImportChapterError("请先粘贴章节文本");
      return;
    }

    setImportingChapters(true);
    setImportChapterError(null);
    try {
      const response = await fetchJson<{ readonly importedCount?: number }>(`/books/${activeBookId}/import/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: importText }),
      });
      await refreshWorkspaceResources("chapters");
      setWorkspaceNotice(`已导入 ${response.importedCount ?? 0} 章`);
      setImportText("");
      setShowImportPanel(false);
    } catch (error) {
      setImportChapterError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportingChapters(false);
    }
  };

  const handleResourceEmptyStateAction = async (node: StudioResourceNode, emptyState: StudioResourceEmptyState) => {
    setShowPublishPanel(false);
    setShowExportPanel(false);
    setWorkspaceNotice(null);

    switch (emptyState.action) {
      case "create-chapter":
        setRunningEmptyAction("create-chapter");
        await handleCreateChapter();
        setRunningEmptyAction(null);
        break;
      case "generate-next":
        await handleGenerateNextFromResourceTree();
        break;
      case "import-chapter":
        openCanvasRequest({ type: "node", nodeId: node.id, source: "user" });
        setShowImportPanel(true);
        setImportChapterError(null);
        break;
      case "create-bible-entry": {
        const nodeId = node.kind === "bible-category" ? node.id : "bible:characters";
        openCanvasRequest({ type: "node", nodeId, source: "user" });
        setWorkspaceNotice("已打开经纬分类，请使用新建按钮创建第一条资料。");
        break;
      }
      case "edit-outline":
        openCanvasRequest({ type: "node", nodeId: "outline:root", source: "user" });
        break;
    }
  };

  const handleExportBook = async () => {
    if (!activeBookId) {
      setExportError("请先选择作品");
      return;
    }
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    try {
      const response = await fetchJson<BookExportResponse>(`/books/${activeBookId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: exportFormat, scope: "book" }),
      });
      setExportResult(response);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  const handlePublishReport = (report: PublishReportResource) => {
    setPublishReports((current) => [report, ...current.filter((item) => item.id !== report.id)]);
  };
  return (
    <SectionLayout title="创作工作台" description="">
      {createChapterError && <InlineError message={`新建章节失败：${createChapterError}`} />}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            作品选择
            <select
              aria-label="作品选择"
              className="ml-2 rounded-lg border border-border bg-background px-2 py-1 text-sm"
              value={activeBookId ?? ""}
              onChange={(e) => { setSelectedBookId(e.target.value); setSelectedNodeId(null); setOpenTabs([]); setActiveCanvasTabId(null); }}
            >
              {books.length === 0 && <option value="">加载中…</option>}
              {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="default" type="button" disabled={!activeBookId || creatingChapter} title={activeBookId ? undefined : "请先选择作品"} onClick={() => void handleCreateChapter()}>
              {creatingChapter ? "新建中…" : "新建章节"}
            </Button>
            <Button size="sm" variant={showExportPanel ? "default" : "outline"} type="button" disabled={!activeBookId} title={activeBookId ? undefined : "请先选择作品"} onClick={() => { setShowExportPanel(!showExportPanel); setShowPublishPanel(false); }}>导出</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={showPublishPanel ? "default" : "outline"} onClick={() => setShowPublishPanel(!showPublishPanel)} type="button">发布就绪</Button>
        </div>
      </div>

      {workspaceNotice && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">{workspaceNotice}</div>}
      {showImportPanel && (
        <ImportChaptersPanel
          error={importChapterError}
          importing={importingChapters}
          text={importText}
          onCancel={() => setShowImportPanel(false)}
          onImport={() => void handleImportChapters()}
          onTextChange={setImportText}
        />
      )}
      {showExportPanel && (
        <ExportPanel
          error={exportError}
          exporting={exporting}
          format={exportFormat}
          result={exportResult}
          onExport={() => void handleExportBook()}
          onFormatChange={setExportFormat}
        />
      )}

      <ResourceWorkspaceLayout
        explorer={(
          <WorkspaceLeftRail
            activeBookId={activeBookId}
            activeEmptyAction={showImportPanel ? "import-chapter" : runningEmptyAction}
            books={books}
            nodes={tree}
            selectedNodeId={selectedNode.id}
            onBookChange={(bookId) => { setSelectedBookId(bookId); setSelectedNodeId(null); setOpenTabs([]); setActiveCanvasTabId(null); }}
            onEmptyStateAction={(node, emptyState) => void handleResourceEmptyStateAction(node, emptyState)}
            onSelect={(id) => { openCanvasRequest({ type: "node", nodeId: id, source: "user" }); setShowPublishPanel(false); setShowExportPanel(false); }}
          />
        )}
        editor={showPublishPanel && activeBookId ? <PublishPanel bookId={activeBookId} onReport={handlePublishReport} /> : <WorkspaceCanvas activeTab={activeCanvasTab} assistantApi={assistantApi} candidateApi={candidateApi} chapterApi={chapterApi} modelGate={effectiveModelGate} node={activeCanvasNode ?? selectedNode} openTabs={openTabs} pendingNavigation={pendingCanvasNavigation} onCloseTab={(tabId) => openCanvasRequest({ type: "close", tabId })} onDirtyChange={markCanvasTabDirty} onResolvePendingNavigation={resolvePendingCanvasNavigation} onResourceMutation={refreshWorkspaceResources} onCandidateResult={(message) => setWorkspaceNotice(message)} onSelectTab={(tabId) => openCanvasRequest({ type: "tab", tabId })} />}
        assistant={<WorkspaceNarratorHost windowId={narratorWindowId} canvasContext={activeNarratorCanvasContext} />}
      />
    </SectionLayout>
  );
}

function useDefaultNarratorWindow(activeBookId: string | null, activeBookTitle?: string): string | null {
  const addWindow = useWindowStore((state) => state.addWindow);
  const updateWindow = useWindowStore((state) => state.updateWindow);
  const windows = useWindowStore((state) => state.windows);
  const loadingBookIdRef = useRef<string | null>(null);
  const [failedBookId, setFailedBookId] = useState<string | null>(null);
  const [placeholderWindowId, setPlaceholderWindowId] = useState<string | null>(null);

  const existingWindow = useMemo(() => {
    if (!activeBookId) return null;
    return windows.find((window) => window.agentId === "writer" && window.sessionId && window.sessionMode === "chat" && window.title.includes(activeBookTitle ?? "叙述者"))
      ?? windows.find((window) => window.agentId === "writer" && window.sessionId && window.sessionMode === "chat")
      ?? null;
  }, [activeBookId, activeBookTitle, windows]);

  useEffect(() => {
    if (!activeBookId || existingWindow || loadingBookIdRef.current === activeBookId || failedBookId === activeBookId) return;
    const createdPlaceholderWindowId = addWindow({
      agentId: "writer",
      title: `${activeBookTitle ?? "当前作品"} · 叙述者`,
      sessionMode: "chat",
    });
    setPlaceholderWindowId(createdPlaceholderWindowId);
    let cancelled = false;
    loadingBookIdRef.current = activeBookId;

    const attachNarratorSession = async () => {
      try {
        const sessions = await fetchJson<NarratorSessionRecord[]>("/api/sessions");
        const existingSession = sessions.find((session) => session.projectId === activeBookId && session.agentId === "writer" && session.sessionMode === "chat" && session.status === "active")
          ?? sessions.find((session) => session.projectId === activeBookId && session.agentId === "writer" && session.status === "active");
        const session = existingSession ?? await fetchJson<NarratorSessionRecord>("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `${activeBookTitle ?? "当前作品"} · 叙述者`,
            agentId: "writer",
            projectId: activeBookId,
            sessionMode: "chat",
            sessionConfig: { permissionMode: "edit" },
          }),
        });
        if (cancelled) return;

        const existingShell = useWindowStore.getState().windows.find((window) => window.sessionId === session.id && window.id !== createdPlaceholderWindowId);
        if (existingShell) {
          updateWindow(createdPlaceholderWindowId, {
            title: session.title,
            sessionId: session.id,
            sessionMode: session.sessionMode,
            agentId: session.agentId,
          });
          return;
        }

        updateWindow(createdPlaceholderWindowId, {
          agentId: session.agentId,
          title: session.title,
          sessionId: session.id,
          sessionMode: session.sessionMode,
        });
      } catch {
        if (!cancelled) {
          setFailedBookId(activeBookId);
          updateWindow(createdPlaceholderWindowId, { title: `${activeBookTitle ?? "当前作品"} · 叙述者（离线）` });
        }
      } finally {
        if (!cancelled && loadingBookIdRef.current === activeBookId) loadingBookIdRef.current = null;
      }
    };

    void attachNarratorSession();
    return () => {
      cancelled = true;
      if (loadingBookIdRef.current === activeBookId) loadingBookIdRef.current = null;
    };
  }, [activeBookId, activeBookTitle, addWindow, existingWindow, failedBookId, updateWindow]);

  return existingWindow?.id ?? placeholderWindowId;
}

function WorkspaceNarratorHost({ windowId, canvasContext }: { readonly windowId: string | null; readonly canvasContext?: CanvasContext }) {
  if (!windowId) {
    return (
      <div className="flex h-full min-h-[28rem] items-center justify-center p-4 text-center text-sm text-muted-foreground">
        正在准备叙述者会话…
      </div>
    );
  }

  return <NarratorPanel windowId={windowId} theme="light" canvasContext={canvasContext} />;
}

function ImportChaptersPanel({
  error,
  importing,
  text,
  onCancel,
  onImport,
  onTextChange,
}: {
  readonly error: string | null;
  readonly importing: boolean;
  readonly text: string;
  readonly onCancel: () => void;
  readonly onImport: () => void;
  readonly onTextChange: (text: string) => void;
}) {
  return (
    <div className="mb-3 space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">导入章节</h2>
          <p className="text-xs text-muted-foreground">粘贴章节文本后，后端会按章节标题分割并写入正式章节。</p>
        </div>
        <Button size="sm" variant="outline" type="button" disabled={importing} onClick={onCancel}>取消</Button>
      </div>
      <textarea
        aria-label="导入章节文本"
        className="min-h-32 w-full rounded-lg border border-border bg-background p-3 text-sm leading-6"
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="第一章 标题\n正文……"
        value={text}
      />
      {error && <InlineError message={`导入章节失败：${error}`} />}
      <Button size="sm" type="button" disabled={importing || !text.trim()} onClick={onImport}>{importing ? "导入中…" : "导入章节"}</Button>
    </div>
  );
}

function ExportPanel({
  error,
  exporting,
  format,
  result,
  onExport,
  onFormatChange,
}: {
  readonly error: string | null;
  readonly exporting: boolean;
  readonly format: "markdown" | "txt";
  readonly result: BookExportResponse | null;
  readonly onExport: () => void;
  readonly onFormatChange: (format: "markdown" | "txt") => void;
}) {
  return (
    <div className="mb-3 space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">导出作品</h2>
          <p className="text-xs text-muted-foreground">导出范围：全书</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm">
            导出格式
            <select aria-label="导出格式" className="ml-2 rounded border border-border bg-background px-2 py-1 text-sm" value={format} onChange={(event) => onFormatChange(event.target.value === "txt" ? "txt" : "markdown")}>
              <option value="markdown">Markdown</option>
              <option value="txt">TXT</option>
            </select>
          </label>
          <Button size="sm" type="button" disabled={exporting} onClick={onExport}>{exporting ? "导出中…" : "开始导出"}</Button>
        </div>
      </div>
      {error && <InlineError message={`导出失败：${error}`} />}
      {result && (
        <div className="rounded-lg border border-border bg-background p-3 text-sm">
          <div className="font-medium">{result.fileName}</div>
          <div className="text-muted-foreground">{result.contentType} · 已导出 {result.chapterCount} 章</div>
        </div>
      )}
    </div>
  );
}
function WorkspaceLeftRail({
  activeBookId,
  activeEmptyAction,
  books,
  nodes,
  onBookChange,
  onEmptyStateAction,
  onSelect,
  selectedNodeId,
}: {
  readonly activeBookId: string | null;
  readonly activeEmptyAction: StudioResourceEmptyState["action"] | null;
  readonly books: readonly BookListItem[];
  readonly nodes: readonly StudioResourceNode[];
  readonly selectedNodeId: string;
  readonly onBookChange: (bookId: string) => void;
  readonly onEmptyStateAction: (node: StudioResourceNode, emptyState: StudioResourceEmptyState) => void;
  readonly onSelect: (nodeId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <nav aria-label="工作台全局入口" className="space-y-1 rounded-lg border border-border bg-background/60 p-2">
        {["仪表盘", "创作工作台", "工作流", "设置", "套路"].map((label) => (
          <button key={label} className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground" type="button">
            {label}
          </button>
        ))}
      </nav>
      <label className="block text-xs font-medium text-muted-foreground">
        当前作品
        <select aria-label="资源栏作品选择" className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground" value={activeBookId ?? ""} onChange={(event) => onBookChange(event.target.value)}>
          {books.length === 0 && <option value="">暂无作品</option>}
          {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
        </select>
      </label>
      <ResourceTree activeEmptyAction={activeEmptyAction} nodes={nodes} selectedNodeId={selectedNodeId} onEmptyStateAction={onEmptyStateAction} onSelect={onSelect} />
    </div>
  );
}

function ResourceTree({
  activeEmptyAction,
  nodes,
  onEmptyStateAction,
  onSelect,
  selectedNodeId,
}: {
  readonly activeEmptyAction: StudioResourceEmptyState["action"] | null;
  readonly nodes: readonly StudioResourceNode[];
  readonly selectedNodeId: string;
  readonly onEmptyStateAction: (node: StudioResourceNode, emptyState: StudioResourceEmptyState) => void;
  readonly onSelect: (nodeId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">资源管理器</h2>
      <div className="space-y-1">
        {nodes.map((node) => <ResourceNodeButton key={node.id} activeEmptyAction={activeEmptyAction} node={node} onEmptyStateAction={onEmptyStateAction} onSelect={onSelect} selectedNodeId={selectedNodeId} />)}
      </div>
    </div>
  );
}

function ResourceNodeButton({
  activeEmptyAction,
  node,
  onEmptyStateAction,
  onSelect,
  selectedNodeId,
}: {
  readonly activeEmptyAction: StudioResourceEmptyState["action"] | null;
  readonly node: StudioResourceNode;
  readonly selectedNodeId: string;
  readonly onEmptyStateAction: (node: StudioResourceNode, emptyState: StudioResourceEmptyState) => void;
  readonly onSelect: (nodeId: string) => void;
}) {
  const isSelected = node.id === selectedNodeId;
  const emptyActionActive = Boolean(node.emptyState && activeEmptyAction === node.emptyState.action);
  const emptyActionLabel = node.emptyState ? formatEmptyActionLabel(node.emptyState, emptyActionActive) : "";

  return (
    <div className="space-y-1">
      <button
        aria-current={isSelected ? "page" : undefined}
        className={`group flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        onClick={() => onSelect(node.id)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {node.kind === "chapter" && <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${node.status === "approved" ? "bg-emerald-500" : node.status === "ready-for-review" ? "bg-amber-500" : "bg-muted-foreground"}`} />}
          <span className="truncate">{node.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs opacity-80">
          {node.badge && <span>{node.badge}</span>}
          {typeof node.count === "number" && <span>{node.count}</span>}
          {node.kind === "chapter" && (
            <span className="invisible text-muted-foreground group-hover:visible">⋯</span>
          )}
        </span>
      </button>
      {node.emptyState && !node.children?.some((child) => (child.count ?? 0) > 0) && (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          <div>{node.emptyState.title}</div>
          <p className="mt-1 text-xs">{node.emptyState.description}</p>
          <button
            className="mt-2 text-primary hover:underline disabled:opacity-50"
            disabled={emptyActionActive && node.emptyState.action !== "import-chapter"}
            onClick={() => onEmptyStateAction(node, node.emptyState!)}
            type="button"
          >
            {emptyActionLabel}
          </button>
        </div>
      )}
      {node.children?.length ? (
        <div className="ml-3 border-l border-border pl-2">
          {node.children.map((child) => <ResourceNodeButton key={child.id} activeEmptyAction={activeEmptyAction} node={child} onEmptyStateAction={onEmptyStateAction} onSelect={onSelect} selectedNodeId={selectedNodeId} />)}
        </div>
      ) : null}
    </div>
  );
}

function formatEmptyActionLabel(emptyState: StudioResourceEmptyState, isActive: boolean): string {
  if (!isActive) return emptyState.actionLabel;
  switch (emptyState.action) {
    case "create-chapter":
      return "创建中…";
    case "generate-next":
      return "生成中…";
    case "import-chapter":
      return "导入面板已打开";
    default:
      return emptyState.actionLabel;
  }
}

function WorkspaceCanvas({
  activeTab,
  assistantApi,
  candidateApi,
  chapterApi,
  modelGate,
  node,
  openTabs,
  pendingNavigation,
  onCloseTab,
  onDirtyChange,
  onResolvePendingNavigation,
  onResourceMutation,
  onCandidateResult,
  onSelectTab,
}: {
  readonly activeTab: OpenResourceTab | null;
  readonly assistantApi: WorkspaceAssistantApi;
  readonly candidateApi: WorkspaceCandidateApi;
  readonly chapterApi: WorkspaceChapterApi;
  readonly modelGate: WorkspaceModelGate;
  readonly node: StudioResourceNode;
  readonly openTabs: readonly OpenResourceTab[];
  readonly pendingNavigation: PendingCanvasNavigation | null;
  readonly onCloseTab: (tabId: string) => void;
  readonly onDirtyChange: (tabId: string, dirty?: boolean) => void;
  readonly onResolvePendingNavigation: (action: WorkspaceCanvasDirtyAction) => void;
  readonly onResourceMutation: WorkspaceResourceMutationHandler;
  readonly onCandidateResult: (message: string) => void;
  readonly onSelectTab: (tabId: string) => void;
}) {
  const dirtyTab = pendingNavigation ? openTabs.find((tab) => tab.id === pendingNavigation.dirtyTabId) : null;

  return (
    <div className="relative space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <div role="tablist" aria-label="打开的资源" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {openTabs.map((tab) => (
            <button
              key={tab.id}
              aria-selected={tab.id === activeTab?.id}
              className={`flex max-w-48 shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs ${tab.id === activeTab?.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"}`}
              onClick={() => onSelectTab(tab.id)}
              role="tab"
              type="button"
            >
              <span className="truncate">{tab.title}</span>
              {tab.dirty ? <span aria-label="未保存">●</span> : null}
              <span
                aria-label={`关闭 ${tab.title}`}
                className="rounded px-1 hover:bg-background"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
                role="button"
                tabIndex={0}
              >
                ×
              </span>
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">{openTabs.length} 个已打开</div>
      </div>
      {pendingNavigation && dirtyTab ? (
        <div aria-label="未保存资源拦截" role="dialog" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          <h3 className="font-semibold">未保存资源拦截</h3>
          <p className="mt-1">{dirtyTab.title} 有未保存编辑。切换、关闭或 Agent 写入前，请先选择处理方式。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" type="button" onClick={() => onResolvePendingNavigation("save")}>保存</Button>
            <Button size="sm" variant="outline" type="button" onClick={() => onResolvePendingNavigation("discard")}>放弃更改</Button>
            <Button size="sm" variant="outline" type="button" onClick={() => onResolvePendingNavigation("save-as-candidate")}>另存为候选</Button>
          </div>
        </div>
      ) : null}
      {activeTab?.artifact && !findNode([node], activeTab.nodeId) && !activeTab.artifact.resourceRef ? (
        <AgentArtifactCanvas artifact={activeTab.artifact} />
      ) : (
        <WorkspaceEditor candidateApi={candidateApi} chapterApi={chapterApi} node={node} tabId={activeTab?.id ?? node.id} onDirtyChange={onDirtyChange} onResourceMutation={onResourceMutation} onCandidateResult={onCandidateResult} />
      )}
      <AssistantPanel assistantApi={assistantApi} modelGate={modelGate} selectedNode={node} onResourceMutation={onResourceMutation} />
    </div>
  );
}

function AgentArtifactCanvas({ artifact }: { readonly artifact: CanvasArtifact }) {
  return (
    <div className="space-y-3">
      <EditorHeader title={artifact.title} meta={`Agent 产物 · ${artifact.kind}`} />
      {artifact.summary ? <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">{artifact.summary}</p> : null}
      <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        <div>ID：{artifact.id}</div>
        {artifact.renderer ? <div>Renderer：{artifact.renderer}</div> : null}
        {artifact.payloadRef ? <div>Payload：{artifact.payloadRef}</div> : null}
      </div>
    </div>
  );
}

function WorkspaceEditor({
  candidateApi,
  chapterApi,
  node,
  tabId,
  onDirtyChange,
  onResourceMutation,
  onCandidateResult,
}: {
  readonly candidateApi: WorkspaceCandidateApi;
  readonly chapterApi: WorkspaceChapterApi;
  readonly node: StudioResourceNode;
  readonly tabId: string;
  readonly onDirtyChange: (tabId: string, dirty?: boolean) => void;
  readonly onResourceMutation: WorkspaceResourceMutationHandler;
  readonly onCandidateResult: (message: string) => void;
}) {
  switch (resolveWorkspaceNodeViewKind(node)) {
    case "candidate-editor":
      return <CandidateEditor candidateApi={candidateApi} node={node} onResourceMutation={onResourceMutation} onCandidateResult={onCandidateResult} />;
    case "chapter-editor":
      return <ChapterEditor chapterApi={chapterApi} node={node} tabId={tabId} onDirtyChange={onDirtyChange} />;
    case "bible-category-view":
      return <BibleCategoryView node={node} />;
    case "draft-editor":
      return <DraftEditor node={node} />;
    case "outline-editor":
      return <OutlineEditor node={node} />;
    case "bible-entry-editor":
      return <BibleCategoryView node={node} />;
    case "markdown-viewer":
      return <MarkdownViewer node={node} />;
    case "material-viewer":
      return <MaterialViewer node={node} />;
    case "publish-report-viewer":
      return <PublishReportViewer node={node} />;
    case "unsupported":
    default:
      return <UnsupportedWorkspaceNodeView node={node} />;
  }
}

function formatAiResultMetadata(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const provider = typeof metadata.provider === "string" ? metadata.provider : null;
  const model = typeof metadata.model === "string" ? metadata.model : null;
  const request = typeof metadata.runId === "string" ? metadata.runId : typeof metadata.requestId === "string" ? metadata.requestId : null;
  const parts = [provider, model, request].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `AI 来源：${parts.join(" / ")}` : null;
}

function CandidateEditor({
  candidateApi,
  node,
  onResourceMutation,
  onCandidateResult,
}: {
  readonly candidateApi: WorkspaceCandidateApi;
  readonly node: StudioResourceNode;
  readonly onResourceMutation: WorkspaceResourceMutationHandler;
  readonly onCandidateResult: (message: string) => void;
}) {
  const [pendingAction, setPendingAction] = useState<"merge" | "replace" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const bookId = typeof node.metadata?.bookId === "string" ? node.metadata.bookId : "";
  const candidateId = node.id.replace(/^generated:/, "");
  const targetChapterId = typeof node.metadata?.targetChapterId === "string" ? node.metadata.targetChapterId : "未指定";
  const candidateContent = typeof node.metadata?.content === "string" ? node.metadata.content : null;
  const contentError = typeof node.metadata?.contentError === "string" ? node.metadata.contentError : null;
  const aiMetadataText = formatAiResultMetadata(node.metadata?.aiMetadata);
  const hasContent = candidateContent !== null;

  const accept = async (action: CandidateAcceptAction) => {
    setActionError(null);
    await candidateApi.acceptCandidate(bookId, candidateId, action);
    const message = action === "merge" ? "候选稿已合并到正式章节" : action === "replace" ? "候选稿已替换正式章节" : "候选稿已另存为草稿";
    await onResourceMutation(action === "draft" ? "candidate-draft" : "candidate-chapter");
    onCandidateResult(message);
    setPendingAction(null);
  };

  const reject = async () => {
    setActionError(null);
    await candidateApi.rejectCandidate(bookId, candidateId);
    await onResourceMutation("candidates");
    onCandidateResult("候选稿已放弃");
  };

  const runAction = (operation: () => Promise<void>) => {
    operation().catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)));
  };

  return (
    <div className="space-y-4">
      <EditorHeader title={node.title} meta="候选稿 / 不会自动覆盖正式正文" />
      {aiMetadataText && <p className="text-xs text-muted-foreground">{aiMetadataText}</p>}
      {actionError && <InlineError message={`候选稿操作失败：${actionError}`} />}
      {pendingAction && (
        <div className="rounded-lg border border-border bg-background p-4 text-sm">
          <h3 className="font-semibold">确认{pendingAction === "merge" ? "合并" : "替换"}到正式章节</h3>
          <p className="mt-2">目标章节：{targetChapterId}</p>
          <p className="mt-1 text-muted-foreground">
            影响范围：{pendingAction === "merge" ? "追加到正式章节末尾，保留原正文。" : "用候选稿替换目标正式章节正文。"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => runAction(() => accept(pendingAction))} type="button">
              {pendingAction === "merge" ? "确认合并" : "确认替换"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPendingAction(null)} type="button">取消</Button>
          </div>
        </div>
      )}
      {contentError ? <InlineError message={contentError} /> : null}
      {hasContent ? (
        <textarea aria-label="候选稿正文" className="min-h-[22rem] w-full resize-none rounded-lg border border-border bg-background p-4 leading-7" readOnly value={candidateContent} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!hasContent} onClick={() => setPendingAction("merge")} type="button">合并到正式章节</Button>
        <Button size="sm" variant="outline" disabled={!hasContent} onClick={() => setPendingAction("replace")} type="button">替换正式章节</Button>
        <Button size="sm" variant="outline" disabled={!hasContent} onClick={() => runAction(() => accept("draft"))} type="button">另存为草稿</Button>
        <Button size="sm" variant="destructive" onClick={() => runAction(reject)} type="button">放弃候选稿</Button>
      </div>
    </div>
  );
}

function ChapterEditor({ chapterApi, node, tabId, onDirtyChange }: { readonly chapterApi: WorkspaceChapterApi; readonly node: StudioResourceNode; readonly tabId: string; readonly onDirtyChange: (tabId: string, dirty?: boolean) => void }) {
  const chapterNumber = typeof node.metadata?.chapterNumber === "number" ? node.metadata.chapterNumber : Number(node.metadata?.chapterNumber ?? 0);
  const bookId = typeof node.metadata?.bookId === "string" ? node.metadata.bookId : "";
  const [content, setContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<"loading" | "clean" | "dirty" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<{ getMarkdown: () => string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSaveStatus("loading");
    setError(null);
    chapterApi.loadChapter(bookId, chapterNumber)
      .then((chapter) => {
        if (cancelled) return;
        setContent(chapter.content);
        setSaveStatus("clean");
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setSaveStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterApi, chapterNumber]);

  const handleSave = async () => {
    const currentContent = editorRef.current?.getMarkdown() ?? content;
    setSaveStatus("saving");
    setError(null);
    try {
      await chapterApi.saveChapter(bookId, chapterNumber, currentContent);
      setContent(currentContent);
      setSaveStatus("saved");
      onDirtyChange(tabId, false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      setSaveStatus("error");
    }
  };

  const statusLabel = error ? `保存失败：${error}` : saveStatusToLabel(saveStatus);

  return (
    <div className="space-y-4">
      <EditorHeader onSave={() => void handleSave()} saveDisabled={saveStatus === "loading" || saveStatus === "saving"} title={node.title} meta={`章节状态：${chapterStatusLabel(node.status)} · 字数：${countWords(content)} · 保存状态：${statusLabel}`} />
      {saveStatus === "loading" && <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">正在加载章节正文...</div>}
      {error && <InlineError message={`保存失败：${error}`} />}
      {saveStatus !== "loading" && (
        <InkEditor
          ref={editorRef}
          initialContent={content}
          onChange={(markdown) => {
            setContent(markdown);
            setError(null);
            setSaveStatus("dirty");
            onDirtyChange(tabId, true);
          }}
          editable
          bookId={bookId}
          chapterNumber={chapterNumber}
          className="min-h-[26rem]"
        />
      )}
    </div>
  );
}

function saveStatusToLabel(status: "loading" | "clean" | "dirty" | "saving" | "saved" | "error"): string {
  switch (status) {
    case "loading":
      return "加载中";
    case "dirty":
      return "未保存";
    case "saving":
      return "保存中";
    case "saved":
      return "已保存";
    case "error":
      return "失败";
    case "clean":
    default:
      return "未修改";
  }
}

function countWords(content: string | null | undefined): number {
  return (content ?? "").replace(/\s+/g, "").length;
}

function EditorHeader({
  title,
  meta,
  onSave,
  saveDisabled = false,
}: {
  readonly title: string;
  readonly meta: string;
  readonly onSave?: () => void;
  readonly saveDisabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>
      <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50" disabled={saveDisabled} onClick={onSave} type="button">保存</button>
    </div>
  );
}

const ASSISTANT_ACTIONS: ReadonlyArray<{ readonly id: WorkspaceAssistantActionId; readonly label: string; readonly gate: AiAction }> = [
  { id: "write-next", label: "生成下一章", gate: "ai-writing" },
  { id: "continue", label: "续写当前段落", gate: "ai-rewrite" },
  { id: "audit", label: "审校当前章", gate: "ai-review" },
  { id: "rewrite", label: "改写选中段落", gate: "ai-rewrite" },
  { id: "de-ai", label: "去 AI 味", gate: "deep-ai-taste-scan" },
  { id: "continuity", label: "连续性检查", gate: "ai-review" },
];

/* ── 驾驶舱面板（二级 Tab） ── */


function AssistantPanel({
  assistantApi,
  modelGate,
  selectedNode,
  onResourceMutation,
}: {
  readonly assistantApi: WorkspaceAssistantApi;
  readonly modelGate: WorkspaceModelGate;
  readonly selectedNode: StudioResourceNode;
  readonly onResourceMutation: WorkspaceResourceMutationHandler;
}) {
  const [runningAction, setRunningAction] = useState<WorkspaceAssistantActionId | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionData, setActionData] = useState<Record<string, unknown> | null>(null);

  const context: WorkspaceAssistantContext = {
    bookId: typeof selectedNode.metadata?.bookId === "string" ? selectedNode.metadata.bookId : "",
    chapterNumber: typeof selectedNode.metadata?.chapterNumber === "number" ? selectedNode.metadata.chapterNumber : undefined,
    selectedNodeId: selectedNode.id,
    selectedNodeTitle: selectedNode.title,
  };

  const handleAction = (action: (typeof ASSISTANT_ACTIONS)[number]) => {
    setActionMessage(null);
    setActionError(null);
    setActionData(null);
    if (!modelGate.ensureModelFor(action.gate)) {
      return;
    }
    setRunningAction(action.id);
    assistantApi.runAction(action.id, context)
      .then(async (result) => {
        const resourceMutationTarget = result.resourceMutationTarget ?? (action.id === "write-next" ? "candidates" : null);
        if (resourceMutationTarget) await onResourceMutation(resourceMutationTarget);
        setActionMessage(result.message);
        if (result.data) setActionData(result.data);
      })
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)))
      .finally(() => setRunningAction(null));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">AI / 经纬面板</h2>
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">当前上下文：{selectedNode.title}</div>
      {modelGate.blockedResult && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <div className="font-medium">AI Gate</div>
          <p className="mt-1 text-muted-foreground">{modelGate.blockedResult.message}</p>
          <button className="mt-2 text-xs text-primary hover:underline" onClick={modelGate.closeGate} type="button">关闭</button>
        </div>
      )}
      {actionMessage && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">{actionMessage}</div>}
      {actionData && !actionError && (
        <div className="rounded-lg border border-border bg-card p-3 text-xs max-h-64 overflow-y-auto">
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(actionData, null, 2)}</pre>
        </div>
      )}
      {actionError && <InlineError message={`AI 动作失败：${actionError}`} />}
      {runningAction && <RunStatus action={ASSISTANT_ACTIONS.find((a) => a.id === runningAction)?.label ?? runningAction} running />}
      <div className="grid grid-cols-2 gap-1.5">
        {ASSISTANT_ACTIONS.map((action) => (
          <button
            key={action.id}
            className="rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
            disabled={runningAction !== null}
            onClick={() => handleAction(action)}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
      <AgentWritingEntry bookId={context.bookId} modelGate={modelGate} />
      <WritingModesPanel selectedNode={selectedNode} onResourceMutation={onResourceMutation} />
      <WritingToolsPanel selectedNode={selectedNode} onResourceMutation={onResourceMutation} />
    </div>
  );
}

/* ── Agent 写作入口 ── */

function AgentWritingEntry({ bookId, modelGate }: { readonly bookId: string; readonly modelGate: WorkspaceModelGate }) {
  const [intent, setIntent] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleAgentWrite = async () => {
    if (!intent.trim() || !bookId) return;
    if (!modelGate.ensureModelFor("ai-writing")) return;

    setStatus("sending");
    setMessage(null);
    try {
      // 创建 writer session 并注入上下文
      await postApi(`/sessions`, {
        agentId: "writer",
        projectId: bookId,
        initialMessage: `请分析 ${bookId} 的当前创作状态，然后根据以下意图处理：${intent.trim()}`,
      });
      setStatus("done");
      setMessage(`Agent 写作流程已启动。在 ChatWindow 中查看 Writer 会话。`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "启动 Agent 写作失败");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">Agent 写作</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Beta</span>
      </div>
      <p className="text-[11px] text-muted-foreground">输入你想让 Agent 做的事情，Agent 会自动探索、规划、写作、审校。</p>
      <input
        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
        placeholder="例：写下一章，回收玉佩伏笔，保持林月冷峻性格"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        disabled={status === "sending"}
      />
      <div className="flex items-center gap-2">
        <button
          className="rounded-lg bg-primary px-3 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          disabled={!intent.trim() || !bookId || status === "sending"}
          onClick={() => void handleAgentWrite()}
          type="button"
        >
          {status === "sending" ? "启动中..." : "启动 Agent 写作"}
        </button>
      </div>
      {message && (
        <p className={`text-[11px] ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>
      )}
    </div>
  );
}

function WritingModesPanel({ selectedNode, onResourceMutation }: { readonly selectedNode: StudioResourceNode; readonly onResourceMutation: WorkspaceResourceMutationHandler }) {
  const [open, setOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<"inline" | "dialogue-gen" | "variants" | "outline">("inline");
  const [pendingApply, setPendingApply] = useState<PendingWritingModeApply | null>(null);
  const [applyTarget, setApplyTarget] = useState<WritingModeApplyTarget>("candidate");
  const [applying, setApplying] = useState(false);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const bookId = typeof selectedNode.metadata?.bookId === "string" ? selectedNode.metadata.bookId : "";
  const chapterNumber = typeof selectedNode.metadata?.chapterNumber === "number" ? selectedNode.metadata.chapterNumber : 1;
  const isChapterContext = selectedNode.kind === "chapter" || selectedNode.kind === "generated-chapter";
  const selectedText = isChapterContext ? selectedNode.title : "";

  const beginApply = (content: string, sourceMode: string, title: string) => {
    setPendingApply({ content, sourceMode, title });
    setApplyTarget(sourceMode === "outline-branch" ? "candidate" : "candidate");
    setApplyNotice(null);
    setApplyError(null);
  };

  const applyWritingMode = async () => {
    if (!pendingApply || !bookId) return;
    setApplying(true);
    setApplyError(null);
    try {
      const payload: WritingModeApplyPayload = {
        target: applyTarget,
        title: pendingApply.title,
        content: pendingApply.content,
        sourceMode: pendingApply.sourceMode,
        ...(isChapterContext ? { chapterNumber } : {}),
      };
      const response = await postApi<WritingModeApplyResponse>(`/books/${bookId}/writing-modes/apply`, payload);
      await onResourceMutation(response.target === "draft" ? "drafts" : "candidates");
      const targetLabel = response.target === "draft" ? "草稿" : "候选稿";
      setApplyNotice(`写作结果已保存到${targetLabel} ${response.resourceId}`);
      setPendingApply(null);
    } catch (error: unknown) {
      setApplyError(`写作模式应用失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <button className="flex w-full items-center justify-between font-medium" onClick={() => setOpen(!open)} type="button">
        <span>写作模式</span>
        <span className="text-xs text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1">
            {isChapterContext && (
              <>
                <Button size="xs" variant={activeMode === "inline" ? "default" : "outline"} onClick={() => setActiveMode("inline")} type="button">续写/扩写/补写</Button>
                <Button size="xs" variant={activeMode === "dialogue-gen" ? "default" : "outline"} onClick={() => setActiveMode("dialogue-gen")} type="button">对话生成</Button>
                <Button size="xs" variant={activeMode === "variants" ? "default" : "outline"} onClick={() => setActiveMode("variants")} type="button">多版本</Button>
              </>
            )}
            <Button size="xs" variant={activeMode === "outline" ? "default" : "outline"} onClick={() => setActiveMode("outline")} type="button">大纲分支</Button>
          </div>

          <p className="rounded-lg border border-dashed border-border bg-background/60 p-2 text-xs text-muted-foreground">
            生成接口返回预览时会直接转入候选确认流程；真实生成结果必须先选择候选稿或草稿，再确认应用。正式章节插入/替换会转成非破坏性候选稿。
          </p>
          {applyNotice && <p className="text-xs text-muted-foreground">{applyNotice}</p>}
          {applyError && <p className="text-xs text-destructive">{applyError}</p>}

          {isChapterContext && activeMode === "inline" && (
            <InlineWritePanel bookId={bookId} chapterNumber={chapterNumber} selectedText={selectedText} onAccept={(content) => beginApply(content, "inline-write", "续写结果")} onDiscard={() => setPendingApply(null)} />
          )}
          {isChapterContext && activeMode === "dialogue-gen" && (
            <DialogueGenerator bookId={bookId} chapterNumber={chapterNumber} onInsert={(content) => beginApply(content, "dialogue-generator", "对话生成结果")} />
          )}
          {isChapterContext && activeMode === "variants" && (
            <VariantCompare bookId={bookId} chapterNumber={chapterNumber} selectedText={selectedText} onAccept={(content) => beginApply(content, "variant-compare", "多版本候选结果")} />
          )}
          {activeMode === "outline" && (
            <OutlineBrancher bookId={bookId} onSelectBranch={(content) => beginApply(content, "outline-branch", "大纲分支结果")} />
          )}

          {pendingApply && (
            <div className="space-y-2 rounded-lg border border-border bg-background/70 p-3 text-xs">
              <div className="font-medium">应用写作结果</div>
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-muted/20 p-2 leading-6 text-muted-foreground">{pendingApply.content}</pre>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="xs" variant={applyTarget === "candidate" ? "default" : "outline"} onClick={() => setApplyTarget("candidate")}>保存为候选稿</Button>
                <Button type="button" size="xs" variant={applyTarget === "draft" ? "default" : "outline"} onClick={() => setApplyTarget("draft")}>保存为草稿</Button>
                {isChapterContext && <Button type="button" size="xs" variant={applyTarget === "chapter-insert" ? "default" : "outline"} onClick={() => setApplyTarget("chapter-insert")}>插入为候选</Button>}
                {isChapterContext && <Button type="button" size="xs" variant={applyTarget === "chapter-replace" ? "default" : "outline"} onClick={() => setApplyTarget("chapter-replace")}>替换为候选</Button>}
              </div>
              <div className="flex gap-2">
                <Button type="button" size="xs" onClick={() => void applyWritingMode()} disabled={applying}>{applying ? "应用中..." : "确认应用写作结果"}</Button>
                <Button type="button" size="xs" variant="outline" onClick={() => setPendingApply(null)} disabled={applying}>取消</Button>
              </div>
            </div>
          )}

          {!isChapterContext && activeMode !== "outline" && (
            <p className="text-xs text-muted-foreground">请选择一个章节以使用写作模式工具。</p>
          )}
        </div>
      )}
    </div>
  );
}

function WritingToolsPanel({ selectedNode, onResourceMutation }: { readonly selectedNode: StudioResourceNode; readonly onResourceMutation: WorkspaceResourceMutationHandler }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"rhythm" | "dialogue" | "hooks" | "progress" | "health" | "conflicts" | "arcs" | "tone">("rhythm");
  const [rhythmAnalysis, setRhythmAnalysis] = useState<RhythmChartAnalysis | null>(null);
  const [dialogueAnalysis, setDialogueAnalysis] = useState<DialogueAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [hookApplying, setHookApplying] = useState(false);
  const [hookApplyStatus, setHookApplyStatus] = useState<string | null>(null);
  const [hookApplyError, setHookApplyError] = useState<string | null>(null);

  const bookId = typeof selectedNode.metadata?.bookId === "string" ? selectedNode.metadata.bookId : "";
  const chapterNumber = typeof selectedNode.metadata?.chapterNumber === "number" ? selectedNode.metadata.chapterNumber : undefined;
  const isChapterContext = selectedNode.kind === "chapter" || selectedNode.kind === "generated-chapter";

  const loadAnalysis = async () => {
    if (!chapterNumber) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const [rhythm, dialogue] = await Promise.all([
        fetchJson<RhythmChartAnalysis>(`/books/${bookId}/chapters/${chapterNumber}/rhythm`, { method: "POST" }),
        fetchJson<DialogueAnalysisResult>(`/books/${bookId}/chapters/${chapterNumber}/dialogue`, { method: "POST" }),
      ]);
      setRhythmAnalysis(rhythm);
      setDialogueAnalysis(dialogue);
    } catch (error: unknown) {
      setAnalysisError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleApplyHook = async (hook: GeneratedHookOption) => {
    if (!bookId || chapterNumber === undefined) {
      setHookApplyError("缺少可写入的书籍或章节上下文");
      return;
    }

    setHookApplying(true);
    setHookApplyStatus(null);
    setHookApplyError(null);
    try {
      const response = await fetchJson<{ readonly persisted: boolean; readonly file?: string }>(`/books/${bookId}/hooks/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterNumber, hook }),
      });
      if (!response.persisted) throw new Error("钩子未写入持久化文件");
      await onResourceMutation("story-files");
      setHookApplyStatus(`钩子已写入 ${response.file ?? "pending_hooks.md"}`);
    } catch (error: unknown) {
      setHookApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setHookApplying(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <button className="flex w-full items-center justify-between font-medium" onClick={() => setOpen(!open)} type="button">
        <span>写作工具</span>
        <span className="text-xs text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1">
            {isChapterContext && (
              <>
                <Button size="xs" variant={activeTab === "rhythm" ? "default" : "outline"} onClick={() => setActiveTab("rhythm")} type="button">节奏分析</Button>
                <Button size="xs" variant={activeTab === "dialogue" ? "default" : "outline"} onClick={() => setActiveTab("dialogue")} type="button">对话分析</Button>
                <Button size="xs" variant={activeTab === "hooks" ? "default" : "outline"} onClick={() => setActiveTab("hooks")} type="button">钩子生成</Button>
              </>
            )}
            <Button size="xs" variant={activeTab === "progress" ? "default" : "outline"} onClick={() => setActiveTab("progress")} type="button">日更进度</Button>
            <Button size="xs" variant={activeTab === "health" ? "default" : "outline"} onClick={() => setActiveTab("health")} type="button">全书健康</Button>
            <Button size="xs" variant={activeTab === "conflicts" ? "default" : "outline"} onClick={() => setActiveTab("conflicts")} type="button">矛盾地图</Button>
            <Button size="xs" variant={activeTab === "arcs" ? "default" : "outline"} onClick={() => setActiveTab("arcs")} type="button">角色弧线</Button>
            {isChapterContext && (
              <Button size="xs" variant={activeTab === "tone" ? "default" : "outline"} onClick={() => setActiveTab("tone")} type="button">文风守护</Button>
            )}
          </div>

          {isChapterContext && activeTab === "rhythm" && (
            <div className="space-y-2">
              {!rhythmAnalysis && !analysisLoading && (
                <Button className="w-full" size="sm" onClick={() => void loadAnalysis()} type="button">
                  运行节奏 + 对话分析
                </Button>
              )}
              {analysisLoading && <p className="text-xs text-muted-foreground">正在分析...</p>}
              {analysisError && <p className="text-xs text-destructive">分析失败：{analysisError}</p>}
              {rhythmAnalysis && <RhythmChart analysis={rhythmAnalysis} />}
            </div>
          )}

          {isChapterContext && activeTab === "dialogue" && (
            <div className="space-y-2">
              {!dialogueAnalysis && !analysisLoading && (
                <Button className="w-full" size="sm" onClick={() => void loadAnalysis()} type="button">
                  运行节奏 + 对话分析
                </Button>
              )}
              {analysisLoading && <p className="text-xs text-muted-foreground">正在分析...</p>}
              {analysisError && <p className="text-xs text-destructive">分析失败：{analysisError}</p>}
              {dialogueAnalysis && <DialogueAnalysis analysis={dialogueAnalysis} />}
            </div>
          )}

          {isChapterContext && activeTab === "hooks" && chapterNumber !== undefined && (
            <div className="space-y-2">
              <ChapterHookGenerator
                bookId={bookId}
                chapterNumber={chapterNumber}
                chapterContent=""
                onApplyHook={handleApplyHook}
                applyDisabled={hookApplying || !bookId}
                applyDisabledReason={hookApplying ? "正在写入 pending_hooks.md" : "缺少可写入的书籍上下文"}
              />
              {hookApplyStatus && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">{hookApplyStatus}</p>}
              {hookApplyError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">钩子写入失败：{hookApplyError}</p>}
            </div>
          )}

          {activeTab === "progress" && <DailyProgressTracker />}

          {activeTab === "health" && <BookHealthDashboard bookId={bookId} />}

          {activeTab === "conflicts" && <ConflictMap bookId={bookId} />}

          {activeTab === "arcs" && <CharacterArcDashboard bookId={bookId} />}

          {isChapterContext && activeTab === "tone" && chapterNumber !== undefined && (
            <ToneDriftAlert bookId={bookId} chapterNumber={chapterNumber} />
          )}

          {!isChapterContext && activeTab !== "progress" && activeTab !== "health" && activeTab !== "conflicts" && activeTab !== "arcs" && (
            <p className="text-xs text-muted-foreground">请选择一个章节以使用节奏分析、对话分析和钩子生成工具。</p>
          )}
        </div>
      )}
    </div>
  );
}

function mergeOptimisticChapterNodes(tree: readonly StudioResourceNode[], optimisticNodes: readonly StudioResourceNode[]): readonly StudioResourceNode[] {
  if (optimisticNodes.length === 0 || tree.length === 0) return tree;
  const [bookNode, ...rest] = tree;
  const optimisticById = new Map(optimisticNodes.map((node) => [node.id, node]));
  const chapterGroup = bookNode.children?.[0]?.children?.[0];
  const existingChapterIds = new Set(chapterGroup?.children?.map((node) => node.id) ?? []);
  const missingOptimisticNodes = optimisticNodes.filter((node) => !existingChapterIds.has(node.id));
  if (!chapterGroup || missingOptimisticNodes.length === 0) return tree;

  const mergedChapterGroup: StudioResourceNode = {
    ...chapterGroup,
    children: [...(chapterGroup.children ?? []).map((node) => optimisticById.get(node.id) ?? node), ...missingOptimisticNodes].sort((left, right) => {
      const leftNumber = typeof left.metadata?.chapterNumber === "number" ? left.metadata.chapterNumber : Number.MAX_SAFE_INTEGER;
      const rightNumber = typeof right.metadata?.chapterNumber === "number" ? right.metadata.chapterNumber : Number.MAX_SAFE_INTEGER;
      return leftNumber - rightNumber;
    }),
  };
  const volumeNode = bookNode.children?.[0];
  if (!volumeNode) return tree;
  const mergedVolumeNode: StudioResourceNode = {
    ...volumeNode,
    children: [mergedChapterGroup, ...(volumeNode.children ?? []).slice(1)],
  };
  const mergedBookNode: StudioResourceNode = {
    ...bookNode,
    children: [mergedVolumeNode, ...(bookNode.children ?? []).slice(1)],
  };
  return [mergedBookNode, ...rest];
}

function findNode(nodes: readonly StudioResourceNode[] | StudioResourceNode, nodeId: string): StudioResourceNode | undefined {
  const list = Array.isArray(nodes) ? nodes : [nodes];
  for (const node of list) {
    if (node.id === nodeId) return node;
    const found = findNode(node.children ?? [], nodeId);
    if (found) return found;
  }
  return undefined;
}
