import { useEffect, useMemo, useRef, useState } from "react";

import { ResourceWorkspaceLayout, SectionLayout } from "../components/layouts";
import { useAiModelGate } from "../../hooks/use-ai-model-gate";
import {
  buildStudioResourceTree,
  type GeneratedChapterCandidate,
  type StudioResourceNode,
  type StudioResourceTreeInput,
} from "./resource-adapter";
import { BiblePanel } from "./BiblePanel";
import { PublishPanel } from "./PublishPanel";
import { fetchJson, useApi } from "../../hooks/use-api";
import type { AiAction, AiGateResult } from "../../lib/ai-gate";
import type { BookDetail, ChapterSummary } from "../../shared/contracts";
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

interface CandidatesResponse {
  readonly candidates: ReadonlyArray<GeneratedChapterCandidate>;
}

export interface WorkspaceChapterApi {
  readonly loadChapter: (bookId: string, chapterNumber: number) => Promise<{ readonly content: string }>;
  readonly saveChapter: (bookId: string, chapterNumber: number, content: string) => Promise<void>;
}

export type CandidateAcceptAction = "merge" | "replace" | "draft";

export interface WorkspaceCandidateApi {
  readonly acceptCandidate: (bookId: string, candidateId: string, action: CandidateAcceptAction) => Promise<void>;
  readonly rejectCandidate: (bookId: string, candidateId: string) => Promise<void>;
}

export type WorkspaceAssistantActionId = "write-next" | "continue" | "audit" | "rewrite" | "de-ai" | "continuity";

export interface WorkspaceAssistantContext {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly selectedNodeId: string;
  readonly selectedNodeTitle: string;
}

