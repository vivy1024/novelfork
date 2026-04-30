import { useEffect, useMemo, useRef, useState } from "react";

import { ResourceWorkspaceLayout, SectionLayout } from "../components/layouts";
import { useAiModelGate } from "../../hooks/use-ai-model-gate";
import {
  buildStudioResourceTree,
  type StudioResourceNode,
  type StudioResourceTreeInput,
} from "./resource-adapter";
import { BiblePanel } from "./BiblePanel";
import { PublishPanel } from "./PublishPanel";
import { fetchJson, postApi, useApi } from "../../hooks/use-api";
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
import { Button } from "../../components/ui/button";
import {
  BibleCategoryView,
  BibleEntryEditor,
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

export interface WorkspaceAssistantContext {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly selectedNodeId: string;
  readonly selectedNodeTitle: string;
}

export interface WorkspaceAssistantActionResult {
  readonly message: string;
  readonly resourceMutationTarget?: WorkspaceResourceMutationTarget;
}

export interface WorkspaceAssistantApi {
  readonly runAction: (action: WorkspaceAssistantActionId, context: WorkspaceAssistantContext) => Promise<WorkspaceAssistantActionResult>;
}

type WorkspaceResourceMutationTarget = "chapters" | "candidates" | "drafts" | "candidate-draft" | "candidate-chapter" | "story-files" | "all";
type WorkspaceResourceMutationHandler = (target: WorkspaceResourceMutationTarget) => Promise<void>;
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
    message: "续写当前段落已生成 prompt-preview，请在写作模式面板确认后写入。",
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
    await fetchJson(routeConfig.route(context), request);
    return {
      message: routeConfig.message,
      resourceMutationTarget: routeConfig.resourceMutationTarget,
    };
  },
};

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

  /* ── load selected book detail + candidates ── */
  const { data: bookDetail, refetch: refetchBookDetail } = useApi<BookDetailResponse>(activeBookId ? `/books/${activeBookId}` : null);
  const { data: candidatesData, refetch: refetchCandidates } = useApi<CandidatesResponse>(activeBookId ? `/books/${activeBookId}/candidates` : null);
  const { data: storyFilesData, refetch: refetchStoryFiles } = useApi<WorkspaceTextFileListResponse>(activeBookId ? `/books/${activeBookId}/story-files` : null);
  const { data: truthFilesData, refetch: refetchTruthFiles } = useApi<WorkspaceTextFileListResponse>(activeBookId ? `/books/${activeBookId}/truth-files` : null);
  const { data: draftsData, refetch: refetchDrafts } = useApi<{ drafts: DraftResource[] }>(activeBookId ? `/books/${activeBookId}/drafts` : null);
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [createChapterError, setCreateChapterError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportFormat, setExportFormat] = useState<"markdown" | "txt">("markdown");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<BookExportResponse | null>(null);
  const [publishReports, setPublishReports] = useState<PublishReportResource[]>([]);

  useEffect(() => {
    setCreateChapterError(null);
    setWorkspaceNotice(null);
    setShowExportPanel(false);
    setExportError(null);
    setExportResult(null);
    setPublishReports([]);
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
    const chaptersFromBook: ChapterSummary[] = chs.map((c) => ({
      number: c.number, title: c.title ?? `第${c.number}章`, status: normalizeChapterStatus(c.status),
      wordCount: c.wordCount ?? 0, auditIssueCount: 0, updatedAt: "", fileName: c.fileName ?? null,
    }));
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
      title: file.name,
      path: `story/${file.name}`,
      fileType: file.name.endsWith(".json") ? "text" as const : "markdown" as const,
    }));
    const truthFiles = (truthFilesData?.files ?? []).map((file) => ({
      id: file.name,
      title: file.name,
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

  const tree = useMemo(() => buildStudioResourceTree(treeInput), [treeInput]);
  const defaultNodeId = tree[0]?.children?.[0]?.children?.[0]?.children?.[0]?.id ?? tree[0]?.children?.[0]?.children?.[0]?.id ?? tree[0]?.id ?? "";
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const activeNodeId = selectedNodeId ?? defaultNodeId;
  const selectedNode = findNode(tree, activeNodeId) ?? tree[0]!;

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
      setSelectedNodeId(`chapter:${activeBookId}:${response.chapter.number}`);
      setShowPublishPanel(false);
      await refreshWorkspaceResources("chapters");
    } catch (error) {
      setCreateChapterError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingChapter(false);
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
              onChange={(e) => { setSelectedBookId(e.target.value); setSelectedNodeId(null); }}
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
          <Button size="sm" variant="outline" disabled title="即将推出" type="button">预设管理</Button>
        </div>
      </div>

      {workspaceNotice && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">{workspaceNotice}</div>}
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
        explorer={<ResourceTree nodes={tree} selectedNodeId={selectedNode.id} onSelect={(id) => { setSelectedNodeId(id); setShowPublishPanel(false); setShowExportPanel(false); }} />}
        editor={showPublishPanel && activeBookId ? <PublishPanel bookId={activeBookId} onReport={handlePublishReport} /> : <WorkspaceEditor candidateApi={candidateApi} chapterApi={chapterApi} node={selectedNode} onResourceMutation={refreshWorkspaceResources} onCandidateResult={(message) => setWorkspaceNotice(message)} />}
        assistant={<AssistantPanel assistantApi={assistantApi} modelGate={effectiveModelGate} selectedNode={selectedNode} onResourceMutation={refreshWorkspaceResources} />}
      />
    </SectionLayout>
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
function ResourceTree({
  nodes,
  onSelect,
  selectedNodeId,
}: {
  readonly nodes: readonly StudioResourceNode[];
  readonly selectedNodeId: string;
  readonly onSelect: (nodeId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">资源管理器</h2>
      <div className="space-y-1">
        {nodes.map((node) => <ResourceNodeButton key={node.id} node={node} onSelect={onSelect} selectedNodeId={selectedNodeId} />)}
      </div>
    </div>
  );
}

function ResourceNodeButton({
  node,
  onSelect,
  selectedNodeId,
}: {
  readonly node: StudioResourceNode;
  readonly selectedNodeId: string;
  readonly onSelect: (nodeId: string) => void;
}) {
  const isSelected = node.id === selectedNodeId;

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
          <button disabled className="mt-1 text-primary hover:underline disabled:opacity-50" type="button">{node.emptyState.actionLabel}</button>
        </div>
      )}
      {node.children?.length ? (
        <div className="ml-3 border-l border-border pl-2">
          {node.children.map((child) => <ResourceNodeButton key={child.id} node={child} onSelect={onSelect} selectedNodeId={selectedNodeId} />)}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceEditor({
  candidateApi,
  chapterApi,
  node,
  onResourceMutation,
  onCandidateResult,
}: {
  readonly candidateApi: WorkspaceCandidateApi;
  readonly chapterApi: WorkspaceChapterApi;
  readonly node: StudioResourceNode;
  readonly onResourceMutation: WorkspaceResourceMutationHandler;
  readonly onCandidateResult: (message: string) => void;
}) {
  switch (resolveWorkspaceNodeViewKind(node)) {
    case "candidate-editor":
      return <CandidateEditor candidateApi={candidateApi} node={node} onResourceMutation={onResourceMutation} onCandidateResult={onCandidateResult} />;
    case "chapter-editor":
      return <ChapterEditor chapterApi={chapterApi} node={node} />;
    case "bible-category-view":
      return <BibleCategoryView node={node} />;
    case "draft-editor":
      return <DraftEditor node={node} />;
    case "outline-editor":
      return <OutlineEditor node={node} />;
    case "bible-entry-editor":
      return <BibleEntryEditor node={node} />;
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

function ChapterEditor({ chapterApi, node }: { readonly chapterApi: WorkspaceChapterApi; readonly node: StudioResourceNode }) {
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
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      setSaveStatus("error");
    }
  };

  const statusLabel = error ? `保存失败：${error}` : saveStatusToLabel(saveStatus);

  return (
    <div className="space-y-4">
      <EditorHeader onSave={() => void handleSave()} saveDisabled={saveStatus === "loading" || saveStatus === "saving"} title={node.title} meta={`章节状态：${node.status ?? "unknown"} · 字数：${countWords(content)} · 保存状态：${statusLabel}`} />
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

function countWords(content: string): number {
  return content.replace(/\s+/g, "").length;
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

  const context: WorkspaceAssistantContext = {
    bookId: typeof selectedNode.metadata?.bookId === "string" ? selectedNode.metadata.bookId : "",
    chapterNumber: typeof selectedNode.metadata?.chapterNumber === "number" ? selectedNode.metadata.chapterNumber : undefined,
    selectedNodeId: selectedNode.id,
    selectedNodeTitle: selectedNode.title,
  };

  const handleAction = (action: (typeof ASSISTANT_ACTIONS)[number]) => {
    setActionMessage(null);
    setActionError(null);
    if (!modelGate.ensureModelFor(action.gate)) {
      return;
    }
    setRunningAction(action.id);
    assistantApi.runAction(action.id, context)
      .then(async (result) => {
        const resourceMutationTarget = result.resourceMutationTarget ?? (action.id === "write-next" ? "candidates" : null);
        if (resourceMutationTarget) await onResourceMutation(resourceMutationTarget);
        setActionMessage(result.message);
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
      <BiblePanel bookId={context.bookId} chapterNumber={context.chapterNumber} />
      <WritingModesPanel selectedNode={selectedNode} onResourceMutation={onResourceMutation} />
      <WritingToolsPanel selectedNode={selectedNode} onResourceMutation={onResourceMutation} />
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
            生成接口若返回 Prompt 预览会保持未接入按钮；真实生成结果必须先选择候选稿或草稿，再确认应用。正式章节插入/替换会转成非破坏性候选稿。
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

function findNode(nodes: readonly StudioResourceNode[], nodeId: string): StudioResourceNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const found = findNode(node.children ?? [], nodeId);
    if (found) return found;
  }
  return undefined;
}
