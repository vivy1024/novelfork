/**
 * 旧稿导入的执行层（T4.2）：确认写章 → 逐章事实 → 全书综合 → 发布。
 *
 * 只编排已有能力，不另造路径：
 * - 写章：writing-resource 文件存储（新正文原子写 → 章节索引原子写，全程持章节索引锁），
 *   与写作台保存同一套附带动作（applyChapterContentChange）。
 * - 逐章事实：handleMemorySettleChapter（与 POST …/chapters/:n/resettle 同一实现），
 *   模型由调用方注入（Runtime 默认模型）；没有模型时停在这一步并说明原因，不用规则冒充。
 *   高风险事件照常进待审队列，由统一待确认收口。
 * - 全书综合：rebuildNarrativeEntityIndex、backfillHookCausalLinks、伏笔阶段与剧情线读取、
 *   collectPendingReview，只调用不改；另从正文统计反复出现的人物，起草待确认的经纬人物条目
 *   （engine/manuscript-import/character-drafts.ts），作者确认后经纬条目接口回填出场并重建实体索引。
 */
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import {
  applyPlanEdit,
  buildPlanFromSource,
  createManuscriptImportJob,
  loadManuscriptImportJob,
  loadPlan,
  ManuscriptImportError,
  MAX_MANUSCRIPT_CHAPTERS,
  previewPlan,
  readManuscriptSnapshot,
  saveManuscriptImportJob,
  savePlan,
  withManuscriptJobLock,
  type Explanation,
  type ManuscriptImportJob,
  type ManuscriptImportJobChapter,
  type ManuscriptImportReport,
  type ManuscriptSourceFileInput,
  type PlanEdit,
  type PlanPreview,
} from "../engine/manuscript-import/manuscript-import.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { withChapterIndexLock } from "../engine/writing-resource/chapter-index-lock.js";
import { readChapterIndex } from "../engine/writing-resource/chapter-layout.js";
import { chapterContentFingerprint } from "../engine/narrative-memory/settlement-idempotency.js";
import { createRuntimeChapterEventExtractor } from "../engine/narrative-memory/chapter-event-extractor.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { backfillHookCausalLinks } from "../engine/narrative-memory/causal-backfill.js";
import { listStorylines } from "../engine/narrative-memory/scene-store.js";
import { rebuildNarrativeEntityIndex } from "../engine/narrative-entity/entity-index.js";
import { loadForeshadowStates } from "../engine/narrative-taxonomy/foreshadow-states.js";
import { readBookConfigFile, updateBookConfig } from "../engine/book-config/book-config-lock.js";
import { collectPendingReview } from "../routes/pending-review.js";
import {
  listPendingManuscriptCharacterDrafts,
  MIN_CHARACTER_DRAFT_OCCURRENCES,
  stageManuscriptCharacterDrafts,
} from "../engine/manuscript-import/character-drafts.js";
import { handleMemorySettleChapter } from "./memory-settle-chapter.js";
import { resolveChapterVolumeDirectory } from "./outline-volume.js";

export interface ManuscriptImportContext {
  readonly bookId: string;
  /** 可信书根（由宿主绑定解析）。 */
  readonly bookRoot: string;
  readonly storage: StorageDatabase;
}

/** book.json 里标记「这本书正由旧稿导入、尚未发布」；发布时删掉。值为任务 ID。 */
export const MANUSCRIPT_IMPORT_BOOK_MARKER = "manuscriptImportJobId";

function fail(code: ManuscriptImportError["code"], explanation: Explanation): never {
  throw new ManuscriptImportError(explanation.whatHappened, code, explanation);
}

function requirePhase(job: ManuscriptImportJob, phases: readonly ManuscriptImportJob["phase"][], action: string): void {
  if (phases.includes(job.phase)) return;
  const label: Record<ManuscriptImportJob["phase"], string> = {
    preview: "还在切分预览",
    writing: "正在写入章节",
    written: "章节已写入",
    published: "已完成导入",
  };
  fail("MANUSCRIPT_IMPORT_WRONG_PHASE", {
    whatHappened: `这个导入任务${label[job.phase]}，不能${action}。`,
    whyItMatters: "导入按「切分 → 确认写章 → 逐章事实 → 综合 → 发布」顺序进行，跳步会让章节与记忆对不上。",
    suggestedAction: "刷新导入页查看当前步骤。",
  });
}

