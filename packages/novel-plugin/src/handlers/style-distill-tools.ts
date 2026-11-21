import { basename, resolve } from "node:path";
import type { RuntimeTextGenerator, RuntimeToolResult, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";
import {
  BookTextFileError,
  buildMechanicalBookIndex,
  listWorkspaceReferenceFiles,
  readBookTextFile,
} from "../engine/writing-layers/source-file-index.js";
import {
  makePreviewSource,
  normalizeStyleDistillationSource,
  resolveStyleDistillationInput,
  settleStyleDistillationJobState,
  StyleDistillationError,
  STYLE_RULE_CATEGORY_LABELS,
  type StyleDistillationJob,
  type StyleDistillationSourceInput,
} from "../engine/writing-layers/style-distillation.js";
import {
  adoptStyleDistillation,
  createStyleDistillationJob,
  hasLiveStyleDistillationRunner,
  isAllRejectedBatch,
  readStyleDistillationJob,
  recommendedStyleDistillationRuleIds,
  runStyleDistillationBatches,
  summarizeStyleDistillationBatches,
} from "../engine/writing-layers/style-distillation-runner.js";
import { estimateStyleDistillationRun } from "../engine/writing-layers/style-distillation-model.js";
import { loadStylePreset, StylePresetError } from "../engine/writing-layers/style-preset-store.js";
import type { TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

export const STYLE_DISTILL_TOOL_NAMES = [
  "style.distill_index",
  "style.distill_preview",
  "style.distill_start",
  "style.distill_status",
  "style.distill_adopt",
] as const;

/** status 的 waitSeconds 上限：一次查询最多等这么久，避免单次工具调用长时间占住会话。 */
export const STYLE_DISTILL_STATUS_MAX_WAIT_SECONDS = 60;
/** status 返回的待审条目每页默认条数与上限（规则、范文各自分页）。 */
export const STYLE_DISTILL_REVIEW_PAGE_DEFAULT = 30;
export const STYLE_DISTILL_REVIEW_PAGE_MAX = 100;
const EVIDENCE_PREVIEW_CHARS = 120;
const SAMPLE_PREVIEW_CHARS = 120;
const STATUS_POLL_MS = 1_000;

/**
 * 叙述者工具的后台批次用的是本会话的 generateText：Runtime 在会话本轮结束（或作者中断）时
 * 取消本轮全部资源，进行中的模型调用随之中止。运行器把进行中的批次退回待处理，这里给出停下原因。
 */
const SESSION_ENDED_EXPLANATION: Explanation = {
  what: "叙述者会话本轮已结束或被中断，后台模型批次随之暂停；进行中的批次已退回待处理，已完成批次的结果都保留。",
  why: "叙述者发起的后台批次使用本会话的模型调用，会话本轮结束时宿主会取消这些调用。",
  next: "在叙述者对话中再次调用 style_manage（action=start）并带上该任务的 jobId 继续；或在文风蒸馏页面点「继续未完成批次」，由服务端模型在后台跑完。",
};

interface Explanation { readonly what: string; readonly why: string; readonly next: string }

function fail(error: string, summary: string, data?: Record<string, unknown>): RuntimeToolResult {
  return { ok: false, error, summary, ...(data ? { data: JSON.parse(JSON.stringify(data)) } : {}) };
}

function ok(summary: string, data: unknown): RuntimeToolResult {
  return { ok: true, summary, data: JSON.parse(JSON.stringify(data)) };
}

function sourceInput(input: Readonly<Record<string, unknown>>): StyleDistillationSourceInput {
  const chapters = Array.isArray(input.chapters)
    ? input.chapters.filter((item): item is { number: number; title?: string; content: string } => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const value = item as Record<string, unknown>;
      return typeof value.number === "number" && typeof value.content === "string";
    })
    : undefined;
  const chapterList = Array.isArray(input.chapterList)
    ? input.chapterList.filter((item): item is number => typeof item === "number")
    : undefined;
  return {
    sourceName: typeof input.sourceName === "string" ? input.sourceName : "",
    ...(typeof input.filePath === "string" ? { filePath: input.filePath } : {}),
    ...(typeof input.text === "string" ? { text: input.text } : {}),
    ...(chapters ? { chapters } : {}),
    ...(typeof input.splitPattern === "string" ? { splitPattern: input.splitPattern } : {}),
    ...(chapterList ? { chapterList } : {}),
    ...(typeof input.fromChapter === "number" ? { fromChapter: input.fromChapter } : {}),
    ...(typeof input.toChapter === "number" ? { toChapter: input.toChapter } : {}),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** start 的 maxBatches：缺省处理全部待处理批次；给了就只处理这么多批（至少 1 批）。 */
function batchLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.trunc(value));
}

function nonNegativeInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function taskKey(bookRoot: string, jobId: string): string {
  const absolute = resolve(bookRoot);
  return `${process.platform === "win32" ? absolute.toLowerCase() : absolute}::${jobId}`;
}

// ---------------------------------------------------------------------------
// 本进程里由叙述者工具启动的后台批次登记。任务状态的权威仍是任务文件与运行锁（readStyleDistillationJob），
// 这里只补两样任务文件里没有的：status 等待时被批次进度即时唤醒，以及本进程内最近一次后台执行的结局
// （例如运行锁被别的执行者占着、任务文件写不进去时，结局只能留在这里与日志里）。
// ---------------------------------------------------------------------------

interface ToolBackgroundRun {
  readonly token: symbol;
  readonly startedAt: string;
  readonly plannedBatches: number;
  /** true：用不随本轮取消的服务端模型，会话结束后照常跑完；false：用本会话模型，本轮结束即暂停。 */
  readonly detached: boolean;
  readonly settled: Promise<void>;
}

interface ToolRunOutcome {
  readonly outcome: "completed" | "failed" | "aborted" | "busy";
  readonly at: string;
  readonly message: string;
}

const toolRuns = new Map<string, ToolBackgroundRun>();
const toolOutcomes = new Map<string, ToolRunOutcome>();
const progressWaiters = new Map<string, Set<() => void>>();

function notifyProgress(key: string): void {
  const waiters = progressWaiters.get(key);
  if (!waiters) return;
  progressWaiters.delete(key);
  for (const wake of waiters) wake();
}

function nextProgress(key: string): { readonly promise: Promise<void>; readonly cancel: () => void } {
  let wake!: () => void;
  const promise = new Promise<void>((done) => { wake = done; });
  const waiters = progressWaiters.get(key) ?? new Set<() => void>();
  waiters.add(wake);
  progressWaiters.set(key, waiters);
  return {
    promise,
    cancel: () => {
      const current = progressWaiters.get(key);
      current?.delete(wake);
      if (current && current.size === 0) progressWaiters.delete(key);
    },
  };
}

/** 等本进程里该任务的叙述者后台批次结束（没有则立即返回）。供测试与需要串行的调用方使用。 */
export async function awaitStyleDistillationToolRun(bookRoot: string, jobId: string): Promise<void> {
  await toolRuns.get(taskKey(bookRoot, jobId))?.settled;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === "AbortError");
}