export interface WorkspaceAssistantApi {
  readonly runAction: (action: WorkspaceAssistantActionId, context: WorkspaceAssistantContext) => Promise<{ readonly message: string }>;
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
  acceptCandidate: async (bookId, candidateId, action) => {
    await fetchJson(`/books/${bookId}/candidates/${candidateId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  },
  rejectCandidate: async (bookId, candidateId) => {
    await fetchJson(`/books/${bookId}/candidates/${candidateId}/reject`, { method: "POST" });
  },
};

const DEFAULT_ASSISTANT_API: WorkspaceAssistantApi = {
  runAction: async (action, context) => {
    if (action === "write-next") {
      await fetchJson(`/books/${context.bookId}/write-next`, { method: "POST" });
      return { message: "AI 输出已进入生成章节候选" };
    }
    throw new Error("此功能即将推出");
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
  const { data: bookDetail } = useApi<BookDetailResponse>(activeBookId ? `/books/${activeBookId}` : null);
  const { data: candidatesData } = useApi<CandidatesResponse>(activeBookId ? `/books/${activeBookId}/candidates` : null);

  /* ── build resource tree from real data or fallback ── */
  const treeInput: StudioResourceTreeInput = useMemo(() => {
    if (!bookDetail?.book) return {
      book: {
        id: "", title: "加载中...", status: "active", platform: "other", genre: "",
        targetChapters: 0, chapters: 0, chapterCount: 0, lastChapterNumber: 0,
        totalWords: 0, approvedChapters: 0, pendingReview: 0, pendingReviewChapters: 0,
        failedReview: 0, failedChapters: 0, updatedAt: "", createdAt: "", chapterWordCount: 0, language: null,
      },
      chapters: [], generatedChapters: [], drafts: [], bibleCounts: {},
    };
    const b = bookDetail.book;
    const chs = bookDetail.chapters ?? [];
    const book: BookDetail = {
      id: b.id, title: b.title, status: b.status ?? "active", platform: (b.platform ?? "other") as BookDetail["platform"],
      genre: b.genre ?? "", targetChapters: b.targetChapters ?? 100,
      chapters: chs.length, chapterCount: chs.length, lastChapterNumber: chs.length,
      totalWords: chs.reduce((s, c) => s + (c.wordCount ?? 0), 0),
      approvedChapters: chs.filter((c) => c.status === "approved").length,
      pendingReview: chs.filter((c) => c.status === "ready-for-review").length,
      pendingReviewChapters: chs.filter((c) => c.status === "ready-for-review").length,
      failedReview: 0, failedChapters: 0,
      updatedAt: b.updatedAt ?? "", createdAt: b.createdAt ?? "",
      chapterWordCount: b.chapterWordCount ?? 3000, language: (b.language ?? "zh") as "zh" | "en",
    };
    const chapters: ChapterSummary[] = chs.map((c) => ({
      number: c.number, title: c.title ?? `第${c.number}章`, status: c.status ?? "draft",
      wordCount: c.wordCount ?? 0, auditIssueCount: 0, updatedAt: "", fileName: c.fileName ?? null,
    }));
    const candidates = (candidatesData?.candidates ?? []).filter((c) => c.status === "candidate");
    return { book, chapters, generatedChapters: candidates, drafts: [], bibleCounts: {} };
  }, [bookDetail, candidatesData]);

  const tree = useMemo(() => buildStudioResourceTree(treeInput), [treeInput]);
  const defaultNodeId = tree[0]?.children?.[0]?.children?.[0]?.children?.[0]?.id ?? tree[0]?.children?.[0]?.children?.[0]?.id ?? tree[0]?.id ?? "";
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const activeNodeId = selectedNodeId ?? defaultNodeId;
  const selectedNode = findNode(tree, activeNodeId) ?? tree[0]!;

  return (
    <SectionLayout title="创作工作台" description="">
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={`rounded border px-2 py-0.5 text-xs hover:bg-muted ${showPublishPanel ? "border-primary bg-primary/10 text-primary" : "border-border"}`} onClick={() => setShowPublishPanel(!showPublishPanel)} type="button">发布就绪</button>
          <button disabled className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50" title="即将推出" type="button">预设管理</button>
        </div>
      </div>

      <ResourceWorkspaceLayout
        explorer={<ResourceTree nodes={tree} selectedNodeId={selectedNode.id} onSelect={(id) => { setSelectedNodeId(id); setShowPublishPanel(false); }} />}
        editor={showPublishPanel && activeBookId ? <PublishPanel bookId={activeBookId} /> : <WorkspaceEditor candidateApi={candidateApi} chapterApi={chapterApi} node={selectedNode} />}
        assistant={<AssistantPanel assistantApi={assistantApi} modelGate={effectiveModelGate} selectedNode={selectedNode} />}
      />
    </SectionLayout>
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
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
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
}: {
  readonly candidateApi: WorkspaceCandidateApi;
  readonly chapterApi: WorkspaceChapterApi;
  readonly node: StudioResourceNode;
}) {
  if (node.kind === "generated-chapter") {
    return <CandidateEditor candidateApi={candidateApi} node={node} />;
  }

  if (node.kind === "chapter") {
    return <ChapterEditor chapterApi={chapterApi} node={node} />;
  }

  if (node.kind === "bible-category") {
    return (
      <div className="space-y-4">
        <EditorHeader title={node.title} meta="经纬资料详情" />
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          {node.title}：{node.count ?? 0} 项
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EditorHeader title={node.title} meta={node.status ?? node.kind} />
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        选择左侧内容开始编辑
      </div>
    </div>
  );
}

function CandidateEditor({ candidateApi, node }: { readonly candidateApi: WorkspaceCandidateApi; readonly node: StudioResourceNode }) {
  const [pendingAction, setPendingAction] = useState<"merge" | "replace" | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const bookId = typeof node.metadata?.bookId === "string" ? node.metadata.bookId : "";
  const candidateId = node.id.replace(/^generated:/, "");
  const targetChapterId = typeof node.metadata?.targetChapterId === "string" ? node.metadata.targetChapterId : "未指定";

  const accept = async (action: CandidateAcceptAction) => {
    setActionError(null);
    await candidateApi.acceptCandidate(bookId, candidateId, action);
    setPendingAction(null);
    setResultMessage(action === "merge" ? "候选稿已合并到正式章节" : action === "replace" ? "候选稿已替换正式章节" : "候选稿已另存为草稿");
  };

  const reject = async () => {
    setActionError(null);
    await candidateApi.rejectCandidate(bookId, candidateId);
    setResultMessage("候选稿已放弃");
  };

  const runAction = (operation: () => Promise<void>) => {
    operation().catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)));
  };

  return (
    <div className="space-y-4">
      <EditorHeader title={node.title} meta="候选稿 / 不会自动覆盖正式正文" />
      {resultMessage && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">{resultMessage}</div>}
      {actionError && <InlineError message={`候选稿操作失败：${actionError}`} />}
      {pendingAction && (
        <div className="rounded-lg border border-border bg-background p-4 text-sm">
          <h3 className="font-semibold">确认{pendingAction === "merge" ? "合并" : "替换"}到正式章节</h3>
          <p className="mt-2">目标章节：{targetChapterId}</p>
          <p className="mt-1 text-muted-foreground">
            影响范围：{pendingAction === "merge" ? "追加到正式章节末尾，保留原正文。" : "用候选稿替换目标正式章节正文。"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => runAction(() => accept(pendingAction))} type="button">
              {pendingAction === "merge" ? "确认合并" : "确认替换"}
            </button>
            <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setPendingAction(null)} type="button">取消</button>
          </div>
        </div>
      )}
      <textarea aria-label="章节正文" className="min-h-[22rem] w-full resize-none rounded-lg border border-border bg-background p-4 leading-7" defaultValue="" />
      <div className="flex flex-wrap gap-2">
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setPendingAction("merge")} type="button">合并到正式章节</button>
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setPendingAction("replace")} type="button">替换正式章节</button>
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => runAction(() => accept("draft"))} type="button">另存为草稿</button>
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => runAction(reject)} type="button">放弃候选稿</button>
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
}: {
  readonly assistantApi: WorkspaceAssistantApi;
  readonly modelGate: WorkspaceModelGate;
  readonly selectedNode: StudioResourceNode;
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
      .then((result) => setActionMessage(result.message))
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
      <WritingModesPanel selectedNode={selectedNode} />
      <WritingToolsPanel selectedNode={selectedNode} />
    </div>
  );
}

function WritingModesPanel({ selectedNode }: { readonly selectedNode: StudioResourceNode }) {
  const [open, setOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<"inline" | "dialogue-gen" | "variants" | "outline">("inline");

  const bookId = typeof selectedNode.metadata?.bookId === "string" ? selectedNode.metadata.bookId : "";
  const chapterNumber = typeof selectedNode.metadata?.chapterNumber === "number" ? selectedNode.metadata.chapterNumber : 1;
  const isChapterContext = selectedNode.kind === "chapter" || selectedNode.kind === "generated-chapter";

  const noop = () => { /* placeholder */ };

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
                <button className={`rounded-lg px-2 py-1 text-xs ${activeMode === "inline" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveMode("inline")} type="button">续写/扩写/补写</button>
                <button className={`rounded-lg px-2 py-1 text-xs ${activeMode === "dialogue-gen" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveMode("dialogue-gen")} type="button">对话生成</button>
                <button className={`rounded-lg px-2 py-1 text-xs ${activeMode === "variants" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveMode("variants")} type="button">多版本</button>
              </>
            )}
            <button className={`rounded-lg px-2 py-1 text-xs ${activeMode === "outline" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveMode("outline")} type="button">大纲分支</button>
          </div>

          {isChapterContext && activeMode === "inline" && (
            <InlineWritePanel bookId={bookId} chapterNumber={chapterNumber} selectedText="" onAccept={noop} onDiscard={noop} />
          )}
          {isChapterContext && activeMode === "dialogue-gen" && (
            <DialogueGenerator bookId={bookId} chapterNumber={chapterNumber} onInsert={noop} />
          )}
          {isChapterContext && activeMode === "variants" && (
            <VariantCompare bookId={bookId} chapterNumber={chapterNumber} selectedText="" onAccept={noop} />
          )}
          {activeMode === "outline" && (
            <OutlineBrancher bookId={bookId} onSelectBranch={noop} />
          )}

          {!isChapterContext && activeMode !== "outline" && (
            <p className="text-xs text-muted-foreground">请选择一个章节以使用写作模式工具。</p>
          )}
        </div>
      )}
    </div>
  );
}

function WritingToolsPanel({ selectedNode }: { readonly selectedNode: StudioResourceNode }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"rhythm" | "dialogue" | "hooks" | "progress" | "health" | "conflicts" | "arcs" | "tone">("rhythm");
  const [rhythmAnalysis, setRhythmAnalysis] = useState<RhythmChartAnalysis | null>(null);
  const [dialogueAnalysis, setDialogueAnalysis] = useState<DialogueAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

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

  const handleApplyHook = (_hook: GeneratedHookOption) => {
    // Hook applied — future: append to chapter content
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
                <button className={`rounded-lg px-2 py-1 text-xs ${activeTab === "rhythm" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveTab("rhythm")} type="button">节奏分析</button>
                <button className={`rounded-lg px-2 py-1 text-xs ${activeTab === "dialogue" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveTab("dialogue")} type="button">对话分析</button>
                <button className={`rounded-lg px-2 py-1 text-xs ${activeTab === "hooks" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveTab("hooks")} type="button">钩子生成</button>
              </>
            )}
            <button className={`rounded-lg px-2 py-1 text-xs ${activeTab === "progress" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveTab("progress")} type="button">日更进度</button>
            <button className={`rounded-lg px-2 py-1 text-xs ${activeTab === "health" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveTab("health")} type="button">全书健康</button>
            <button className={`rounded-lg px-2 py-1 text-xs ${activeTab === "conflicts" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveTab("conflicts")} type="button">矛盾地图</button>
            <button className={`rounded-lg px-2 py-1 text-xs ${activeTab === "arcs" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveTab("arcs")} type="button">角色弧线</button>
            {isChapterContext && (
              <button className={`rounded-lg px-2 py-1 text-xs ${activeTab === "tone" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setActiveTab("tone")} type="button">文风守护</button>
            )}
          </div>

          {isChapterContext && activeTab === "rhythm" && (
            <div className="space-y-2">
              {!rhythmAnalysis && !analysisLoading && (
                <button className="w-full rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => void loadAnalysis()} type="button">
                  运行节奏 + 对话分析
                </button>
              )}
              {analysisLoading && <p className="text-xs text-muted-foreground">正在分析...</p>}
              {analysisError && <p className="text-xs text-destructive">分析失败：{analysisError}</p>}
              {rhythmAnalysis && <RhythmChart analysis={rhythmAnalysis} />}
            </div>
          )}

          {isChapterContext && activeTab === "dialogue" && (
            <div className="space-y-2">
              {!dialogueAnalysis && !analysisLoading && (
                <button className="w-full rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => void loadAnalysis()} type="button">
                  运行节奏 + 对话分析
                </button>
              )}
              {analysisLoading && <p className="text-xs text-muted-foreground">正在分析...</p>}
              {analysisError && <p className="text-xs text-destructive">分析失败：{analysisError}</p>}
              {dialogueAnalysis && <DialogueAnalysis analysis={dialogueAnalysis} />}
            </div>
          )}

          {isChapterContext && activeTab === "hooks" && chapterNumber !== undefined && (
            <ChapterHookGenerator bookId={bookId} chapterNumber={chapterNumber} chapterContent="" onApplyHook={handleApplyHook} applyDisabled />
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