// ─── 视图 ────────────────────────────────────────────────────────────────

export interface ManuscriptImportView {
  readonly job: ManuscriptImportJob;
  /** 只在预览阶段返回。 */
  readonly preview?: PlanPreview;
  readonly progress: {
    readonly total: number;
    readonly written: number;
    readonly settled: number;
    readonly failed: number;
    readonly pending: number;
  };
  readonly running: boolean;
}

const activeRunners = new Map<string, symbol>();

function runnerKey(context: ManuscriptImportContext, jobId: string): string {
  return `${context.bookRoot.toLowerCase()}::${jobId}`;
}

export function isManuscriptSettlementRunning(context: ManuscriptImportContext, jobId: string): boolean {
  return activeRunners.has(runnerKey(context, jobId));
}

function progressOf(job: ManuscriptImportJob): ManuscriptImportView["progress"] {
  const count = (predicate: (chapter: ManuscriptImportJobChapter) => boolean) => job.chapters.filter(predicate).length;
  return {
    total: job.chapters.length,
    written: count((chapter) => chapter.written),
    settled: count((chapter) => chapter.settle.status === "done" || chapter.settle.status === "skipped"),
    failed: count((chapter) => chapter.settle.status === "failed"),
    pending: count((chapter) => chapter.settle.status === "pending" || chapter.settle.status === "running"),
  };
}

/** 进程重启后残留的 running（结算者已不在）对外按「已暂停、可继续」呈现。 */
function settleView(job: ManuscriptImportJob, running: boolean): ManuscriptImportJob {
  if (running || job.settlement.state !== "running") return job;
  return {
    ...job,
    settlement: {
      state: "paused",
      explanation: {
        whatHappened: "逐章事实在中途停下了（服务重启或连接中断）。",
        whyItMatters: "已完成的章节结果都已保存；没跑完的章节还没有叙事记忆。",
        suggestedAction: "点「继续逐章事实」，会从未完成的章接着跑，已完成的章不会重复结算。",
      },
    },
    chapters: job.chapters.map((chapter) => chapter.settle.status === "running"
      ? { ...chapter, settle: { ...chapter.settle, status: "pending" as const } }
      : chapter),
  };
}

/**
 * 加载任务并核对它属于当前作品。每个读写入口都必须经过这里：
 * 任务目录按书根定位，两个 bookId 解析到同一书根时，只按 jobId 加载会让一本书改到另一本书的任务
 * （确认写章更会先写章、到结算才发现不属于本书）。
 */
async function loadOwnedJob(context: ManuscriptImportContext, jobId: string): Promise<ManuscriptImportJob> {
  const stored = await loadManuscriptImportJob(context.bookRoot, jobId);
  if (stored.bookId !== context.bookId) {
    fail("MANUSCRIPT_IMPORT_NOT_FOUND", {
      whatHappened: "这个导入任务不属于当前作品。",
      whyItMatters: "任务只能操作创建它的那本书。",
      suggestedAction: "回书架打开正确的作品。",
    });
  }
  return stored;
}

export async function readManuscriptImport(context: ManuscriptImportContext, jobId: string): Promise<ManuscriptImportView> {
  const stored = await loadOwnedJob(context, jobId);
  const running = isManuscriptSettlementRunning(context, jobId);
  const job = settleView(stored, running);
  const preview = job.phase === "preview" ? previewPlan(await loadPlan(context.bookRoot, job)) : undefined;
  return { job, ...(preview ? { preview } : {}), progress: progressOf(job), running };
}

// ─── 建任务与切分 ─────────────────────────────────────────────────────────

export async function startManuscriptImport(context: ManuscriptImportContext, input: {
  readonly sourceName: string;
  readonly files: readonly ManuscriptSourceFileInput[];
  readonly splitPattern?: string;
}): Promise<ManuscriptImportView> {
  const { job } = await createManuscriptImportJob({ bookRoot: context.bookRoot, bookId: context.bookId, ...input });
  // 标记这本书处于「导入中」：发布前书架与工作台据此提示回到导入页。
  await updateBookConfig(context.bookRoot, (current) => current ? { ...current, [MANUSCRIPT_IMPORT_BOOK_MARKER]: job.jobId } : null);
  return readManuscriptImport(context, job.jobId);
}