function launchBackgroundRun(input: {
  readonly bookRoot: string;
  readonly jobId: string;
  readonly generateText: RuntimeTextGenerator;
  readonly retryFailed: boolean;
  readonly maxBatches?: number;
  readonly plannedBatches: number;
  readonly signal?: AbortSignal;
  readonly detached: boolean;
  readonly initiatorId?: string;
}): ToolBackgroundRun {
  const key = taskKey(input.bookRoot, input.jobId);
  const token = Symbol(input.jobId);
  // 运行器同步登记本进程运行者，所以返回后立刻读任务就能看到 running。
  // 不把 emitOutput 交给后台：start 这次工具调用已经结束，进度只经 status 与任务文件对外。
  const run = runStyleDistillationBatches({
    bookRoot: input.bookRoot,
    jobId: input.jobId,
    generateText: input.generateText,
    retryFailed: input.retryFailed,
    ...(input.maxBatches !== undefined ? { maxBatches: input.maxBatches } : {}),
    // 脱离会话的批次不绑定本轮取消信号：作者中断对话不会打断它，要停在文风蒸馏页面操作。
    ...(!input.detached && input.signal ? { signal: input.signal } : {}),
    ...(!input.detached ? { abortExplanation: SESSION_ENDED_EXPLANATION } : {}),
    ...(input.initiatorId ? { initiatorId: input.initiatorId } : {}),
    onStage: () => notifyProgress(key),
    onProgress: () => notifyProgress(key),
  });
  const settled = run.then(
    (result) => {
      toolOutcomes.set(key, {
        outcome: "completed",
        at: new Date().toISOString(),
        message: `本次后台处理 ${result.processedBatchIds.length} 批；${progressLine(result.job)}。`,
      });
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      // 脱离会话的批次不受本轮信号约束：会话结束后它若失败，是真失败，不能算作中断。
      if (isAbortError(error, input.detached ? undefined : input.signal)) {
        toolOutcomes.set(key, { outcome: "aborted", at: new Date().toISOString(), message: SESSION_ENDED_EXPLANATION.what });
        return;
      }
      const busy = error instanceof StyleDistillationError && error.code === "STYLE_DISTILLATION_BUSY";
      toolOutcomes.set(key, { outcome: busy ? "busy" : "failed", at: new Date().toISOString(), message: message.slice(0, 1_000) });
      // 顶层不能静默：任务级失败运行器已尽量写进任务 lastError；写不进去时只剩这里的日志与本进程结局。
      if (!busy) {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        console.error(`[style-distill-tools] 叙述者后台批次执行失败（任务 ${input.jobId}）：${detail}`);
      }
    },
  ).finally(() => {
    if (toolRuns.get(key)?.token === token) toolRuns.delete(key);
    notifyProgress(key);
  });
  const registered: ToolBackgroundRun = { token, startedAt: new Date().toISOString(), plannedBatches: input.plannedBatches, detached: input.detached, settled };
  toolOutcomes.delete(key);
  toolRuns.set(key, registered);
  return registered;
}

