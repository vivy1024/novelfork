import { resolve } from "node:path";

import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";
import {
  loadStyleDistillationJob,
  loadStyleDistillationSourceSnapshot,
  makeInitialStyleDistillationJob,
  MAX_STYLE_DISTILLATION_RULES,
  newStyleDistillationJobId,
  saveStyleDistillationJob,
  saveStyleDistillationSourceSnapshot,
  settleStyleDistillationJobState,
  StyleDistillationError,
  StyleDistillationJobSchema,
  type DistillableChapter,
  type StyleDistillationBatch,
  type StyleDistillationJob,
  type StyleDistillationRule,
  type StyleDistillationSourceInput,
} from "./style-distillation.js";
import { assessStyleBatchEvidence, extractStyleRulesFromBatch, type StyleBatchExtraction } from "./style-distillation-model.js";
import {
  acquireStyleDistillationLock,
  inspectStyleDistillationLock,
  type StyleDistillationLockHandle,
  type StyleDistillationLockOwner,
} from "./style-distillation-lock.js";
import { createStylePreset, type StylePreset } from "./style-preset.js";
import { loadStylePreset, saveStylePreset, StylePresetError, type LoadedStylePreset } from "./style-preset-store.js";

/**
 * 文风蒸馏任务的唯一执行入口：叙述者工具与 HTTP 路由共用同一份任务文件、来源快照、
 * 批次状态与采纳函数。模型能力由调用方注入（Runtime 会话 generateText 或宿主已有服务端模型路径），
 * 这里不自建 HTTP 客户端，也不做任何 Agent 循环。
 */

function taskKey(bookRoot: string, jobId: string): string {
  const absolute = resolve(bookRoot);
  return `${process.platform === "win32" ? absolute.toLowerCase() : absolute}::${jobId}`;
}

// 同一进程内每个任务只允许一个运行者（同步登记，HTTP 可立即返回 running）；
// 跨进程由任务运行锁（style-distillation-lock.ts）兜底。读改写按任务串行，避免批次结果与采纳互相覆盖。
const activeRunners = new Map<string, symbol>();
const jobWrites = new Map<string, Promise<void>>();

/** 本进程是否有运行者在处理该任务。 */
export function isStyleDistillationActive(bookRoot: string, jobId: string): boolean {
  return activeRunners.has(taskKey(bookRoot, jobId));
}

/** 本进程或本机/他机另一个进程是否有活着的执行者持有该任务。 */
export async function hasLiveStyleDistillationRunner(bookRoot: string, jobId: string): Promise<boolean> {
  if (isStyleDistillationActive(bookRoot, jobId)) return true;
  return (await inspectStyleDistillationLock(bookRoot, jobId)).kind !== "none";
}

function busyMessage(owner: Exclude<StyleDistillationLockOwner, { kind: "none" }>): string {
  if (owner.kind === "other-host") return `该文风蒸馏任务正由另一台电脑「${owner.host}」处理，请在那边完成或关闭后再继续。`;
  return "该文风蒸馏任务正在处理中，请等待当前批次完成。";
}

async function withJobWrite<T>(bookRoot: string, jobId: string, operation: () => Promise<T>): Promise<T> {
  const key = taskKey(bookRoot, jobId);
  const previous = jobWrites.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const tail = previous.then(() => gate);
  jobWrites.set(key, tail);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (jobWrites.get(key) === tail) jobWrites.delete(key);
  }
}

async function updateJob(
  bookRoot: string,
  jobId: string,
  mutate: (job: StyleDistillationJob) => StyleDistillationJob,
): Promise<StyleDistillationJob> {
  return withJobWrite(bookRoot, jobId, async () => {
    const current = await loadStyleDistillationJob(bookRoot, jobId);
    const next = mutate(current);
    return saveStyleDistillationJob(bookRoot, { ...next, updatedAt: new Date().toISOString() });
  });
}

/**
 * 读取任务的对外视图：没有活着的执行者时，残留的 running 状态按「已暂停、可恢复」呈现；
 * 另一个进程正在跑时照实显示 running。
 */
export async function readStyleDistillationJob(bookRoot: string, jobId: string): Promise<StyleDistillationJob> {
  const job = await loadStyleDistillationJob(bookRoot, jobId);
  return settleStyleDistillationJobState(job, await hasLiveStyleDistillationRunner(bookRoot, jobId));
}

