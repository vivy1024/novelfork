import { basename } from "node:path";
import type { RuntimeToolResult, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";
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
  StyleDistillationError,
  STYLE_RULE_CATEGORY_LABELS,
  type StyleDistillationJob,
  type StyleDistillationSourceInput,
} from "../engine/writing-layers/style-distillation.js";
import {
  adoptStyleDistillation,
  createStyleDistillationJob,
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

/** 一次工具调用默认处理的模型批次数；剩余批次由叙述者带 jobId 再次调用继续。 */
export const STYLE_DISTILL_TOOL_DEFAULT_BATCHES = 3;
export const STYLE_DISTILL_TOOL_MAX_BATCHES = 10;

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

function batchLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return STYLE_DISTILL_TOOL_DEFAULT_BATCHES;
  return Math.min(STYLE_DISTILL_TOOL_MAX_BATCHES, Math.max(1, Math.trunc(value)));
}

/** 给模型看的精简视图：规则带类别、证据与迁移判断；采纳时按 id 点名。 */
function modelView(job: StyleDistillationJob, revision: string | null) {
  const summary = summarizeStyleDistillationBatches(job);
  return {
    job,
    batches: summary,
    reviewItems: {
      rules: job.rules.map((rule) => ({
        id: rule.id,
        category: STYLE_RULE_CATEGORY_LABELS[rule.category ?? "general"],
        text: rule.text,
        evidence: rule.evidence,
        transfer: rule.transfer === "transferable" ? "可迁移" : "作品专属",
        status: rule.status,
        origin: rule.origin ?? "baseline",
        ...(rule.origin === "model" ? { confidence: rule.confidence ?? "high" } : {}),
      })),
      // 可迁移、证据逐字吻合的模型规则；作者同意「全部采纳推荐」时把这些 id 传给 style.distill_adopt。
      recommendedRuleIds: recommendedStyleDistillationRuleIds(job),
      samples: job.samples.map((sample) => ({
        id: sample.id,
        sceneType: sample.sceneType,
        ...(sample.registerTag ? { registerTag: sample.registerTag } : {}),
        text: sample.text,
        evidence: sample.evidence,
        transfer: sample.transfer === "transferable" ? "可迁移" : "作品专属",
      })),
    },
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
    next: "配置会话模型后，再次调用 style.distill_start 并传入 jobId 继续。",
  };
}