/** 换规则重切：只读原文快照，丢弃之前的手动调整。 */
export async function resplitManuscriptImport(
  context: ManuscriptImportContext,
  jobId: string,
  split: ManuscriptImportJob["split"],
): Promise<ManuscriptImportView> {
  await withManuscriptJobLock(context.bookRoot, jobId, async () => {
    const job = await loadOwnedJob(context, jobId);
    requirePhase(job, ["preview"], "重新切分");
    if (split.mode === "by-file" && job.source.kind !== "files") {
      fail("MANUSCRIPT_IMPORT_INVALID_INPUT", {
        whatHappened: "这份旧稿是单个文本文件，不能按文件切分。",
        whyItMatters: "按文件切分要求每个章节是一个单独的文件。",
        suggestedAction: "改用按规则切分，或换一条分章规则。",
      });
    }
    const current = await loadPlan(context.bookRoot, job);
    const snapshot = await readManuscriptSnapshot(context.bookRoot, job);
    const nextSplit = split.mode === "by-file"
      ? { mode: "by-file" as const }
      : { mode: "rule" as const, ...(split.pattern?.trim() ? { pattern: split.pattern.trim() } : {}) };
    const plan = buildPlanFromSource(snapshot, nextSplit, { jobId, sourceSha256: job.source.sha256, revision: current.revision + 1 });
    await savePlan(context.bookRoot, plan);
    await saveManuscriptImportJob(context.bookRoot, { ...job, split: nextSplit, planRevision: plan.revision });
  });
  return readManuscriptImport(context, jobId);
}

export async function editManuscriptImportPlan(
  context: ManuscriptImportContext,
  jobId: string,
  input: { readonly expectedRevision: number; readonly edit: PlanEdit },
): Promise<ManuscriptImportView> {
  await withManuscriptJobLock(context.bookRoot, jobId, async () => {
    const job = await loadOwnedJob(context, jobId);
    requirePhase(job, ["preview"], "调整切分");
    const plan = await loadPlan(context.bookRoot, job);
    if (plan.revision !== input.expectedRevision) {
      fail("MANUSCRIPT_IMPORT_CONFLICT", {
        whatHappened: "切分在你操作之前已被改过（可能在另一个窗口）。",
        whyItMatters: "按旧的章序合并或拆分会动到错误的章节。",
        suggestedAction: "刷新导入页后再调整。",
      });
    }
    const next = applyPlanEdit(plan, input.edit);
    await savePlan(context.bookRoot, next);
    await saveManuscriptImportJob(context.bookRoot, { ...job, planRevision: next.revision });
  });
  return readManuscriptImport(context, jobId);
}

export async function readManuscriptPlanChapter(context: ManuscriptImportContext, jobId: string, index: number) {
  const job = await loadOwnedJob(context, jobId);
  requirePhase(job, ["preview"], "查看切分正文");
  const plan = await loadPlan(context.bookRoot, job);
  const chapter = plan.chapters[index - 1];
  if (!chapter) {
    fail("MANUSCRIPT_IMPORT_INVALID_INPUT", {
      whatHappened: `第 ${index} 项不在当前切分里。`,
      whyItMatters: "切分可能已被改过。",
      suggestedAction: "刷新导入页。",
    });
  }
  return { index, title: chapter.title, lines: chapter.content.split("\n"), revision: plan.revision };
}

// ─── 确认写章 ─────────────────────────────────────────────────────────────

/**
 * 确认后写章。写入走 writing-resource 文件存储（原子写 + 章节索引锁），与写作台保存同一套附带动作。
 * 章号接在书里现有章节之后；任务文件先记下计划（phase=writing），每写完一章立刻记一笔，
 * 中断后再确认会从未写的章继续，不重复写。
 */