export interface StyleDistillationRunSummary {
  readonly total: number;
  readonly pending: number;
  readonly done: number;
  readonly failed: number;
  readonly failures: readonly { readonly batchId: string; readonly chapterNumbers: readonly number[]; readonly explanation: StyleDistillationBatch["explanation"] }[];
  /** 已结束批次里因证据未在原文找到而被丢弃的模型规则总数。 */
  readonly rejectedRuleCount: number;
  /** 已完成但需要作者关注的批次（如过半规则因证据被丢弃）；失败批次见 failures。 */
  readonly warnings: readonly { readonly batchId: string; readonly chapterNumbers: readonly number[]; readonly explanation: StyleDistillationBatch["explanation"] }[];
  /** 有被丢弃规则时的汇总说明，供界面与叙述者直接展示。 */
  readonly rejectedExplanation?: { readonly what: string; readonly why: string; readonly next: string };
}

export function summarizeStyleDistillationBatches(job: StyleDistillationJob): StyleDistillationRunSummary {
  const count = (status: StyleDistillationBatch["status"]) => job.batches.filter((batch) => batch.status === status).length;
  const rejectedRuleCount = job.batches.reduce((sum, batch) => sum + (batch.rejectedRules?.length ?? 0), 0);
  const rejectedBatches = job.batches.filter((batch) => (batch.rejectedRules?.length ?? 0) > 0).length;
  return {
    total: job.batches.length,
    pending: count("pending") + count("running"),
    done: count("done"),
    failed: count("failed"),
    failures: job.batches
      .filter((batch) => batch.status === "failed")
      .map((batch) => ({ batchId: batch.id, chapterNumbers: batch.chapterNumbers, explanation: batch.explanation })),
    rejectedRuleCount,
    warnings: job.batches
      .filter((batch) => batch.status === "done" && batch.explanation)
      .map((batch) => ({ batchId: batch.id, chapterNumbers: batch.chapterNumbers, explanation: batch.explanation })),
    ...(rejectedRuleCount > 0
      ? {
        rejectedExplanation: {
          what: `${rejectedRuleCount} 条模型规则因证据未在原文找到被丢弃（涉及 ${rejectedBatches} 批）。`,
          why: "证据对不上原文的规则可能是模型改写或编造，不进入审阅；被丢弃的条目与原因保存在对应批次里。",
          next: "在模型批次里展开「被丢弃的规则」核对；整批被丢弃的批次已标为失败，可重试失败批次。",
        },
      }
      : {}),
  };
}

/** 新建任务：先落来源快照，再落任务文件；此时只有确定性基线，模型批次全部待处理。 */
export async function createStyleDistillationJob(input: {
  readonly bookRoot: string;
  readonly bookId: string;
  readonly source: StyleDistillationSourceInput;
  readonly modelAvailable: boolean;
  /** 新建任务的用户（宿主用户 id）；之后的自动续跑只替他续跑。 */
  readonly initiatorId?: string;
}): Promise<StyleDistillationJob> {
  const jobId = newStyleDistillationJobId();
  const { job, chapters } = makeInitialStyleDistillationJob(input.bookId, jobId, input.source, input.modelAvailable);
  await saveStyleDistillationSourceSnapshot(input.bookRoot, jobId, job.sourceFingerprint, chapters);
  const initiatorId = input.initiatorId?.trim().slice(0, 200);
  return saveStyleDistillationJob(input.bookRoot, initiatorId ? { ...job, initiatorId } : job);
}