function backgroundView(bookRoot: string, jobId: string) {
  const key = taskKey(bookRoot, jobId);
  const run = toolRuns.get(key);
  const outcome = toolOutcomes.get(key);
  if (!run && !outcome) return undefined;
  return {
    runningInThisSession: Boolean(run),
    ...(run ? { startedAt: run.startedAt, plannedBatches: run.plannedBatches, detached: run.detached } : {}),
    ...(outcome ? { lastOutcome: outcome } : {}),
  };
}

/** 任务停着（暂停 / 失败）时说明原因：任务级停下原因优先，其次是自动续跑停下的原因。与网页同口径。 */
function stopExplanation(job: StyleDistillationJob): Explanation | undefined {
  if (job.status !== "paused" && job.status !== "failed") return undefined;
  if (job.lastError) return { what: job.lastError.what, why: job.lastError.why, next: job.lastError.next };
  return job.autoResume?.explanation;
}

interface ModelViewOptions {
  /** 是否列出待审条目；任务还在跑时只给计数，避免反复返回半成品清单。 */
  readonly includeItems: boolean;
  readonly itemOffset?: number;
  readonly itemLimit?: number;
}

/**
 * 给模型看的精简视图：只留决策需要的字段。完整任务（全部批次详情、规则全文证据、统计指纹）
 * 在文风蒸馏页面查看；待审条目按页列出，证据与范文只给预览，采纳时按 id 点名即可。
 */
function modelView(job: StyleDistillationJob, revision: string | null, options: ModelViewOptions) {
  const summary = summarizeStyleDistillationBatches(job);
  const recommendedRuleIds = recommendedStyleDistillationRuleIds(job);
  const offset = options.itemOffset ?? 0;
  const limit = options.itemLimit ?? STYLE_DISTILL_REVIEW_PAGE_DEFAULT;
  const modelRuleCount = job.rules.filter((rule) => rule.origin === "model").length;
  const needsReviewCount = job.rules.filter((rule) => rule.status === "needs-review").length;
  const rulesPage = options.includeItems ? job.rules.slice(offset, offset + limit) : [];
  const samplesPage = options.includeItems ? job.samples.slice(offset, offset + limit) : [];
  const hasMore = options.includeItems && (offset + limit < job.rules.length || offset + limit < job.samples.length);
  const stop = stopExplanation(job);
  return {
    job: {
      jobId: job.jobId,
      status: job.status,
      sourceName: job.sourceName,
      chapterRange: job.chapterRange,
      chapterCount: job.chapterCount,
      progress: job.progress,
      updatedAt: job.updatedAt,
      ...(job.adoption ? { adoptedAt: job.adoption.adoptedAt } : {}),
    },
    batches: {
      total: summary.total,
      pending: summary.pending,
      done: summary.done,
      failed: summary.failed,
      failures: summary.failures.slice(0, 10),
      rejectedRuleCount: summary.rejectedRuleCount,
      warnings: summary.warnings.slice(0, 5),
      ...(summary.rejectedExplanation ? { rejectedExplanation: summary.rejectedExplanation } : {}),
    },
    reviewItems: {
      ruleCount: job.rules.length,
      modelRuleCount,
      needsReviewCount,
      sampleCount: job.samples.length,
      // 可迁移、证据逐字吻合的模型规则；作者同意「全部采纳推荐」时把这些 id 传给 action=adopt。
      recommendedRuleIds,
      ...(options.includeItems
        ? {
          rules: rulesPage.map((rule) => ({
            id: rule.id,
            category: STYLE_RULE_CATEGORY_LABELS[rule.category ?? "general"],
            text: clip(rule.text, 300),
            evidence: clip(rule.evidence, EVIDENCE_PREVIEW_CHARS),
            transfer: rule.transfer === "transferable" ? "可迁移" : "作品专属",
            status: rule.status,
            origin: rule.origin ?? "baseline",
            ...(rule.origin === "model" ? { confidence: rule.confidence ?? "high" } : {}),
          })),
          samples: samplesPage.map((sample) => ({
            id: sample.id,
            sceneType: sample.sceneType,
            ...(sample.registerTag ? { registerTag: sample.registerTag } : {}),
            preview: clip(sample.text, SAMPLE_PREVIEW_CHARS),
            transfer: sample.transfer === "transferable" ? "可迁移" : "作品专属",
          })),
          page: {
            itemOffset: offset,
            itemLimit: limit,
            hasMore,
            ...(hasMore ? { next: `再调用 style_manage（action=status，jobId=${job.jobId}，itemOffset=${offset + limit}）读取后续条目。` } : {}),
          },
        }
        : { note: "任务仍在处理中，待审条目暂只给计数；全部批次结束后用 action=status 读取条目清单。" }),
    },
    ...(stop ? { explanation: stop } : {}),
    // 采纳时原样传回；本书还没有文风预设时为空字符串。
    expectedVersion: revision ?? "",
    expectedRevision: revision,
  };
}

