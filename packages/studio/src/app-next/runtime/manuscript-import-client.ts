/**
 * 旧稿导入（T4.2）的前端请求封装。书根只由服务端可信绑定解析；这里只传书 ID、任务 ID 与上传的文件。
 */
import { runtimeFetch } from "./auth";

export interface ManuscriptExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

export interface ManuscriptPreviewChapter {
  readonly index: number;
  readonly title: string;
  readonly chars: number;
  readonly lineCount: number;
  readonly head: string;
  readonly tail: string;
  readonly sourceFile?: string;
  readonly anomalies: readonly { readonly code: string; readonly message: string }[];
}

export interface ManuscriptImportJobChapter {
  readonly index: number;
  readonly chapterNumber: number;
  readonly title: string;
  readonly written: boolean;
  readonly settle: {
    readonly status: "pending" | "running" | "done" | "skipped" | "failed";
    readonly attempts: number;
    readonly extracted?: number;
    readonly pending?: number;
    readonly highRiskPending?: number;
    readonly summary?: string;
  };
}

export interface ManuscriptImportReport {
  readonly chapterCount: number;
  readonly settledChapters: number;
  readonly unsettledChapters: readonly number[];
  readonly failedChapters: readonly { readonly chapterNumber: number; readonly title: string; readonly reason: string }[];
  readonly eventCount: number;
  readonly pendingEventCount: number;
  readonly highRiskPendingCount: number;
  readonly pendingReviewTotal: number;
  readonly entityCount: number;
  readonly relationCount: number;
  readonly foreshadow: { readonly total: number; readonly byPhase: Readonly<Record<string, number>> };
  readonly storylines: readonly { readonly id: string; readonly name: string; readonly kind: string }[];
  /** 从正文统计起草、仍待作者确认的人物草稿；旧任务没有这一项。 */
  readonly characterDrafts?: {
    readonly pending: number;
    readonly stagedThisRun: number;
    readonly threshold: number;
    readonly items: readonly { readonly entryId: string; readonly title: string; readonly firstChapter?: number; readonly occurrences?: number }[];
    readonly explanation: ManuscriptExplanation;
  };
  readonly warnings: readonly string[];
}

export interface ManuscriptImportView {
  readonly job: {
    readonly jobId: string;
    readonly bookId: string;
    readonly sourceName: string;
    readonly phase: "preview" | "writing" | "written" | "published";
    readonly split: { readonly mode: "rule" | "by-file"; readonly pattern?: string };
    readonly planRevision: number;
    readonly source: { readonly kind: "text" | "files"; readonly sha256: string; readonly bytes: number; readonly charCount: number; readonly files: readonly { readonly name: string; readonly encoding: string }[] };
    readonly chapters: readonly ManuscriptImportJobChapter[];
    readonly settlement: { readonly state: "idle" | "running" | "paused" | "blocked" | "done"; readonly explanation?: ManuscriptExplanation };
    readonly report?: ManuscriptImportReport;
  };
  readonly preview?: {
    readonly revision: number;
    readonly chapterCount: number;
    readonly totalChars: number;
    readonly chapters: readonly ManuscriptPreviewChapter[];
    readonly warnings: readonly string[];
  };
  readonly progress: { readonly total: number; readonly written: number; readonly settled: number; readonly failed: number; readonly pending: number };
  readonly running: boolean;
}

export type ManuscriptPlanEdit =
  | { readonly op: "rename"; readonly index: number; readonly title: string }
  | { readonly op: "merge"; readonly index: number }
  | { readonly op: "split"; readonly index: number; readonly atLine: number; readonly title?: string };

/** 接口错误：带服务端给的三段式说明，界面直接展示，不按 code 自造文案。 */
export class ManuscriptImportRequestError extends Error {
  constructor(message: string, readonly status: number, readonly explanation?: ManuscriptExplanation) {
    super(message);
    this.name = "ManuscriptImportRequestError";
  }
}