/** 规则去重口径：忽略空白、标点与大小写；预设内所有来源的规则去重共用这一实现。 */
export function normalizedRuleKey(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

/** 把一批模型结果并入任务：去重、分配 ID、守住规则上限，全部理由写进批次 issues。 */
function applyBatchResult(
  job: StyleDistillationJob,
  batchId: string,
  result: StyleBatchExtraction,
): StyleDistillationJob {
  const finishedAt = new Date().toISOString();
  const batches = job.batches.map((batch) => {
    if (batch.id !== batchId) return batch;
    if (!result.ok) {
      return { ...batch, status: "failed" as const, ruleIds: [], issues: [], rejectedRules: undefined, explanation: result.explanation, finishedAt };
    }
    return batch;
  });
  if (!result.ok) return { ...job, batches };

  const rejectedRules = (result.rejected ?? []).slice(0, 20).map((rule) => ({
    category: rule.category,
    text: rule.text.slice(0, 4_000),
    evidence: rule.evidence.slice(0, 4_000),
    reason: rule.reason.slice(0, 4_000),
  }));
  const assessment = assessStyleBatchEvidence(result.rules.length, result.rejected?.length ?? 0);
  if (assessment.level === "failed") {
    // 模型规则全部因证据被丢弃：不能当成正常完成；保留被丢弃条目与原因供审阅，可重试本批。
    return {
      ...job,
      batches: batches.map((batch) => batch.id === batchId
        ? {
          ...batch,
          status: "failed" as const,
          ruleIds: [],
          issues: result.issues.slice(0, 30).map((issue) => issue.slice(0, 4_000)),
          rejectedRules,
          explanation: assessment.explanation,
          finishedAt,
        }
        : batch),
    };
  }

  const existing = new Set(job.rules.map((rule) => normalizedRuleKey(rule.text)));
  const rules: StyleDistillationRule[] = [...job.rules];
  const issues = [...result.issues];
  const ruleIds: string[] = [];
  result.rules.forEach((extracted, index) => {
    const key = normalizedRuleKey(extracted.text);
    if (existing.has(key)) {
      issues.push(`「${extracted.text.slice(0, 60)}」与已有规则重复，已合并到先出现的那条。`);
      return;
    }
    if (rules.length >= MAX_STYLE_DISTILLATION_RULES) {
      issues.push(`来源包规则已达 ${MAX_STYLE_DISTILLATION_RULES} 条上限，「${extracted.text.slice(0, 60)}」未收录。`);
      return;
    }
    existing.add(key);
    const id = `model-${batchId.slice("batch-".length)}-${String(index + 1).padStart(2, "0")}`;
    ruleIds.push(id);
    rules.push({
      id,
      text: extracted.text,
      evidence: extracted.evidence,
      transfer: extracted.transfer,
      // 机器抽取产物一律待审，作者确认后才可采纳。
      status: "needs-review",
      category: extracted.category,
      origin: "model",
      batchId,
      reason: extracted.reason,
    });
  });
  return {
    ...job,
    rules,
    batches: batches.map((batch) => batch.id === batchId
      ? {
        ...batch,
        status: "done" as const,
        ruleIds,
        issues: issues.slice(0, 30).map((issue) => issue.slice(0, 4_000)),
        rejectedRules: rejectedRules.length > 0 ? rejectedRules : undefined,
        // done 批次的 explanation 只用于「需要关注」的提醒（过半规则因证据被丢弃）。
        explanation: assessment.level === "warning" ? assessment.explanation : undefined,
        finishedAt,
      }
      : batch),
  };
}

export interface RunStyleDistillationOptions {
  readonly bookRoot: string;
  readonly jobId: string;
  readonly generateText: RuntimeTextGenerator;
  /** 本次最多处理几批；缺省处理全部待处理批次。 */
  readonly maxBatches?: number;
  /** 把失败批次重新排回待处理。 */
  readonly retryFailed?: boolean;
  /**
   * 进程重启后的自动续跑（style-distillation-auto-resume.ts）：拿到运行锁后先把连续未完成次数加一并落盘，
   * 跑完清零。缺省为作者 / 叙述者手动继续：清掉自动续跑记录，失败状态的任务重新开放。
   */
  readonly autoResume?: boolean;
  /**
   * 这次启动 / 继续批次的用户（宿主用户 id，模型用量计到他名下）。手动继续时写进任务的 initiatorId，
   * 之后进程重启的自动续跑只替这个人续跑。没有登录身份的入口（叙述者工具）不传，任务上原有的发起人保持不变。
   */
  readonly initiatorId?: string;
  readonly onProgress?: (job: StyleDistillationJob, batch: StyleDistillationBatch) => void;
}

export interface StyleDistillationRunResult {
  readonly job: StyleDistillationJob;
  readonly processedBatchIds: readonly string[];
  readonly summary: StyleDistillationRunSummary;
}

/**
 * 从未完成批次继续执行。调用时同步登记本进程运行者，所以 HTTP 可以不等待它结束就返回 running 状态；
 * 随后获取跨进程运行锁。同一任务已有运行者（本进程或别的进程）时直接拒绝，不并发写同一个任务文件。
 */
export function runStyleDistillationBatches(options: RunStyleDistillationOptions): Promise<StyleDistillationRunResult> {
  const key = taskKey(options.bookRoot, options.jobId);
  if (activeRunners.has(key)) {
    return Promise.reject(new StyleDistillationError("该文风蒸馏任务正在处理中，请等待当前批次完成。", "STYLE_DISTILLATION_BUSY"));
  }
  const token = Symbol(options.jobId);
  activeRunners.set(key, token);
  const { bookRoot, jobId } = options;
  const execute = async (): Promise<StyleDistillationRunResult> => {
    const acquired = await acquireStyleDistillationLock(bookRoot, jobId);
    // 没拿到锁：别的进程正在执行，本次不碰任务文件（不结算状态，免得把对方的 running 改成 paused）。
    if (!acquired.ok) throw new StyleDistillationError(busyMessage(acquired.owner), "STYLE_DISTILLATION_BUSY");
    try {
      let processed: string[];
      try {
        processed = await runBatches(options, acquired.handle);
      } catch (error) {
        await updateJob(bookRoot, jobId, (current) => settleStyleDistillationJobState(current, false)).catch(() => undefined);
        throw error;
      }
      // 释放运行锁之前结算：未完成批次变为 paused，全部结束变为 ready/adopted；自动续跑完整跑完则清零计数。
      const job = await updateJob(bookRoot, jobId, (current) => settleStyleDistillationJobState(
        options.autoResume ? { ...current, autoResume: undefined } : current,
        false,
      ));
      return { job, processedBatchIds: processed, summary: summarizeStyleDistillationBatches(job) };
    } finally {
      await acquired.handle.release();
    }
  };
  return execute().finally(() => {
    if (activeRunners.get(key) === token) activeRunners.delete(key);
  });
}

async function runBatches(options: RunStyleDistillationOptions, lock: StyleDistillationLockHandle): Promise<string[]> {
  const { bookRoot, jobId } = options;
  const initial = await loadStyleDistillationJob(bookRoot, jobId);
  const chapters = await loadStyleDistillationSourceSnapshot(bookRoot, initial);
  const byNumber = new Map<number, DistillableChapter>(chapters.map((chapter) => [chapter.number, chapter]));
  const attemptAt = new Date().toISOString();
  await updateJob(bookRoot, jobId, (job) => settleStyleDistillationJobState({
    ...job,
    // 手动继续会重新开放自动续跑判为 failed 的任务，并清掉自动续跑记录；
    // 自动续跑先记一次「未完成」：进程在本次中途退出，下次启动能据此累计并在达到上限时停下。
    ...(options.autoResume
      ? { autoResume: { failures: (job.autoResume?.failures ?? 0) + 1, lastAttemptAt: attemptAt } }
      : { autoResume: undefined, status: job.status === "failed" ? "paused" as const : job.status }),
    ...(!options.autoResume && options.initiatorId?.trim() ? { initiatorId: options.initiatorId.trim().slice(0, 200) } : {}),
    batches: job.batches.map((batch) => {
      if (batch.status === "running") return { ...batch, status: "pending" as const };
      if (options.retryFailed && batch.status === "failed") {
        return { ...batch, status: "pending" as const, explanation: undefined, rejectedRules: undefined };
      }
      return batch;
    }),
  }, true));

  const limit = options.maxBatches === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.trunc(options.maxBatches));
  const processed: string[] = [];
  while (processed.length < limit) {
    const job = await loadStyleDistillationJob(bookRoot, jobId);
    const next = job.batches.find((batch) => batch.status === "pending" && !processed.includes(batch.id));
    if (!next) break;
    // 每批开始前刷新运行锁心跳；锁已被别人接管（本进程被判陈旧）就立即停下，不再写任务文件。
    if (!(await lock.heartbeat())) {
      throw new StyleDistillationError("该文风蒸馏任务的运行锁已被另一个执行者接管，本次执行已停止。", "STYLE_DISTILLATION_BUSY");
    }
    const startedAt = new Date().toISOString();
    await updateJob(bookRoot, jobId, (current) => settleStyleDistillationJobState({
      ...current,
      batches: current.batches.map((batch) => batch.id === next.id
        ? { ...batch, status: "running" as const, attempts: batch.attempts + 1, startedAt, finishedAt: undefined }
        : batch),
    }, true));
    const batchChapters = next.chapterNumbers
      .map((number) => byNumber.get(number))
      .filter((chapter): chapter is DistillableChapter => chapter !== undefined);
    const result: StyleBatchExtraction = batchChapters.length === next.chapterNumbers.length
      ? await extractStyleRulesFromBatch({ generateText: options.generateText, sourceName: job.sourceName, chapters: batchChapters })
      : {
        ok: false,
        explanation: {
          what: "来源快照缺少本批章节。",
          why: "批次计划与来源快照不一致，继续抽取会拿错文本。",
          next: "重新提交参考文本新建任务。",
        },
      };
    const updated = await updateJob(bookRoot, jobId, (current) => settleStyleDistillationJobState(applyBatchResult(current, next.id, result), true));
    processed.push(next.id);
    const batch = updated.batches.find((item) => item.id === next.id);
    if (batch) options.onProgress?.(updated, batch);
  }
  return processed;
}