function progressLine(job: StyleDistillationJob): string {
  const summary = summarizeStyleDistillationBatches(job);
  const parts = [`模型批次 ${summary.done + summary.failed}/${summary.total} 已结束`];
  if (summary.failed > 0) parts.push(`${summary.failed} 批失败`);
  if (summary.pending > 0) parts.push(`${summary.pending} 批待处理`);
  if (summary.rejectedRuleCount > 0) parts.push(`${summary.rejectedRuleCount} 条模型规则因证据未在原文找到被丢弃`);
  return parts.join("，");
}

function modelUnavailable(): Explanation {
  return {
    what: "当前 Runtime 会话没有可用的文本生成能力，模型批次未执行。",
    why: "文风规则需要模型阅读原文后抽取；确定性基线与统计指纹已可审阅，但不能替代模型抽取。",
    next: "配置会话模型后，再次调用 style_manage（action=start）并传入 jobId 继续。",
  };
}

function toolError(error: unknown): RuntimeToolResult | null {
  if (error instanceof BookTextFileError) {
    return fail(error.code, error.message, {
      explanation: {
        what: error.message,
        why: "参考文件只允许读取本书目录内不超过 60 MB 的普通文本文件，禁止跨目录或读取内部数据。",
        next: "可先调用 style_manage（action=index，listFilesOnly=true）查看本书目录下可用的参考文件。",
      },
    });
  }
  if (error instanceof StyleDistillationError) {
    return fail(error.code, error.message, {
      explanation: {
        what: error.message,
        why: "文风蒸馏任务状态必须与来源快照一致，不能跳过校验或并发写入。",
        next: error.code === "STYLE_DISTILLATION_BUSY" ? "稍后用 style_manage（action=status）查看进度。" : "按提示修正输入，或重新提交参考文本新建任务。",
      },
    });
  }
  if (error instanceof StylePresetError) {
    const status = error.code === "STYLE_PRESET_CONFLICT" ? 409 : error.code === "STYLE_PRESET_INVALID" ? 400 : 422;
    return fail(error.code, error.message, {
      status,
      explanation: {
        what: error.message,
        why: "文风预设不能被静默覆盖；作者或网页可能刚改过它。",
        next: "先用 style_manage（action=status）取得最新 expectedVersion，向作者确认要采纳的条目后再调用 style_manage（action=adopt）。",
      },
    });
  }
  return null;
}