export async function confirmManuscriptImport(
  context: ManuscriptImportContext,
  jobId: string,
  input: { readonly expectedRevision: number },
): Promise<ManuscriptImportView> {
  await withManuscriptJobLock(context.bookRoot, jobId, async () => {
    let job = await loadOwnedJob(context, jobId);
    requirePhase(job, ["preview", "writing"], "确认写章");
    const plan = await loadPlan(context.bookRoot, job);
    if (job.phase === "preview") {
      if (plan.revision !== input.expectedRevision) {
        fail("MANUSCRIPT_IMPORT_CONFLICT", {
          whatHappened: "你确认的切分与当前保存的切分不一致（可能在另一个窗口改过）。",
          whyItMatters: "按旧切分写章会写出你没看过的章节划分。",
          suggestedAction: "刷新导入页，核对切分后再确认。",
        });
      }
      if (plan.chapters.length === 0) {
        fail("MANUSCRIPT_IMPORT_INVALID_INPUT", {
          whatHappened: "当前切分没有任何章节。",
          whyItMatters: "没有章节可写。",
          suggestedAction: "换一条分章规则重切。",
        });
      }
      if (plan.chapters.length > MAX_MANUSCRIPT_CHAPTERS) {
        fail("MANUSCRIPT_IMPORT_TOO_LARGE", {
          whatHappened: `当前切分有 ${plan.chapters.length} 章，超过单次导入 ${MAX_MANUSCRIPT_CHAPTERS} 章上限。`,
          whyItMatters: "一次写入过多章节，中途失败时恢复成本很高。",
          suggestedAction: "按卷拆成几份分别导入。",
        });
      }
      const empty = plan.chapters.findIndex((chapter) => !chapter.content.trim());
      if (empty >= 0) {
        fail("MANUSCRIPT_IMPORT_INVALID_INPUT", {
          whatHappened: `第 ${empty + 1} 项「${plan.chapters[empty]!.title}」没有正文。`,
          whyItMatters: "空章会在目录里留下一章空白，结算也会跳过它。",
          suggestedAction: "把它与相邻章合并，或换规则重切后再确认。",
        });
      }
      const index = await withChapterIndexLock(context.bookRoot, () => readChapterIndex(context.bookRoot));
      const start = index.reduce((max, entry) => Math.max(max, Number(entry.number) || 0), 0) + 1;
      job = await saveManuscriptImportJob(context.bookRoot, {
        ...job,
        phase: "writing",
        chapters: plan.chapters.map((chapter, offset) => ({
          index: offset + 1,
          chapterNumber: start + offset,
          title: chapter.title,
          written: false,
          settle: { status: "pending", attempts: 0 },
        })),
      });
    }

    // 与写作台「新建 / 保存章节」同一个服务（POST …/resources）：正式章节写入文件存储，
    // 新正文原子写 → 章节索引原子写（全程持章节索引锁），再做写作日志与审计过期等附带动作。
    const service = createWritingResourceService({
      storage: context.storage,
      resolveBookDir: () => context.bookRoot,
      resolveChapterVolumeDirectory: (bookId, chapterNumber) => resolveChapterVolumeDirectory(context.storage, bookId, chapterNumber),
    });
    for (const planned of job.chapters) {
      if (planned.written) continue;
      const chapter = plan.chapters[planned.index - 1]!;
      const content = `# ${planned.title}\n\n${chapter.content.trim()}\n`;
      // 同一章号若已有正文（中断前写到一半、或作者手动建过），只在正文与本次计划一致时视为已写，
      // 否则拒绝覆盖，交给作者处理。
      const existing = await service.findAcceptedChapter(context.bookId, planned.chapterNumber);
      if (existing && chapterContentFingerprint(existing.content) !== chapterContentFingerprint(content)) {
        fail("MANUSCRIPT_IMPORT_CONFLICT", {
          whatHappened: `第 ${planned.chapterNumber} 章在导入期间已有别的正文。`,
          whyItMatters: "继续写入会覆盖这份正文。",
          suggestedAction: `先在工作台把第 ${planned.chapterNumber} 章挪走或删除，再回导入页继续确认。`,
        });
      }
      if (!existing) {
        await service.create(context.bookId, {
          type: "chapter",
          status: "accepted",
          title: planned.title,
          content,
          chapterNumber: planned.chapterNumber,
          source: `manuscript-import:${jobId}`,
          metadata: {},
        });
      }
      job = await saveManuscriptImportJob(context.bookRoot, {
        ...job,
        chapters: job.chapters.map((item) => item.index === planned.index
          ? { ...item, written: true, contentFingerprint: chapterContentFingerprint(content) }
          : item),
      });
    }
    await saveManuscriptImportJob(context.bookRoot, { ...job, phase: "written" });
  });
  return readManuscriptImport(context, jobId);
}

// ─── 逐章事实 ─────────────────────────────────────────────────────────────

export type ManuscriptTextGeneration =
  | { readonly available: true; readonly generateText: RuntimeTextGenerator }
  | { readonly available: false; readonly message: string; readonly suggestedAction: string };