function toolError(error: unknown): RuntimeToolResult | null {
  if (error instanceof BookTextFileError) {
    return fail(error.code, error.message, {
      explanation: {
        what: error.message,
        why: "参考文件只允许读取本书目录内不超过 60 MB 的普通文本文件，禁止跨目录或读取内部数据。",
        next: "可先调用 style.distill_index（listFilesOnly=true）查看本书目录下可用的参考文件。",
      },
    });
  }
  if (error instanceof StyleDistillationError) {
    return fail(error.code, error.message, {
      explanation: {
        what: error.message,
        why: "文风蒸馏任务状态必须与来源快照一致，不能跳过校验或并发写入。",
        next: error.code === "STYLE_DISTILLATION_BUSY" ? "稍后用 style.distill_status 查看进度。" : "按提示修正输入，或重新提交参考文本新建任务。",
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
        next: "先用 style.distill_status 取得最新 expectedVersion，向作者确认要采纳的条目后再调用 style.distill_adopt。",
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
    `已建立「${sourceName}」机械索引：共 ${index.chapterCount} 章、${index.totalCharCount} 字（${encoding}），推荐抽样 ${index.recommendedChapters.chapterNumbers.length} 章。可直接将 recommendedChapters.chapterNumbers 作为 chapterList 传给 style.distill_preview 或 style.distill_start。`,
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

async function start(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const generateText = context.generateText;
  const existingJobId = typeof input.jobId === "string" && input.jobId.trim() ? input.jobId.trim() : null;
  const job = existingJobId
    ? await readStyleDistillationJob(binding.root, existingJobId)
    : await createStyleDistillationJob({
      bookRoot: binding.root,
      bookId: binding.bookId,
      source: await resolveStyleDistillationInput(binding.root, sourceInput(input)),
      modelAvailable: Boolean(generateText),
    });
  if (job.bookId !== binding.bookId) return fail("STYLE_DISTILLATION_NOT_FOUND", "该蒸馏任务不属于当前书籍。");

  if (!generateText) {
    const revision = (await loadStylePreset(binding.root)).revision;
    return ok(
      existingJobId
        ? "当前会话没有可用模型，未继续模型批次。"
        : "已保存来源包的确定性基线；当前会话没有可用模型，模型批次待处理。",
      { ...modelView(job, revision), explanation: modelUnavailable() },
    );
  }

  const run = await runStyleDistillationBatches({
    bookRoot: binding.root,
    jobId: job.jobId,
    generateText,
    maxBatches: batchLimit(input.maxBatches),
    retryFailed: input.retryFailed === true,
    onProgress: (current, batch) => context.emitOutput?.(
      `文风蒸馏 ${batch.id}（第 ${batch.chapterNumbers[0]}–${batch.chapterNumbers.at(-1)} 章）：${batch.status === "done" ? `完成，新增 ${batch.ruleIds.length} 条待审规则` : `失败，${batch.explanation?.what ?? "原因未知"}`}；${progressLine(current)}。`,
    ),
  });
  const revision = (await loadStylePreset(binding.root)).revision;
  const remaining = run.summary.pending > 0
    ? `还有 ${run.summary.pending} 批待处理，可再次调用 style.distill_start 并传入 jobId 继续。`
    : run.summary.failed > 0
      ? "有失败批次，可带 jobId 与 retryFailed=true 重试。"
      : "全部批次已结束，请作者逐条审阅后再采纳。";
  return ok(`本次处理 ${run.processedBatchIds.length} 批；${progressLine(run.job)}。${remaining}`, modelView(run.job, revision));
}

async function adopt(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  if (typeof input.jobId !== "string" || !input.jobId.trim()) return fail("job-id-required", "style.distill_adopt 需要 jobId。");
  if (!Object.hasOwn(input, "expectedVersion") || (input.expectedVersion !== null && typeof input.expectedVersion !== "string")) {
    return fail("expected-version-required", "style.distill_adopt 需要 expectedVersion（取自 style.distill_status；本书尚无预设时传空字符串）。");
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
  const result = await adoptStyleDistillation({
    bookRoot: binding.root,
    jobId: job.jobId,
    ruleIds,
    sampleIds,
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
      const sourceIn = await resolveStyleDistillationInput(binding.root, sourceInput(input));
      const source = makePreviewSource(sourceIn);
      // 与网页预览同一份估算：开跑前告诉作者要调多少次模型、最多输出多少。
      const estimate = estimateStyleDistillationRun(normalizeStyleDistillationSource(sourceIn).chapters);
      return ok(`已预览参考文本范围；尚未写入本书文风。${estimate.summary}`, { ...source, estimate });
    }
    if (name === "style.distill_start") return await start(input, binding, context);
    if (name === "style.distill_status") {
      if (typeof input.jobId !== "string") return fail("job-id-required", "style.distill_status 需要 jobId。");
      const job = await readStyleDistillationJob(binding.root, input.jobId);
      if (job.bookId !== binding.bookId) return fail("STYLE_DISTILLATION_NOT_FOUND", "该蒸馏任务不属于当前书籍。");
      return ok(`已读取文风来源包状态：${progressLine(job)}。`, modelView(job, (await loadStylePreset(binding.root)).revision));
    }
    if (name === "style.distill_adopt") return await adopt(input, binding);
    return fail("unknown-style-distill-tool", "未知的文风蒸馏工具。");
  } catch (error) {
    const handled = toolError(error);
    if (handled) return handled;
    throw error;
  }
}