async function distillIndex(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  const rawPath = typeof input.filePath === "string" ? input.filePath.trim() : "";
  const rawText = typeof input.text === "string" ? input.text : "";
  if (input.listFilesOnly === true || (!rawPath && !rawText.trim())) {
    const listed = await listWorkspaceReferenceFiles(binding.root);
    const files = listed.map((file) => ({
      ...file,
      path: file.filePath,
      sizeBytes: file.byteLength,
      updatedAt: file.modifiedAt,
    }));
    return ok(`本书目录下共有 ${files.length} 个可用参考文件。`, { files });
  }

  let text = rawText;
  let encoding: "utf-8" | "gb18030" = "utf-8";
  let byteLength = Buffer.byteLength(rawText, "utf8");
  if (rawPath && !rawText) {
    const file = await readBookTextFile(binding.root, rawPath);
    text = file.text;
    encoding = file.encoding;
    byteLength = file.byteLength;
  }
  const fallbackName = rawPath ? basename(rawPath).replace(/\.(?:txt|md)$/iu, "").trim() || rawPath : "参考文本";
  const sourceName = (typeof input.sourceName === "string" && input.sourceName.trim()) || fallbackName;
  const splitPattern = typeof input.splitPattern === "string" && input.splitPattern.trim() ? input.splitPattern.trim() : undefined;
  let index;
  try {
    index = buildMechanicalBookIndex({ sourceName, text, ...(splitPattern ? { splitPattern } : {}) });
  } catch (error) {
    return fail("STYLE_DISTILLATION_INVALID_INPUT", error instanceof Error ? error.message : String(error));
  }
  const offset = typeof input.offset === "number" && Number.isFinite(input.offset) ? Math.max(0, Math.trunc(input.offset)) : 0;
  const limit = typeof input.limit === "number" && Number.isFinite(input.limit) ? Math.min(200, Math.max(1, Math.trunc(input.limit))) : 100;
  const pageChapters = index.chapters.slice(offset, offset + limit);
  const recommendedSet = new Set(index.recommendedChapters.chapterNumbers);
  const recommendedChapterDetails = index.chapters.filter((chapter) => recommendedSet.has(chapter.number));
  return ok(
    `已建立「${sourceName}」机械索引：共 ${index.chapterCount} 章、${index.totalCharCount} 字（${encoding}），推荐抽样 ${index.recommendedChapters.chapterNumbers.length} 章。可直接将 recommendedChapters.chapterNumbers 作为 chapterList 传给 style_manage（action=preview 或 start）。`,
    {
      sourceName,
      ...(rawPath ? { filePath: rawPath } : {}),
      encoding,
      byteLength,
      chapterCount: index.chapterCount,
      totalChars: index.totalCharCount,
      totalCharCount: index.totalCharCount,
      topChapters: index.topChapters,
      recommendedChapters: index.recommendedChapters,
      recommendedChapterDetails,
      pagination: {
        offset,
        limit,
        totalChapters: index.chapterCount,
        hasMore: offset + limit < index.chapterCount,
      },
      chapters: pageChapters,
    },
  );
}

function statusHint(jobId: string): string {
  return `用 style_manage（action=status，jobId=${jobId}，waitSeconds=30）查看进度，不要重复调用 start。`;
}

/**
 * 启动 / 续跑模型批次：建好（或读出）任务后把批次放到后台执行，立即返回任务标识与当前状态。
 * 进度、结果与失败原因都写在任务文件里，由 action=status 读取（可带 waitSeconds 等待进度）。
 */
