/**
 * useStudioData — 工作台数据中心
 *
 * 对标 Claude Code REPL.tsx 的数据中心模式：
 * 顶层组件持有所有数据，通过 props/context 分发给子面板。
 *
 * 从 WorkspacePage 提取的数据获取逻辑。
 */

import { useEffect, useMemo, useState } from "react";

import { useApi } from "../../hooks/use-api";
import { appStore } from "../../stores/app-store";
import {
  buildStudioResourceTree,
  type StudioResourceNode,
  type StudioResourceTreeInput,
} from "../workspace/resource-adapter";
import { normalizeBookStatus, normalizeChapterStatus } from "../../../../core/src/models/status";
import type { BookDetail, ChapterSummary, DraftResource, GeneratedChapterCandidate, TextFileResource } from "../../shared/contracts";
import type { NarratorSessionRecord } from "../../shared/session-types";

/* ------------------------------------------------------------------ */
/*  API response types (from WorkspacePage)                            */
/* ------------------------------------------------------------------ */

export interface BookListItem {
  readonly id: string;
  readonly title: string;
  readonly status?: string;
  readonly totalChapters?: number;
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

interface WorkspaceTextFileListResponse {
  readonly files: ReadonlyArray<{ readonly name: string; readonly size: number; readonly preview: string }>;
}

/* ------------------------------------------------------------------ */
/*  Hook return type                                                   */
/* ------------------------------------------------------------------ */

export interface StudioData {
  /** 书籍列表 */
  readonly books: readonly BookListItem[];
  /** 当前选中的书籍 ID */
  readonly activeBookId: string | null;
  /** 切换书籍 */
  readonly setActiveBookId: (id: string) => void;
  /** 当前书籍详情 */
  readonly bookDetail: BookDetailResponse | null;
  /** 候选稿列表 */
  readonly candidates: readonly GeneratedChapterCandidate[];
  /** 草稿列表 */
  readonly drafts: readonly DraftResource[];
  /** 故事文件列表 */
  readonly storyFiles: readonly { readonly name: string; readonly size: number; readonly preview: string }[];
  /** 真相文件列表 */
  readonly truthFiles: readonly { readonly name: string; readonly size: number; readonly preview: string }[];
  /** 完整资源树 */
  readonly resourceNodes: readonly StudioResourceNode[];
  /** 会话列表 */
  readonly sessions: readonly NarratorSessionRecord[];
  /** 当前选中的会话 ID */
  readonly activeSessionId: string | null;
  /** 切换会话 */
  readonly setActiveSessionId: (id: string | null) => void;
  /** 刷新资源 */
  readonly refreshResources: (target?: string) => Promise<void>;
  /** 数据加载中 */
  readonly loading: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helper: normalize chapter                                          */
/* ------------------------------------------------------------------ */

function normalizeChapter(chapter: {
  readonly number: number;
  readonly title?: string;
  readonly status?: string;
  readonly wordCount?: number;
  readonly fileName?: string;
}): ChapterSummary {
  return {
    number: chapter.number,
    title: chapter.title ?? `第${chapter.number}章`,
    status: normalizeChapterStatus(chapter.status),
    wordCount: chapter.wordCount ?? 0,
    auditIssueCount: 0,
    updatedAt: "",
    fileName: chapter.fileName ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useStudioData(): StudioData {
  // --- Books ---
  const { data: booksData, loading: booksLoading } = useApi<{ books: BookListItem[] }>("/books");
  const books = booksData?.books ?? [];
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const activeBookId = selectedBookId ?? books[0]?.id ?? null;

  // Sync to global appStore
  useEffect(() => {
    appStore.setState((prev) => {
      if (prev.activeBookId === activeBookId) return prev;
      return { ...prev, activeBookId };
    });
  }, [activeBookId]);

  // --- Book detail + resources ---
  const { data: bookDetail, refetch: refetchBookDetail } = useApi<BookDetailResponse>(activeBookId ? `/books/${activeBookId}` : null);
  const { data: candidatesData, refetch: refetchCandidates } = useApi<CandidatesResponse>(activeBookId ? `/books/${activeBookId}/candidates` : null);
  const { data: draftsData, refetch: refetchDrafts } = useApi<{ drafts: DraftResource[] }>(activeBookId ? `/books/${activeBookId}/drafts` : null);
  const { data: storyFilesData, refetch: refetchStoryFiles } = useApi<WorkspaceTextFileListResponse>(activeBookId ? `/books/${activeBookId}/story-files` : null);
  const { data: truthFilesData, refetch: refetchTruthFiles } = useApi<WorkspaceTextFileListResponse>(activeBookId ? `/books/${activeBookId}/truth-files` : null);

  // --- Sessions ---
  const { data: sessionsData } = useApi<{ sessions: NarratorSessionRecord[] }>("/sessions?sort=recent&status=active");
  const sessions = sessionsData?.sessions ?? [];
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // --- Build resource tree ---
  const resourceNodes: readonly StudioResourceNode[] = useMemo(() => {
    if (!bookDetail?.book || !activeBookId) return [];

    const b = bookDetail.book;
    const chs = bookDetail.chapters ?? [];
    const chapters = chs.map(normalizeChapter).sort((a, b) => a.number - b.number);
    const candidates = (candidatesData?.candidates ?? []).filter((c) => c.status === "candidate");
    const drafts = draftsData?.drafts ?? [];
    const storyFiles = storyFilesData?.files ?? [];
    const truthFiles = truthFilesData?.files ?? [];

    const book: BookDetail = {
      id: b.id,
      title: b.title,
      status: normalizeBookStatus(b.status),
      platform: (b.platform ?? "other") as BookDetail["platform"],
      genre: b.genre ?? "",
      targetChapters: b.targetChapters ?? 100,
      chapters: chapters.length,
      chapterCount: chapters.length,
      lastChapterNumber: Math.max(0, ...chapters.map((c) => c.number)),
      totalWords: chapters.reduce((s, c) => s + (c.wordCount ?? 0), 0),
      approvedChapters: chapters.filter((c) => c.status === "approved").length,
      pendingReview: chapters.filter((c) => c.status === "ready-for-review").length,
      pendingReviewChapters: chapters.filter((c) => c.status === "ready-for-review").length,
      failedReview: 0,
      failedChapters: 0,
      updatedAt: b.updatedAt ?? "",
      createdAt: b.createdAt ?? "",
      chapterWordCount: b.chapterWordCount ?? 3000,
      language: (b.language ?? "zh") as "zh" | "en",
    };

    const treeInput: StudioResourceTreeInput = {
      book,
      chapters,
      generatedChapters: candidates,
      drafts,
      bibleCounts: {},
      bibleEntries: [],
      storyFiles: storyFiles.map((f): TextFileResource => ({ id: f.name, title: f.name, path: `story/${f.name}` })),
      truthFiles: truthFiles.map((f): TextFileResource => ({ id: f.name, title: f.name, path: `truth/${f.name}` })),
      materials: [],
      publishReports: [],
    };

    return buildStudioResourceTree(treeInput);
  }, [activeBookId, bookDetail, candidatesData, draftsData, storyFilesData, truthFilesData]);

  // --- Refresh ---
  const refreshResources = async (target = "all") => {
    const refreshers: Promise<unknown>[] = [];
    if (target === "all" || target === "chapters") refreshers.push(refetchBookDetail());
    if (target === "all" || target === "candidates") refreshers.push(refetchCandidates());
    if (target === "all" || target === "drafts") refreshers.push(refetchDrafts());
    if (target === "all" || target === "story-files") refreshers.push(refetchStoryFiles());
    if (target === "all") refreshers.push(refetchTruthFiles());
    await Promise.all(refreshers);
  };

  return {
    books,
    activeBookId,
    setActiveBookId: setSelectedBookId,
    bookDetail: bookDetail ?? null,
    candidates: candidatesData?.candidates ?? [],
    drafts: draftsData?.drafts ?? [],
    storyFiles: storyFilesData?.files ?? [],
    truthFiles: truthFilesData?.files ?? [],
    resourceNodes,
    sessions,
    activeSessionId,
    setActiveSessionId,
    refreshResources,
    loading: booksLoading,
  };
}