export interface AdoptStyleDistillationInput {
  readonly bookRoot: string;
  readonly jobId: string;
  readonly ruleIds: readonly string[];
  readonly sampleIds: readonly string[];
  /** 读取预设时的版本；本书还没有预设时为 null。 */
  readonly expectedRevision: string | null;
}

export interface AdoptStyleDistillationResult {
  readonly preset: LoadedStylePreset;
  readonly job: StyleDistillationJob;
  /** 进入本书文风指南的条数（已确认且可迁移）。 */
  readonly guideRuleCount: number;
  /** 只保存为来源证据、不进入指南的作品专属条数。 */
  readonly sourceOnlyCount: number;
}

/**
 * 采纳：只把作者点名确认的条目写进来源包；作品专属条目只存证据，不进指南（composeStyleGuide 过滤）。
 * 版本不符抛 STYLE_PRESET_CONFLICT；未知条目 ID 拒绝而不是忽略。
 */
export async function adoptStyleDistillation(input: AdoptStyleDistillationInput): Promise<AdoptStyleDistillationResult> {
  return withJobWrite(input.bookRoot, input.jobId, async () => {
    const job = settleStyleDistillationJobState(
      await loadStyleDistillationJob(input.bookRoot, input.jobId),
      await hasLiveStyleDistillationRunner(input.bookRoot, input.jobId),
    );
    if (job.status === "running") {
      throw new StyleDistillationError("模型批次仍在处理中，请等待本批完成或暂停后再采纳。", "STYLE_DISTILLATION_BUSY");
    }
    const ruleIds = [...new Set(input.ruleIds)];
    const sampleIds = [...new Set(input.sampleIds)];
    const knownRules = new Set(job.rules.map((rule) => rule.id));
    const knownSamples = new Set(job.samples.map((sample) => sample.id));
    const unknown = [
      ...ruleIds.filter((id) => !knownRules.has(id)),
      ...sampleIds.filter((id) => !knownSamples.has(id)),
    ];
    if (unknown.length > 0) {
      throw new StyleDistillationError(`以下条目不属于该任务：${unknown.slice(0, 10).join("、")}。`, "STYLE_DISTILLATION_INVALID_INPUT");
    }
    const current = await loadStylePreset(input.bookRoot);
    if (input.expectedRevision !== current.revision) {
      throw new StylePresetError("本书文风预设已被更新；请重新读取当前版本后再采纳。", "STYLE_PRESET_CONFLICT");
    }
    const source = {
      id: job.sourceId,
      title: job.sourceName,
      rules: job.rules
        .filter((rule) => ruleIds.includes(rule.id))
        .map((rule) => ({ text: rule.text, evidence: rule.evidence, transfer: rule.transfer, status: "confirmed" as const })),
      samples: job.samples
        .filter((sample) => sampleIds.includes(sample.id))
        .map((sample) => ({ ...sample, status: "confirmed" as const })),
    } satisfies StylePreset["sources"][number];
    const existing = current.preset ?? createStylePreset();
    const preset = await saveStylePreset(input.bookRoot, {
      ...existing,
      sources: [...existing.sources.filter((item) => item.id !== source.id), source],
      fingerprint: job.fingerprint ?? existing.fingerprint,
    }, input.expectedRevision);
    const adoptedAt = new Date().toISOString();
    const adopted = await saveStyleDistillationJob(input.bookRoot, StyleDistillationJobSchema.parse(settleStyleDistillationJobState({
      ...job,
      updatedAt: adoptedAt,
      adoption: { ruleIds, sampleIds, presetRevision: preset.revision!, adoptedAt },
    }, false)));
    const all = [...source.rules, ...source.samples];
    return {
      preset,
      job: adopted,
      guideRuleCount: source.rules.filter((rule) => rule.transfer === "transferable").length,
      sourceOnlyCount: all.filter((item) => item.transfer === "source-only").length,
    };
  });
}