async function start(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  // 优先用不随本轮取消的服务端模型，叙述者本轮结束后批次照常跑完；宿主没给时退回本会话模型。
  const detached = Boolean(context.backgroundGenerateText);
  const generateText = context.backgroundGenerateText ?? context.generateText;
  const existingJobId = typeof input.jobId === "string" && input.jobId.trim() ? input.jobId.trim() : null;
  context.emitOutput?.(
    existingJobId
      ? `正在加载文风蒸馏任务 ${existingJobId}…`
      : "正在切分参考章节并初始化文风蒸馏任务…",
  );
  const job = existingJobId
    ? await readStyleDistillationJob(binding.root, existingJobId)
    : await createStyleDistillationJob({
      bookRoot: binding.root,
      bookId: binding.bookId,
      source: await resolveStyleDistillationInput(binding.root, sourceInput(input)),
      modelAvailable: Boolean(generateText),
    });
  if (job.bookId !== binding.bookId) return fail("STYLE_DISTILLATION_NOT_FOUND", "该蒸馏任务不属于当前书籍。");
  const revision = (await loadStylePreset(binding.root)).revision;

  if (!generateText) {
    return ok(
      existingJobId
        ? "当前会话没有可用模型，未继续模型批次。"
        : `已保存来源包的确定性基线（任务 ${job.jobId}）；当前会话没有可用模型，模型批次待处理。`,
      { ...modelView(job, revision, { includeItems: true }), explanation: modelUnavailable() },
    );
  }

  // 已有执行者（本会话的后台批次、网页端或另一个进程）在跑：不再并发启动，告诉叙述者去查进度。
  if (await hasLiveStyleDistillationRunner(binding.root, job.jobId)) {
    const current = await readStyleDistillationJob(binding.root, job.jobId);
    const background = backgroundView(binding.root, job.jobId);
    return ok(
      `任务 ${job.jobId} 已在后台处理中（${progressLine(current)}），本次没有重复启动。${statusHint(job.jobId)}`,
      { ...modelView(current, revision, { includeItems: false }), alreadyRunning: true, ...(background ? { background } : {}) },
    );
  }

  const retryFailed = input.retryFailed === true;
  const initialSummary = summarizeStyleDistillationBatches(job);
  const retryable = retryFailed
    ? job.batches.filter((batch) => batch.status === "failed" || isAllRejectedBatch(batch)).length
    : 0;
  const runnable = initialSummary.pending + retryable;
  if (runnable === 0) {
    const finished = initialSummary.failed > 0
      ? `有 ${initialSummary.failed} 批失败，可调用 style_manage（action=start，jobId=${job.jobId}，retryFailed=true）重试。`
      : "全部批次已结束，请把待审条目逐条给作者看，作者点名后再采纳。";
    return ok(`任务 ${job.jobId} 没有待处理批次；${progressLine(job)}。${finished}`, modelView(job, revision, { includeItems: true }));
  }

  const maxBatches = batchLimit(input.maxBatches);
  const plannedBatches = Math.min(maxBatches ?? runnable, runnable);
  launchBackgroundRun({
    bookRoot: binding.root,
    jobId: job.jobId,
    generateText,
    retryFailed,
    ...(maxBatches !== undefined ? { maxBatches } : {}),
    plannedBatches,
    ...(context.signal ? { signal: context.signal } : {}),
    detached,
    ...(context.actorUserId ? { initiatorId: context.actorUserId } : {}),
  });
  context.emitOutput?.(`任务 ${job.jobId}（${job.sourceName}）已在后台开始：共 ${initialSummary.total} 批，本次计划处理 ${plannedBatches} 批。`);
  context.emitStructuredProgress?.({
    completed: initialSummary.done + initialSummary.failed,
    total: initialSummary.total,
    itemsDone: initialSummary.done + initialSummary.failed,
    itemsTotal: initialSummary.total,
    phase: "style_distill",
  });
  // 运行器会异步把失败批次重排回待处理；这里按同一口径算出启动后的视图，避免重试时先读到旧的 ready / failed。
  const current = settleStyleDistillationJobState({
    ...job,
    status: job.status === "failed" ? "paused" : job.status,
    batches: job.batches.map((batch) => retryFailed && (batch.status === "failed" || isAllRejectedBatch(batch))
      ? { ...batch, status: "pending" as const, explanation: undefined, rejectedRules: undefined }
      : batch),
  }, true);
  const background = backgroundView(binding.root, job.jobId);
  return ok(
    `已在后台启动文风蒸馏任务 ${job.jobId}：共 ${initialSummary.total} 批，本次计划处理 ${plannedBatches} 批。${statusHint(job.jobId)}${detached
      ? "后台批次使用作者配置的默认模型，本轮对话结束后照常跑完；可以先结束回复，之后再查。"
      : "后台批次使用本会话模型，本轮对话结束或被中断时未完成批次会暂停（已完成的保留），之后可带 jobId 再次 start 续跑。"}`,
    {
      ...modelView(current, revision, { includeItems: false }),
      ...(background ? { background } : {}),
      next: {
        action: "status",
        jobId: job.jobId,
        waitSeconds: 30,
        note: "批次全部结束（job.status 为 ready）后，用 status 读取待审条目逐条给作者看；不要重复 start。",
      },
    },
  );
}