/**
 * 没有模型时停在逐章事实：任务记为 blocked 并说明原因，不写任何记忆，也不阻止作者先发布开写。
 */
export async function blockManuscriptSettlement(
  context: ManuscriptImportContext,
  jobId: string,
  unavailable: { readonly message: string; readonly suggestedAction: string },
): Promise<ManuscriptImportView> {
  await withManuscriptJobLock(context.bookRoot, jobId, async () => {
    const job = await loadOwnedJob(context, jobId);
    requirePhase(job, ["written", "published"], "逐章事实");
    await saveManuscriptImportJob(context.bookRoot, {
      ...job,
      settlement: {
        state: "blocked",
        updatedAt: new Date().toISOString(),
        explanation: {
          whatHappened: `逐章事实没有开始：${unavailable.message}`,
          whyItMatters: "逐章事实要靠模型从正文里读出人物、关系、伏笔的变化；只用规则会漏掉大部分，所以这里没有用规则凑数，也没有写入任何记忆。",
          suggestedAction: `${unavailable.suggestedAction}配好后回到导入页点「继续逐章事实」。不想等也可以先点「完成导入」开始写，之后再补跑。`,
        },
      },
    });
  });
  return readManuscriptImport(context, jobId);
}

export interface RunManuscriptSettlementOptions {
  readonly generateText: RuntimeTextGenerator;
  /** 把失败的章重新排回待处理。 */
  readonly retryFailed?: boolean;
  /** 本次最多处理几章；缺省处理全部。 */
  readonly maxChapters?: number;
}

/**
 * 从未完成的章继续逐章结算。调用时同步登记运行者，HTTP 可以不等它结束就返回；
 * 同一任务已在运行时直接拒绝。每章结果立即写进任务文件，中断后从未完成的章续跑。
 */
export function runManuscriptSettlement(
  context: ManuscriptImportContext,
  jobId: string,
  options: RunManuscriptSettlementOptions,
): Promise<ManuscriptImportJob> {
  const key = runnerKey(context, jobId);
  if (activeRunners.has(key)) {
    return Promise.reject(new ManuscriptImportError("逐章事实正在进行中。", "MANUSCRIPT_IMPORT_BUSY", {
      whatHappened: "这个导入任务的逐章事实正在进行中。",
      whyItMatters: "同时跑两份会重复调用模型、互相覆盖进度。",
      suggestedAction: "等当前进度跑完，页面会自动刷新。",
    }));
  }
  const token = Symbol(jobId);
  activeRunners.set(key, token);
  return runChapters(context, jobId, options).finally(() => {
    if (activeRunners.get(key) === token) activeRunners.delete(key);
  });
}

async function updateJob(
  context: ManuscriptImportContext,
  jobId: string,
  mutate: (job: ManuscriptImportJob) => ManuscriptImportJob,
): Promise<ManuscriptImportJob> {
  return withManuscriptJobLock(context.bookRoot, jobId, async () => {
    const current = await loadOwnedJob(context, jobId);
    return saveManuscriptImportJob(context.bookRoot, mutate(current));
  });
}