function base(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/manuscript-import`;
}

async function parse<T>(response: Response, acceptStatuses: readonly number[] = []): Promise<T> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (response.ok || acceptStatuses.includes(response.status)) return payload as T;
  const explanation = payload?.explanation as ManuscriptExplanation | undefined;
  const error = payload?.error as { message?: string } | string | undefined;
  const message = explanation?.whatHappened ?? (typeof error === "string" ? error : error?.message) ?? `请求失败（${response.status}）`;
  throw new ManuscriptImportRequestError(message, response.status, explanation);
}

async function postJson<T>(path: string, body: unknown, acceptStatuses: readonly number[] = []): Promise<T> {
  return parse<T>(await runtimeFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), acceptStatuses);
}

export interface ManuscriptImportClient {
  readonly start: (bookId: string, input: { readonly sourceName: string; readonly files: readonly File[]; readonly splitPattern?: string }) => Promise<ManuscriptImportView>;
  readonly read: (bookId: string, jobId: string) => Promise<ManuscriptImportView>;
  readonly readChapterLines: (bookId: string, jobId: string, index: number) => Promise<{ readonly lines: readonly string[]; readonly revision: number }>;
  readonly resplit: (bookId: string, jobId: string, split: { readonly mode: "rule" | "by-file"; readonly pattern?: string }) => Promise<ManuscriptImportView>;
  readonly edit: (bookId: string, jobId: string, expectedRevision: number, edit: ManuscriptPlanEdit) => Promise<ManuscriptImportView>;
  readonly confirm: (bookId: string, jobId: string, expectedRevision: number) => Promise<ManuscriptImportView>;
  /** 继续逐章事实；没有模型时服务端返回 422 与更新后的任务（停在这一步的原因）。 */
  readonly settle: (bookId: string, jobId: string, retryFailed?: boolean) => Promise<ManuscriptImportView>;
  readonly synthesize: (bookId: string, jobId: string) => Promise<ManuscriptImportView>;
  readonly publish: (bookId: string, jobId: string) => Promise<ManuscriptImportView>;
}

export function createManuscriptImportClient(): ManuscriptImportClient {
  return {
    start: async (bookId, input) => {
      const form = new FormData();
      form.set("sourceName", input.sourceName);
      if (input.splitPattern?.trim()) form.set("splitPattern", input.splitPattern.trim());
      for (const file of input.files) {
        // 文件夹选择时用相对路径作文件名，服务端据此排序与按文件切章。
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        form.append("files", file, relative || file.name);
      }
      return parse(await runtimeFetch(`${base(bookId)}/jobs`, { method: "POST", body: form }));
    },
    read: async (bookId, jobId) => parse(await runtimeFetch(`${base(bookId)}/jobs/${encodeURIComponent(jobId)}`)),
    readChapterLines: async (bookId, jobId, index) =>
      parse(await runtimeFetch(`${base(bookId)}/jobs/${encodeURIComponent(jobId)}/plan/chapters/${index}`)),
    resplit: (bookId, jobId, split) => postJson(`${base(bookId)}/jobs/${encodeURIComponent(jobId)}/resplit`, split),
    edit: (bookId, jobId, expectedRevision, edit) =>
      postJson(`${base(bookId)}/jobs/${encodeURIComponent(jobId)}/plan-edits`, { expectedRevision, edit }),
    confirm: (bookId, jobId, expectedRevision) =>
      postJson(`${base(bookId)}/jobs/${encodeURIComponent(jobId)}/confirm`, { expectedRevision }),
    settle: (bookId, jobId, retryFailed = false) =>
      postJson(`${base(bookId)}/jobs/${encodeURIComponent(jobId)}/settle`, { retryFailed }, [422]),
    synthesize: (bookId, jobId) => postJson(`${base(bookId)}/jobs/${encodeURIComponent(jobId)}/synthesize`, {}),
    publish: (bookId, jobId) => postJson(`${base(bookId)}/jobs/${encodeURIComponent(jobId)}/publish`, {}),
  };
}