/** 读任务状态；任务仍在处理且给了 waitSeconds 时，等到有批次结束、任务停下或等满为止。 */
async function status(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  if (typeof input.jobId !== "string" || !input.jobId.trim()) return fail("job-id-required", "style_manage（action=status）需要 jobId。");
  const jobId = input.jobId.trim();
  let job = await readStyleDistillationJob(binding.root, jobId);
  if (job.bookId !== binding.bookId) return fail("STYLE_DISTILLATION_NOT_FOUND", "该蒸馏任务不属于当前书籍。");

  const waitMs = nonNegativeInt(input.waitSeconds, 0, STYLE_DISTILL_STATUS_MAX_WAIT_SECONDS) * 1_000;
  if (waitMs > 0 && job.status === "running") {
    job = await waitForProgress(binding.root, job, waitMs, context);
  }

  const itemOffset = nonNegativeInt(input.itemOffset, 0, Number.MAX_SAFE_INTEGER);
  const itemLimit = Math.max(1, nonNegativeInt(input.itemLimit, STYLE_DISTILL_REVIEW_PAGE_DEFAULT, STYLE_DISTILL_REVIEW_PAGE_MAX));
  const running = job.status === "running";
  const summary = summarizeStyleDistillationBatches(job);
  const stop = stopExplanation(job);
  const tail = running
    ? `仍在后台处理中。${statusHint(jobId)}`
    : summary.pending > 0
      ? `已暂停，还有 ${summary.pending} 批待处理${stop ? `（${stop.what}）` : ""}；可调用 style_manage（action=start，jobId=${jobId}）续跑。`
      : summary.failed > 0
        ? `有失败批次，可调用 style_manage（action=start，jobId=${jobId}，retryFailed=true）重试。`
        : job.status === "adopted"
          ? "该任务已采纳过；如需追加，可继续点名条目后再次采纳。"
          : "全部批次已结束，请把待审条目逐条给作者看，作者点名后再采纳。";
  const background = backgroundView(binding.root, jobId);
  return ok(
    `文风蒸馏任务 ${jobId}：${progressLine(job)}。${tail}`,
    {
      ...modelView(job, (await loadStylePreset(binding.root)).revision, { includeItems: !running, itemOffset, itemLimit }),
      ...(background ? { background } : {}),
    },
  );
}

