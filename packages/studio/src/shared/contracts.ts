/**
 * Shared TypeScript contracts for Studio API/UI communication.
 * Ported from PR #96 (Te9ui1a) — prevents client/server type drift.
 */

import type { BibleEntryStatus, CanonicalBookStatus, CanonicalChapterStatus, CandidateStatus } from "@vivy1024/novelfork-core";

// --- Health ---

export interface HealthStatus {
  readonly status: "ok";
  readonly projectRoot: string;
  readonly projectConfigFound: boolean;
  readonly envFound: boolean;
  readonly projectEnvFound: boolean;
  readonly globalConfigFound: boolean;
  readonly bookCount: number;
  readonly provider: string | null;
  readonly model: string | null;
}

// --- Books ---

export interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly status: CanonicalBookStatus;
  readonly platform: string;
  readonly genre: string;
  readonly targetChapters: number;
  readonly chapters: number;
  readonly chapterCount: number;
  readonly lastChapterNumber: number;
  readonly totalWords: number;
  readonly approvedChapters: number;
  readonly pendingReview: number;
  readonly pendingReviewChapters: number;
  readonly failedReview: number;
  readonly failedChapters: number;
  readonly recentRunStatus?: string | null;
  readonly updatedAt: string;
}

export interface BookDetail extends BookSummary {
  readonly createdAt: string;
  readonly chapterWordCount: number;
  readonly language: "zh" | "en" | null;
}

export interface BookListResponse {
  readonly books: readonly BookSummary[];
}

export interface BookDetailResponse {
  readonly book: BookDetail;
  readonly chapters: readonly ChapterSummary[];
  readonly nextChapter: number;
}

// --- Chapters ---

export interface ChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly status: CanonicalChapterStatus;
  readonly wordCount: number;
  readonly auditIssueCount: number;
  readonly updatedAt: string;
  readonly fileName: string | null;
}

export interface ChapterDetail extends ChapterSummary {
  readonly auditIssues: ReadonlyArray<string>;
  readonly reviewNote?: string;
  readonly detectionScore?: number;
  readonly detectionProvider?: string;
  readonly lengthTelemetry?: {
    readonly target: number;
    readonly actual: number;
    readonly delta: number;
  };
  readonly tokenUsage?: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  };
  readonly lengthWarnings?: ReadonlyArray<string>;
  readonly content: string;
}

export interface ChapterContentResponse {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

export interface SaveChapterResponse {
  readonly ok: true;
  readonly chapterNumber: number;
}

export interface SaveChapterPayload {
  readonly content: string;
}

export interface CreateChapterPayload {
  readonly title?: string;
  readonly afterChapterNumber?: number;
}

export interface CreateChapterResponse {
  readonly chapter: ChapterSummary;
}

// --- Truth Files ---

export interface TruthFileSummary {
  readonly name: string;
  readonly label: string;
  readonly exists: boolean;
  readonly path: string;
  readonly optional: boolean;
  readonly available: boolean;
}

export interface TruthFileDetail extends TruthFileSummary {
  readonly content: string | null;
}

// --- Workspace Resource Snapshot ---

export interface AiResultMetadata {
  readonly provider?: string;
  readonly model?: string;
  readonly runId?: string;
  readonly requestId?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly finishReason?: string;
  readonly timestamp?: string;
  readonly [key: string]: unknown;
}

export interface GeneratedChapterCandidate {
  readonly id: string;
  readonly bookId: string;
  readonly targetChapterId?: string;
  readonly title: string;
  readonly source: string;
  readonly createdAt: string;
  readonly status: CandidateStatus;
  readonly metadata?: AiResultMetadata;
  readonly content?: string | null;
  readonly contentError?: string;
}

export interface DraftResource {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly content: string;
  readonly updatedAt: string;
  readonly wordCount: number;
  readonly metadata?: AiResultMetadata;
}

export interface BibleResourceCounts {
  readonly characters?: number;
  readonly locations?: number;
  readonly factions?: number;
  readonly items?: number;
  readonly foreshadowing?: number;
  readonly worldRules?: number;
}

export interface BibleEntryResource {
  readonly id: string;
  readonly category: keyof BibleResourceCounts;
  readonly title: string;
  readonly summary?: string;
  readonly status?: BibleEntryStatus;
}

export interface TextFileResource {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly fileType?: "markdown" | "text";
}

export interface MaterialResource {
  readonly id: string;
  readonly title: string;
  readonly source?: string;
  readonly updatedAt?: string;
  readonly path?: string;
  readonly fileType?: "markdown" | "text";
  readonly content?: string | null;
}

export interface PublishReportResource {
  readonly id: string;
  readonly title: string;
  readonly channel?: string;
  readonly updatedAt?: string;
  readonly status?: string;
  readonly content?: string;
}

export interface WorkspaceResourceSnapshot {
  readonly book: BookDetail;
  readonly chapters: readonly ChapterSummary[];
  readonly generatedChapters?: readonly GeneratedChapterCandidate[];
  readonly drafts?: readonly DraftResource[];
  readonly bibleCounts?: BibleResourceCounts;
  readonly bibleEntries?: readonly BibleEntryResource[];
  readonly storyFiles?: readonly TextFileResource[];
  readonly truthFiles?: readonly TextFileResource[];
  readonly materials?: readonly MaterialResource[];
  readonly publishReports?: readonly PublishReportResource[];
}

// --- Review ---

export interface ReviewActionPayload {
  readonly chapterNumber: number;
  readonly reason?: string;
}

// --- Runs ---

export type RunAction = "draft" | "audit" | "revise" | "write-next" | "tool";

export type RunStatus = "queued" | "running" | "succeeded" | "failed";

export interface RunLogEntry {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export interface RunActionPayload {
  readonly chapterNumber?: number;
}

export interface StudioRun {
  readonly id: string;
  readonly bookId: string;
  readonly chapter: number | null;
  readonly chapterNumber: number | null;
  readonly action: RunAction;
  readonly status: RunStatus;
  readonly stage: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly logs: ReadonlyArray<RunLogEntry>;
  readonly result?: unknown;
  readonly error?: string;
}

export interface RunStreamEvent {
  readonly type: "snapshot" | "status" | "stage" | "log";
  readonly runId: string;
  readonly seq?: number;
  readonly run?: StudioRun;
  readonly runs?: ReadonlyArray<StudioRun>;
  readonly status?: RunStatus;
  readonly stage?: string;
  readonly log?: RunLogEntry;
  readonly result?: unknown;
  readonly error?: string;
}

export interface RunHistoryCursor {
  readonly lastSeq: number;
}

export interface RunHistory {
  readonly runId: string;
  readonly sinceSeq: number;
  readonly availableFromSeq: number;
  readonly resetRequired: boolean;
  readonly events: ReadonlyArray<RunStreamEvent>;
  readonly cursor: RunHistoryCursor;
}

// --- API Error Response ---

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}