async function runChapters(
  context: ManuscriptImportContext,
  jobId: string,
  options: RunManuscriptSettlementOptions,
): Promise<ManuscriptImportJob> {
  const initial = await loadOwnedJob(context, jobId);
  requirePhase(initial, ["written", "published"], "逐章事实");
  await updateJob(context, jobId, (job) => ({
    ...job,
    settlement: { state: "running", updatedAt: new Date().toISOString() },
    chapters: job.chapters.map((chapter) => {
      if (chapter.settle.status === "running") return { ...chapter, settle: { ...chapter.settle, status: "pending" as const } };
      if (options.retryFailed && chapter.settle.status === "failed") {
        return { ...chapter, settle: { status: "pending" as const, attempts: chapter.settle.attempts } };
      }
      return chapter;
    }),
  }));

  const llmExtractor = createRuntimeChapterEventExtractor(options.generateText);
  const limit = options.maxChapters === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.trunc(options.maxChapters));
  let processed = 0;
  try {
    while (processed < limit) {
      const job = await loadOwnedJob(context, jobId);
      const next = job.chapters.find((chapter) => chapter.settle.status === "pending");
      if (!next) break;
      await updateJob(context, jobId, (current) => ({
        ...current,
        chapters: current.chapters.map((chapter) => chapter.index === next.index
          ? { ...chapter, settle: { ...chapter.settle, status: "running" as const, attempts: chapter.settle.attempts + 1 } }
          : chapter),
      }));
      let settle: ManuscriptImportJobChapter["settle"];
      try {
        // 与 POST …/chapters/:n/resettle 同一实现：只结算已落盘正文；幂等门会跳过已结算的同一正文。
        const result = await handleMemorySettleChapter({
          bookId: context.bookId,
          bookRoot: context.bookRoot,
          chapterNumber: next.chapterNumber,
          title: next.title,
          storage: context.storage,
          llmExtractor,
          kernelGenerateText: options.generateText,
        });
        const settlement = result.settlement;
        settle = {
          status: !result.ok ? "failed" : settlement?.status === "skipped" ? "skipped" : "done",
          attempts: next.settle.attempts + 1,
          ...(settlement ? {
            extracted: settlement.extracted,
            autoApplied: settlement.autoApplied,
            pending: settlement.pending,
            highRiskPending: settlement.highRiskPending,
          } : {}),
          summary: result.summary.slice(0, 8_000),
          ...(result.error ? { error: result.error.slice(0, 200) } : {}),
          finishedAt: new Date().toISOString(),
        };
      } catch (error) {
        settle = {
          status: "failed",
          attempts: next.settle.attempts + 1,
          error: "settlement-threw",
          summary: `第${next.chapterNumber}章结算中断：${error instanceof Error ? error.message : String(error)}`.slice(0, 8_000),
          finishedAt: new Date().toISOString(),
        };
      }
      await updateJob(context, jobId, (current) => ({
        ...current,
        chapters: current.chapters.map((chapter) => chapter.index === next.index ? { ...chapter, settle } : chapter),
      }));
      processed += 1;
    }
  } catch (error) {
    await updateJob(context, jobId, (current) => ({
      ...current,
      settlement: {
        state: "paused",
        updatedAt: new Date().toISOString(),
        explanation: {
          whatHappened: `逐章事实中途停下：${error instanceof Error ? error.message : String(error)}`,
          whyItMatters: "已完成的章节结果都已保存；剩下的章还没有叙事记忆。",
          suggestedAction: "点「继续逐章事实」从未完成的章接着跑。",
        },
      },
    })).catch(() => undefined);
    throw error;
  }

  const after = await loadOwnedJob(context, jobId);
  const remaining = after.chapters.some((chapter) => chapter.settle.status === "pending");
  if (remaining) {
    return updateJob(context, jobId, (current) => ({ ...current, settlement: { state: "paused", updatedAt: new Date().toISOString() } }));
  }
  // 所有章都有了结果（成功、跳过或失败）：跑一次全书综合，生成导入报告。
  await synthesizeManuscriptImport(context, jobId);
  return loadOwnedJob(context, jobId);
}

// ─── 全书综合 ─────────────────────────────────────────────────────────────

/**
 * 全书综合：实体索引整本重建、伏笔因果补链，再汇总伏笔阶段、剧情线与待确认数，写进导入报告。
 * 只复用已有的重建与派生函数；没有模型、或部分章未结算时也能跑，报告如实列出未结算与失败的章。
 */