async function waitForProgress(
  bookRoot: string,
  initial: StyleDistillationJob,
  waitMs: number,
  context: ToolExecutionContext,
): Promise<StyleDistillationJob> {
  const key = taskKey(bookRoot, initial.jobId);
  const finishedCount = (job: StyleDistillationJob) => {
    const summary = summarizeStyleDistillationBatches(job);
    return summary.done + summary.failed;
  };
  const baseline = finishedCount(initial);
  const deadline = Date.now() + waitMs;
  const startedMs = Date.now();
  let job = initial;
  context.emitOutput?.(`正在等待任务 ${initial.jobId} 的批次进度（最多 ${Math.round(waitMs / 1_000)} 秒）…`);
  while (Date.now() < deadline && !context.signal?.aborted) {
    // 本进程里的后台批次每有进展就即时唤醒；别的执行者（网页端、另一个进程）靠定时读任务文件。
    const waiter = nextProgress(key);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    await Promise.race([
      waiter.promise,
      new Promise<void>((done) => { timer = setTimeout(done, Math.min(STATUS_POLL_MS, Math.max(0, deadline - Date.now()))); }),
      new Promise<void>((done) => {
        if (!context.signal) return;
        onAbort = done;
        context.signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
    waiter.cancel();
    if (timer) clearTimeout(timer);
    if (onAbort) context.signal?.removeEventListener("abort", onAbort);
    job = await readStyleDistillationJob(bookRoot, initial.jobId);
    const summary = summarizeStyleDistillationBatches(job);
    context.emitStructuredProgress?.({
      completed: summary.done + summary.failed,
      total: summary.total,
      itemsDone: summary.done + summary.failed,
      itemsTotal: summary.total,
      phase: "style_distill",
      elapsedMs: Date.now() - startedMs,
    });
    if (job.status !== "running" || finishedCount(job) !== baseline) break;
  }
  return job;
}

async function adopt(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  if (typeof input.jobId !== "string" || !input.jobId.trim()) return fail("job-id-required", "style_manage（action=adopt）需要 jobId。");
  if (!Object.hasOwn(input, "expectedVersion") || (input.expectedVersion !== null && typeof input.expectedVersion !== "string")) {
    return fail("expected-version-required", "style_manage（action=adopt）需要 expectedVersion（取自 style_manage action=status；本书尚无预设时传空字符串）。");
  }
  const ruleIds = stringList(input.ruleIds);
  const sampleIds = stringList(input.sampleIds);
  if (ruleIds.length + sampleIds.length === 0) {
    return fail("nothing-to-adopt", "没有指定要采纳的条目；请先请作者确认具体规则或范文。");
  }
  const job = await readStyleDistillationJob(binding.root, input.jobId.trim());
  if (job.bookId !== binding.bookId) return fail("STYLE_DISTILLATION_NOT_FOUND", "该蒸馏任务不属于当前书籍。");
  const expected = typeof input.expectedVersion === "string" && input.expectedVersion.trim()
    ? input.expectedVersion.trim()
    : null;
  const role = input.role === "primary_voice" || input.role === "register_overlay" ? input.role : undefined;
  const triggerTags = Array.isArray(input.triggerTags) ? stringList(input.triggerTags) : undefined;
  const forbiddenSourceTerms = Array.isArray(input.forbiddenSourceTerms) ? stringList(input.forbiddenSourceTerms) : undefined;
  const result = await adoptStyleDistillation({
    bookRoot: binding.root,
    jobId: job.jobId,
    ruleIds,
    sampleIds,
    ...(role ? { role } : {}),
    ...(triggerTags ? { triggerTags } : {}),
    ...(forbiddenSourceTerms ? { forbiddenSourceTerms } : {}),
    expectedRevision: expected,
  });
  return ok(
    `已采纳 ${ruleIds.length} 条规则、${sampleIds.length} 条范文；其中 ${result.guideRuleCount} 条可迁移规则进入本书文风指南，${result.sourceOnlyCount} 条作品专属内容只保存为来源证据。`,
    {
      jobId: result.job.jobId,
      status: result.job.status,
      guideRuleCount: result.guideRuleCount,
      sourceOnlyCount: result.sourceOnlyCount,
      expectedVersion: result.preset.revision ?? "",
      guideText: result.preset.guideText,
    },
  );
}

export async function executeStyleDistillationTool(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const name = toolName.replace(/^style_distill_/u, "style.distill_");
  try {
    if (name === "style.distill_index") {
      return await distillIndex(input, binding);
    }
    if (name === "style.distill_preview") {
      const rawIn = sourceInput(input);
      let effectiveInput = rawIn;
      let autoSampledNote = "";
      const hasRangeFilter = (Array.isArray(rawIn.chapterList) && rawIn.chapterList.length > 0)
        || rawIn.fromChapter !== undefined
        || rawIn.toChapter !== undefined;
      // 针对大文件或超长文本未传 chapterList 的预览请求：自动走机械索引挑推荐代表章预览，避免千万字大文件全量重算或直接报错阻断
      if (!hasRangeFilter && (rawIn.filePath?.trim() || (rawIn.text && rawIn.text.length > 300_000))) {
        const rawText = rawIn.text ?? (await readBookTextFile(binding.root, rawIn.filePath!.trim())).text;
        if (rawText.length > 300_000) {
          const fallbackName = rawIn.filePath
            ? basename(rawIn.filePath.trim()).replace(/\.(?:txt|md)$/iu, "").trim() || rawIn.filePath.trim()
            : "参考文本";
          const sourceName = rawIn.sourceName.trim() || fallbackName;
          const index = buildMechanicalBookIndex({
            sourceName,
            text: rawText,
            ...(rawIn.splitPattern?.trim() ? { splitPattern: rawIn.splitPattern.trim() } : {}),
          });
          if (index.chapterCount > 30) {
            const autoList = index.recommendedChapters.chapterNumbers;
            effectiveInput = { ...rawIn, sourceName, text: rawText, filePath: undefined, chapterList: autoList };
            autoSampledNote = `（原书共 ${index.chapterCount} 章/${index.totalCharCount} 字，未指定 chapterList，已自动按机械索引推荐的 ${autoList.length} 章高能代表章预览）`;
          } else {
            effectiveInput = { ...rawIn, sourceName, text: rawText, filePath: undefined };
          }
        }
      }
      const sourceIn = await resolveStyleDistillationInput(binding.root, effectiveInput);
      const source = makePreviewSource(sourceIn);
      // 与网页预览同一份估算：开跑前告诉作者要调多少次模型、最多输出多少。
      const estimate = estimateStyleDistillationRun(sourceIn.chapters ?? normalizeStyleDistillationSource(sourceIn).chapters);
      return ok(
        `已预览参考文本范围${autoSampledNote}；尚未写入本书文风。${estimate.summary}`,
        {
          ...source,
          ...(autoSampledNote && effectiveInput.chapterList ? { autoSampledChapterList: effectiveInput.chapterList } : {}),
          estimate,
        },
      );
    }
    if (name === "style.distill_start") return await start(input, binding, context);
    if (name === "style.distill_status") return await status(input, binding, context);
    if (name === "style.distill_adopt") return await adopt(input, binding);
    return fail("unknown-style-distill-tool", "未知的文风蒸馏工具。");
  } catch (error) {
    const handled = toolError(error);
    if (handled) return handled;
    throw error;
  }
}
