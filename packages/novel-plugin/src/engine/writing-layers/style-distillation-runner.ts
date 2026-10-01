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
import { extractStyleRulesFromBatch, type StyleBatchExtraction } from "./style-distillation-model.js";
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

// 同一进程内每个任务只允许一个运行者；读改写按任务串行，避免批次结果与采纳互相覆盖。
const activeRunners = new Map<string, symbol>();
const jobWrites = new Map<string, Promise<void>>();

export function isStyleDistillationActive(bookRoot: string, jobId: string): boolean {
  return activeRunners.has(taskKey(bookRoot, jobId));
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

/** 读取任务的对外视图：进程重启或中断后残留的 running 状态按「已暂停、可恢复」呈现。 */
export async function readStyleDistillationJob(bookRoot: string, jobId: string): Promise<StyleDistillationJob> {
  const job = await loadStyleDistillationJob(bookRoot, jobId);
  return settleStyleDistillationJobState(job, isStyleDistillationActive(bookRoot, jobId));
}

export interface StyleDistillationRunSummary {
  readonly total: number;
  readonly pending: number;
  readonly done: number;
  readonly failed: number;
  readonly failures: readonly { readonly batchId: string; readonly chapterNumbers: readonly number[]; readonly explanation: StyleDistillationBatch["explanation"] }[];
}

export function summarizeStyleDistillationBatches(job: StyleDistillationJob): StyleDistillationRunSummary {
  const count = (status: StyleDistillationBatch["status"]) => job.batches.filter((batch) => batch.status === status).length;
  return {
    total: job.batches.length,
    pending: count("pending") + count("running"),
    done: count("done"),
    failed: count("failed"),
    failures: job.batches
      .filter((batch) => batch.status === "failed")
      .map((batch) => ({ batchId: batch.id, chapterNumbers: batch.chapterNumbers, explanation: batch.explanation })),
  };
}

/** 新建任务：先落来源快照，再落任务文件；此时只有确定性基线，模型批次全部待处理。 */
export async function createStyleDistillationJob(input: {
  readonly bookRoot: string;
  readonly bookId: string;
  readonly source: StyleDistillationSourceInput;
  readonly modelAvailable: boolean;
}): Promise<StyleDistillationJob> {
  const jobId = newStyleDistillationJobId();
  const { job, chapters } = makeInitialStyleDistillationJob(input.bookId, jobId, input.source, input.modelAvailable);
  await saveStyleDistillationSourceSnapshot(input.bookRoot, jobId, job.sourceFingerprint, chapters);
  return saveStyleDistillationJob(input.bookRoot, job);
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
      return { ...batch, status: "failed" as const, ruleIds: [], issues: [], explanation: result.explanation, finishedAt };
    }
    return batch;
  });
  if (!result.ok) return { ...job, batches };

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
        explanation: undefined,
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
  readonly onProgress?: (job: StyleDistillationJob, batch: StyleDistillationBatch) => void;
}

export interface StyleDistillationRunResult {
  readonly job: StyleDistillationJob;
  readonly processedBatchIds: readonly string[];
  readonly summary: StyleDistillationRunSummary;
}

/**
 * 从未完成批次继续执行。调用时同步登记运行者，所以 HTTP 可以不等待它结束就返回 running 状态；
 * 同一任务已有运行者时直接拒绝，不并发写同一个任务文件。
 */
export function runStyleDistillationBatches(options: RunStyleDistillationOptions): Promise<StyleDistillationRunResult> {
  const key = taskKey(options.bookRoot, options.jobId);
  if (activeRunners.has(key)) {
    return Promise.reject(new StyleDistillationError("该文风蒸馏任务正在处理中，请等待当前批次完成。", "STYLE_DISTILLATION_BUSY"));
  }
  const token = Symbol(options.jobId);
  activeRunners.set(key, token);
  return runBatches(options).finally(() => {
    if (activeRunners.get(key) === token) activeRunners.delete(key);
  }).then(async (processed) => {
    // 运行者注销后再结算一次状态：未完成批次变为 paused，全部结束变为 ready/adopted。
    const job = await updateJob(options.bookRoot, options.jobId, (current) => settleStyleDistillationJobState(current, false));
    return { job, processedBatchIds: processed, summary: summarizeStyleDistillationBatches(job) };
  }, async (error: unknown) => {
    await updateJob(options.bookRoot, options.jobId, (current) => settleStyleDistillationJobState(current, false)).catch(() => undefined);
    throw error;
  });
}

async function runBatches(options: RunStyleDistillationOptions): Promise<string[]> {
  const { bookRoot, jobId } = options;
  const initial = await loadStyleDistillationJob(bookRoot, jobId);
  const chapters = await loadStyleDistillationSourceSnapshot(bookRoot, initial);
  const byNumber = new Map<number, DistillableChapter>(chapters.map((chapter) => [chapter.number, chapter]));
  await updateJob(bookRoot, jobId, (job) => settleStyleDistillationJobState({
    ...job,
    batches: job.batches.map((batch) => {
      if (batch.status === "running") return { ...batch, status: "pending" as const };
      if (options.retryFailed && batch.status === "failed") return { ...batch, status: "pending" as const, explanation: undefined };
      return batch;
    }),
  }, true));

  const limit = options.maxBatches === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.trunc(options.maxBatches));
  const processed: string[] = [];
  while (processed.length < limit) {
    const job = await loadStyleDistillationJob(bookRoot, jobId);
    const next = job.batches.find((batch) => batch.status === "pending" && !processed.includes(batch.id));
    if (!next) break;
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
      isStyleDistillationActive(input.bookRoot, input.jobId),
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