export async function synthesizeManuscriptImport(context: ManuscriptImportContext, jobId: string): Promise<ManuscriptImportView> {
  const job = await loadOwnedJob(context, jobId);
  requirePhase(job, ["written", "published"], "全书综合");
  const warnings: string[] = [];
  const storage = context.storage;
  ensureNarrativeMemorySchema(storage);

  let entityCount = 0;
  let relationCount = 0;
  try {
    const rebuilt = rebuildNarrativeEntityIndex(storage, context.bookId);
    if (rebuilt.ok) {
      entityCount = rebuilt.entities;
      relationCount = rebuilt.relations;
    } else {
      warnings.push(rebuilt.explanation);
    }
  } catch (error) {
    warnings.push(`实体索引重建失败（不影响已写入的章节与事实）：${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    backfillHookCausalLinks(storage, context.bookId);
  } catch (error) {
    warnings.push(`伏笔因果补链失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const chapterNumbers = job.chapters.map((chapter) => chapter.chapterNumber);
  const from = Math.min(...chapterNumbers);
  const to = Math.max(...chapterNumbers);

  // 人物草稿：导入的书通常一个人物条目都没有，实体索引因此恒为空。从已应用事件与出场名单统计候选人物，
  // 起草为待确认的经纬人物条目。确认前它们不进实体字典，上面的实体数只含作者已确认的条目。
  let stagedCharacters = 0;
  try {
    stagedCharacters = stageManuscriptCharacterDrafts(storage, context.bookId, { range: { from, to }, jobId }).length;
  } catch (error) {
    warnings.push(`人物草稿起草失败（不影响已写入的章节与事实）：${error instanceof Error ? error.message : String(error)}`);
  }
  let pendingCharacters: ReturnType<typeof listPendingManuscriptCharacterDrafts> = [];
  try {
    pendingCharacters = listPendingManuscriptCharacterDrafts(storage, context.bookId);
  } catch (error) {
    warnings.push(`人物草稿汇总失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const characterDrafts: NonNullable<ManuscriptImportReport["characterDrafts"]> = {
    pending: pendingCharacters.length,
    stagedThisRun: stagedCharacters,
    threshold: MIN_CHARACTER_DRAFT_OCCURRENCES,
    items: pendingCharacters.slice(0, 30).map((draft) => ({
      entryId: draft.entryId,
      title: draft.title.slice(0, 200),
      ...(draft.firstChapter !== null ? { firstChapter: draft.firstChapter } : {}),
      ...(draft.occurrences !== null ? { occurrences: draft.occurrences } : {}),
    })),
    explanation: pendingCharacters.length > 0
      ? {
          whatHappened: `从正文里统计到 ${pendingCharacters.length} 个反复出现的人物，已起草为待你确认的人物条目（出现 ${MIN_CHARACTER_DRAFT_OCCURRENCES} 次以上才起草，地点与势力没有起草）。`,
          whyItMatters: "实体图谱、关系图与场景校验只认已确认的人物条目；确认之前，这些人物的出场和事件都关联不上，图谱里看不到他们。",
          suggestedAction: "到「待确认 › 人物」逐个打开，把状态改为已确认；不是人物或不需要建档的直接删掉，之后不会再起草。确认后会自动回填历史出场并重建实体索引。",
        }
      : {
          whatHappened: stagedCharacters === 0 && entityCount === 0
            ? `没有出现 ${MIN_CHARACTER_DRAFT_OCCURRENCES} 次以上、且还没建档的人物，这次没有起草人物条目。`
            : "人物草稿都已处理完，没有待确认的人物。",
          whyItMatters: "实体图谱与场景校验只认已确认的人物条目。",
          suggestedAction: entityCount === 0
            ? "需要的话在「角色与设定」里手动建人物条目，建好后在「章后事实」里重建实体索引。"
            : "无需操作。",
        },
  };
  const eventRows = storage.sqlite.prepare<{ status: string; riskLevel: string; count: number }>(`
    SELECT status, risk_level AS riskLevel, COUNT(*) AS count
    FROM narrative_event
    WHERE book_id = ? AND chapter_number BETWEEN ? AND ?
    GROUP BY status, risk_level
  `).all(context.bookId, from, to);
  const eventCount = eventRows.reduce((sum, row) => sum + row.count, 0);
  const pendingEventCount = eventRows.filter((row) => row.status === "pending").reduce((sum, row) => sum + row.count, 0);
  const highRiskPendingCount = eventRows.filter((row) => row.status === "pending" && row.riskLevel === "high").reduce((sum, row) => sum + row.count, 0);

  let foreshadow: ManuscriptImportReport["foreshadow"] = { total: 0, byPhase: {}, items: [] };
  try {
    const states = loadForeshadowStates(storage, context.bookId);
    const byPhase: Record<string, number> = {};
    for (const state of states) byPhase[state.phase] = (byPhase[state.phase] ?? 0) + 1;
    foreshadow = {
      total: states.length,
      byPhase,
      items: states.slice(0, 30).map((state) => ({
        label: state.label.slice(0, 200),
        phase: state.phase,
        ...(state.setupChapter !== undefined ? { setupChapter: state.setupChapter } : {}),
      })),
    };
  } catch (error) {
    warnings.push(`伏笔汇总失败：${error instanceof Error ? error.message : String(error)}`);
  }

  let storylines: ManuscriptImportReport["storylines"] = [];
  try {
    storylines = listStorylines(storage, context.bookId).slice(0, 50).map((line) => ({ id: line.id, name: line.name, kind: line.kind }));
  } catch (error) {
    warnings.push(`剧情线汇总失败：${error instanceof Error ? error.message : String(error)}`);
  }

  let pendingReviewTotal = pendingEventCount;
  try {
    const pending = await collectPendingReview({ storage, bookId: context.bookId, resolveBookRoot: () => context.bookRoot });
    pendingReviewTotal = pending.total;
  } catch (error) {
    warnings.push(`待确认汇总失败，下面的待确认数只含待审事件：${error instanceof Error ? error.message : String(error)}`);
  }

  const settled = job.chapters.filter((chapter) => chapter.settle.status === "done" || chapter.settle.status === "skipped");
  const failed = job.chapters.filter((chapter) => chapter.settle.status === "failed");
  const unsettled = job.chapters.filter((chapter) => chapter.settle.status === "pending" || chapter.settle.status === "running");
  if (unsettled.length > 0) {
    warnings.push(`还有 ${unsettled.length} 章没有跑逐章事实，这些章没有叙事记忆；配好模型后可回导入页继续。`);
  }
  if (storylines.length === 0) {
    warnings.push("剧情线由作者在「故事推进」里建立，导入不会自动生成；可在导入后按卷或主线建线并挂场景。");
  }

  const report: ManuscriptImportReport = {
    generatedAt: new Date().toISOString(),
    chapterCount: job.chapters.length,
    settledChapters: settled.length,
    unsettledChapters: unsettled.map((chapter) => chapter.chapterNumber),
    failedChapters: failed.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      reason: (chapter.settle.summary ?? chapter.settle.error ?? "未知原因").slice(0, 8_000),
    })),
    eventCount,
    pendingEventCount,
    highRiskPendingCount,
    pendingReviewTotal,
    entityCount,
    relationCount,
    foreshadow,
    storylines,
    characterDrafts,
    warnings: warnings.slice(0, 50).map((warning) => warning.slice(0, 4_000)),
  };
  await updateJob(context, jobId, (current) => ({
    ...current,
    report,
    settlement: unsettled.length === 0
      ? { state: "done", updatedAt: new Date().toISOString() }
      : current.settlement,
  }));
  return readManuscriptImport(context, jobId);
}

// ─── 发布 ────────────────────────────────────────────────────────────────

/**
 * 「完成导入」：任务转为 published，书从「导入中」变为可写（去掉 book.json 的导入标记）。
 * 逐章事实没跑完也可以发布：作者可以先开写，之后在导入页或「记忆过期的章节」里补结算。
 */
export async function publishManuscriptImport(context: ManuscriptImportContext, jobId: string): Promise<ManuscriptImportView> {
  const running = isManuscriptSettlementRunning(context, jobId);
  if (running) {
    fail("MANUSCRIPT_IMPORT_BUSY", {
      whatHappened: "逐章事实还在进行中。",
      whyItMatters: "现在完成导入，报告里的数字会是半途的。",
      suggestedAction: "等进度跑完再点「完成导入」。",
    });
  }
  await withManuscriptJobLock(context.bookRoot, jobId, async () => {
    const job = await loadOwnedJob(context, jobId);
    requirePhase(job, ["written", "published"], "完成导入");
    if (job.phase === "published") return;
    await saveManuscriptImportJob(context.bookRoot, { ...job, phase: "published", publishedAt: new Date().toISOString() });
  });
  if (!(await loadOwnedJob(context, jobId)).report) {
    await synthesizeManuscriptImport(context, jobId);
  }
  await updateBookConfig(context.bookRoot, (current) => {
    if (!current || current[MANUSCRIPT_IMPORT_BOOK_MARKER] !== jobId) return null;
    const { [MANUSCRIPT_IMPORT_BOOK_MARKER]: _removed, ...rest } = current;
    return { ...rest, ...(rest.status === "incubating" || rest.status === "outlining" ? { status: "active" } : {}), updatedAt: new Date().toISOString() };
  });
  return readManuscriptImport(context, jobId);
}

/** 书是否正处于旧稿导入中（未发布）；书架与工作台据此提示回导入页。 */
export async function readPendingManuscriptImport(bookRoot: string): Promise<string | null> {
  const config = await readBookConfigFile(bookRoot).catch(() => null);
  const value = config?.[MANUSCRIPT_IMPORT_BOOK_MARKER];
  return typeof value === "string" && value.trim() ? value : null;
}
