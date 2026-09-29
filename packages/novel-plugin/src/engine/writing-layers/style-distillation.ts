import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

import { splitChapters, type SplitChapter } from "@vivy1024/novelfork-core";
import { distillStyleProfile, type DistilledStyleProfile } from "../tools/import/style-distiller.js";
import type { DissectKnowledgePack, DissectSourceChapter } from "../../handlers/dissect-knowledge.js";
import {
  extractKnowledgePack,
} from "../../handlers/dissect-knowledge.js";

export const STYLE_DISTILLATION_SCHEMA_VERSION = 1 as const;
export const STYLE_DISTILLATIONS_RELATIVE_DIR = join("story", "style-distillations");
export const MAX_STYLE_DISTILLATION_CHAPTERS = 200;
export const MAX_STYLE_DISTILLATION_CHARS = 1_000_000;
export const MAX_STYLE_DISTILLATION_RULES = 200;
/** 单章进入模型批次的上限字数，与覆盖统计的 analyzedCharCount 口径一致。 */
export const STYLE_DISTILLATION_CHAPTER_CHAR_LIMIT = 12_000;
/** 每批送给模型的正文预算与章数上限。 */
export const STYLE_DISTILLATION_BATCH_CHAR_BUDGET = 12_000;
export const STYLE_DISTILLATION_BATCH_MAX_CHAPTERS = 5;

/** 模型只提取这六类写法；general 仅用于确定性基线的综合项。 */
export const STYLE_MODEL_RULE_CATEGORIES = ["voice", "language", "rhythm", "dialogue", "scene", "consistency"] as const;
export const STYLE_RULE_CATEGORIES = [...STYLE_MODEL_RULE_CATEGORIES, "general"] as const;
export const STYLE_RULE_CATEGORY_LABELS: Readonly<Record<(typeof STYLE_RULE_CATEGORIES)[number], string>> = {
  voice: "声音",
  language: "语言",
  rhythm: "节奏",
  dialogue: "对话",
  scene: "场景写法",
  consistency: "一致性",
  general: "综合",
};

const sourceText = z.string().trim().min(1).max(4_000);
const chapterRange = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
}).refine((range) => range.to >= range.from, "章节范围无效");
const explanation = z.object({
  what: sourceText,
  why: sourceText,
  next: sourceText,
}).strict();
const progress = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  percent: z.number().min(0).max(100),
});

export const StyleDistillationSourceSchema = z.object({
  sourceId: z.string().trim().min(1).max(120),
  sourceName: z.string().trim().min(1).max(200),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  chapterRange,
  chapterCount: z.number().int().nonnegative().max(MAX_STYLE_DISTILLATION_CHAPTERS),
  // running：本进程正在跑模型批次；paused：还有未完成批次但当前没有运行者（无模型或中断）。
  status: z.enum(["preview", "running", "paused", "ready", "failed", "adopted"]),
  progress,
  coverage: z.object({
    requestedChapterRange: chapterRange,
    chapterCount: z.number().int().nonnegative(),
    coveredChapterCount: z.number().int().nonnegative(),
    emptyChapterCount: z.number().int().nonnegative(),
    coverageRatio: z.number().min(0).max(1),
    sourceCharCount: z.number().int().nonnegative(),
    analyzedCharCount: z.number().int().nonnegative(),
  }).strict(),
  rules: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    text: sourceText,
    evidence: sourceText,
    transfer: z.enum(["transferable", "source-only"]),
    status: z.enum(["needs-review", "confirmed"]),
    category: z.enum(STYLE_RULE_CATEGORIES).optional(),
    origin: z.enum(["baseline", "model"]).optional(),
    batchId: z.string().trim().min(1).max(40).optional(),
    /** 模型给出的「可迁移 / 作品专属」判断理由。 */
    reason: sourceText.optional(),
  }).strict()).max(MAX_STYLE_DISTILLATION_RULES),
  samples: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    sceneType: z.enum(["dialogue", "action", "description", "interiority", "transition", "general"]),
    text: z.string().trim().min(1).max(1_200),
    evidence: sourceText,
    transfer: z.enum(["transferable", "source-only"]),
    status: z.enum(["needs-review", "confirmed"]),
  }).strict()).max(100),
  fingerprint: z.record(z.string(), z.unknown()).nullable(),
  warnings: z.array(sourceText).max(50),
}).strict();

export const StyleDistillationBatchSchema = z.object({
  id: z.string().regex(/^batch-\d{3}$/u),
  index: z.number().int().nonnegative(),
  chapterNumbers: z.array(z.number().int().positive()).min(1).max(MAX_STYLE_DISTILLATION_CHAPTERS),
  charCount: z.number().int().nonnegative(),
  status: z.enum(["pending", "running", "done", "failed"]),
  attempts: z.number().int().nonnegative(),
  ruleIds: z.array(z.string().trim().min(1).max(120)).max(50),
  /** 本批被拒收或合并的条目说明；不静默丢弃模型输出。 */
  issues: z.array(sourceText).max(30),
  explanation: explanation.optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
}).strict();

export const StyleDistillationJobSchema = StyleDistillationSourceSchema.extend({
  schemaVersion: z.literal(STYLE_DISTILLATION_SCHEMA_VERSION),
  jobId: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/u),
  bookId: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** 模型分批抽取计划；第一切片的旧任务文件没有此字段，按空计划读取。 */
  batches: z.array(StyleDistillationBatchSchema).max(MAX_STYLE_DISTILLATION_CHAPTERS).default([]),
  adoption: z.object({
    ruleIds: z.array(z.string().trim().min(1).max(120)).max(100),
    sampleIds: z.array(z.string().trim().min(1).max(120)).max(100),
    presetRevision: z.string().regex(/^[a-f0-9]{64}$/u),
    adoptedAt: z.string().datetime(),
  }).strict().optional(),
}).strict();

export type StyleDistillationSource = z.infer<typeof StyleDistillationSourceSchema>;
export type StyleDistillationJob = z.infer<typeof StyleDistillationJobSchema>;
export type StyleDistillationRule = StyleDistillationSource["rules"][number];
export type StyleDistillationSample = StyleDistillationSource["samples"][number];
export type StyleDistillationBatch = z.infer<typeof StyleDistillationBatchSchema>;
export type StyleDistillationExplanation = z.infer<typeof explanation>;
export type StyleRuleCategory = (typeof STYLE_RULE_CATEGORIES)[number];
export type StyleDistillationFingerprint = DistilledStyleProfile;

export interface DistillableChapter {
  readonly number: number;
  readonly title: string;
  readonly content: string;
}

export interface StyleDistillationSourceInput {
  readonly sourceName: string;
  readonly text?: string;
  readonly chapters?: readonly { readonly number: number; readonly title?: string; readonly content: string }[];
  readonly splitPattern?: string;
}

export class StyleDistillationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "STYLE_DISTILLATION_INVALID_INPUT"
      | "STYLE_DISTILLATION_TOO_LARGE"
      | "STYLE_DISTILLATION_NO_CHAPTERS"
      | "STYLE_DISTILLATION_NOT_FOUND"
      | "STYLE_DISTILLATION_CORRUPTED"
      | "STYLE_DISTILLATION_BUSY"
      | "STYLE_DISTILLATION_SOURCE_MISSING"
      | "STYLE_DISTILLATION_MODEL_UNAVAILABLE",
  ) {
    super(message);
    this.name = "StyleDistillationError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function now(): string {
  return new Date().toISOString();
}

function trimSourceName(sourceName: string): string {
  const value = sourceName.trim();
  if (!value) throw new StyleDistillationError("参考来源名称不能为空。", "STYLE_DISTILLATION_INVALID_INPUT");
  if (value.length > 200) throw new StyleDistillationError("参考来源名称不能超过 200 字。", "STYLE_DISTILLATION_INVALID_INPUT");
  return value;
}

function normalizeChapters(input: StyleDistillationSourceInput): DistillableChapter[] {
  const hasText = typeof input.text === "string";
  const hasChapters = Array.isArray(input.chapters);
  if (hasText === hasChapters) {
    throw new StyleDistillationError("必须且只能提供 text 或 chapters 其中一种来源正文。", "STYLE_DISTILLATION_INVALID_INPUT");
  }

  if (hasText) {
    const text = input.text!.trim();
    if (!text) throw new StyleDistillationError("参考正文不能为空。", "STYLE_DISTILLATION_INVALID_INPUT");
    let split: ReadonlyArray<SplitChapter>;
    try {
      split = splitChapters(text, input.splitPattern?.trim() || undefined);
    } catch (error) {
      throw new StyleDistillationError(
        `章节分割规则无效：${error instanceof Error ? error.message : String(error)}`,
        "STYLE_DISTILLATION_INVALID_INPUT",
      );
    }
    if (split.length === 0) {
      throw new StyleDistillationError("未能识别出章节，请检查正文标题或 splitPattern。", "STYLE_DISTILLATION_NO_CHAPTERS");
    }
    return split.map((chapter, index) => ({
      number: index + 1,
      title: chapter.title || `第${index + 1}章`,
      content: chapter.content,
    }));
  }

  const chapters = input.chapters!;
  if (chapters.length === 0) {
    throw new StyleDistillationError("chapters 不能为空。", "STYLE_DISTILLATION_NO_CHAPTERS");
  }
  const seen = new Set<number>();
  return [...chapters]
    .map((chapter) => {
      if (!Number.isSafeInteger(chapter.number) || chapter.number <= 0 || seen.has(chapter.number)) {
        throw new StyleDistillationError("chapters.number 必须是唯一的正整数。", "STYLE_DISTILLATION_INVALID_INPUT");
      }
      seen.add(chapter.number);
      if (typeof chapter.content !== "string") {
        throw new StyleDistillationError("每个章节都必须提供 content。", "STYLE_DISTILLATION_INVALID_INPUT");
      }
      return {
        number: chapter.number,
        title: chapter.title?.trim() || `第${chapter.number}章`,
        content: chapter.content.trim(),
      };
    })
    .sort((left, right) => left.number - right.number);
}

export function normalizeStyleDistillationSource(input: StyleDistillationSourceInput): {
  readonly sourceName: string;
  readonly chapters: readonly DistillableChapter[];
  readonly sourceFingerprint: string;
  readonly chapterRange: { readonly from: number; readonly to: number };
  readonly coverage: StyleDistillationSource["coverage"];
} {
  const sourceName = trimSourceName(input.sourceName);
  const chapters = normalizeChapters(input);
  if (chapters.length > MAX_STYLE_DISTILLATION_CHAPTERS) {
    throw new StyleDistillationError(
      `参考来源最多支持 ${MAX_STYLE_DISTILLATION_CHAPTERS} 章，当前为 ${chapters.length} 章。`,
      "STYLE_DISTILLATION_TOO_LARGE",
    );
  }
  const sourceCharCount = chapters.reduce((sum, chapter) => sum + chapter.content.length, 0);
  if (sourceCharCount > MAX_STYLE_DISTILLATION_CHARS) {
    throw new StyleDistillationError(
      `参考正文最多支持 ${MAX_STYLE_DISTILLATION_CHARS} 字，当前为 ${sourceCharCount} 字。`,
      "STYLE_DISTILLATION_TOO_LARGE",
    );
  }
  const nonEmpty = chapters.filter((chapter) => chapter.content.length > 0);
  if (nonEmpty.length === 0) {
    throw new StyleDistillationError("参考来源没有可分析的章节正文。", "STYLE_DISTILLATION_INVALID_INPUT");
  }
  const from = chapters[0]?.number ?? 0;
  const to = chapters.at(-1)?.number ?? 0;
  const requestedChapterRange = { from, to };
  return {
    sourceName,
    chapters,
    sourceFingerprint: chaptersFingerprint(chapters),
    chapterRange: requestedChapterRange,
    coverage: {
      requestedChapterRange,
      chapterCount: chapters.length,
      coveredChapterCount: nonEmpty.length,
      emptyChapterCount: chapters.length - nonEmpty.length,
      coverageRatio: Number((nonEmpty.length / chapters.length).toFixed(4)),
      sourceCharCount,
      analyzedCharCount: nonEmpty.reduce((sum, chapter) => sum + Math.min(chapter.content.length, STYLE_DISTILLATION_CHAPTER_CHAR_LIMIT), 0),
    },
  };
}

const CHAPTER_HEADING = /^(?:第[\d零〇一二三四五六七八九十百千两]+[章节回卷集]|chapter\s*\d+)/iu;

/**
 * 范文要能示范写法：取章内第一段起的连续整段，凑够约 200 字即止、不超过 600 字；
 * 跳过章节标题行，超长时在句末截断，不留半句。
 */
function excerptFor(chapter: DistillableChapter): string {
  const paragraphs = chapter.content
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !CHAPTER_HEADING.test(item));
  const picked: string[] = [];
  let length = 0;
  for (const paragraph of paragraphs) {
    picked.push(paragraph);
    length += paragraph.length;
    if (length >= 200) break;
  }
  const passage = picked.length > 0 ? picked.join("\n") : chapter.content.trim();
  if (passage.length <= 600) return passage;
  const cut = passage.slice(0, 600);
  const lastEnd = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"), cut.lastIndexOf("”"));
  return (lastEnd > 120 ? cut.slice(0, lastEnd + 1) : cut).trim();
}

function sampleSceneType(text: string): StyleDistillationSample["sceneType"] {
  if (/[“”「」"：:]/u.test(text)) return "dialogue";
  if (/(?:冲|追|逃|打|杀|跑|撞|拔|挥|战|躲)/u.test(text)) return "action";
  if (/(?:想|记得|意识|心中|暗自|不由得)/u.test(text)) return "interiority";
  if (/(?:后来|随后|转眼|次日|终于|走进|离开)/u.test(text)) return "transition";
  if (/(?:阳光|月光|灯光|雾|雨|雪|风声|气味|颜色|影子|墙|窗|屋檐|街道)/u.test(text)) return "description";
  // 判不出写法类型时如实标「通用」，写作注入会把它当通用范文，而不是冒充描写示例。
  return "general";
}

function rule(id: string, text: string, evidence: string, category: StyleRuleCategory = "general"): StyleDistillationRule {
  return {
    id,
    text,
    evidence: evidence.slice(0, 800),
    transfer: "transferable",
    status: "needs-review",
    category,
    origin: "baseline",
  };
}

function mapRules(pack: DissectKnowledgePack, fingerprint: DistilledStyleProfile): StyleDistillationRule[] {
  const rules: StyleDistillationRule[] = [];
  if (pack.styleHints.tone.trim()) {
    rules.push(rule("tone", `整体表达基调参考：${pack.styleHints.tone.trim()}。`, `拆书得到的基调提示：${pack.styleHints.tone.trim()}`, "voice"));
  }
  for (const [index, hint] of pack.styleHints.formattingRules.entries()) {
    const normalized = hint.trim();
    if (!normalized) continue;
    if (/平均句长约\s*(\d+)/u.test(normalized)) {
      rules.push(rule(`rhythm-${index}`, `句长以约 ${fingerprint.avgSentenceLength} 字为参照，保留长短变化。`, normalized, "rhythm"));
    } else if (/对话句占比约\s*(\d+)%/u.test(normalized)) {
      rules.push(rule(`dialogue-${index}`, `对话约占文本 ${Math.round((fingerprint.dialogueRatio ?? 0) * 100)}%，用对白推进信息或冲突。`, normalized, "dialogue"));
    } else {
      rules.push(rule(`format-${index}`, `表达格式参考：${normalized}。`, normalized));
    }
  }
  if (rules.length === 0 && fingerprint.avgSentenceLength > 0) {
    rules.push(rule(
      "rhythm-profile",
      `句长以约 ${fingerprint.avgSentenceLength} 字为参照，标准差约 ${fingerprint.sentenceLengthStdDev} 字，保留自然起伏。`,
      `统计指纹：平均句长 ${fingerprint.avgSentenceLength}，句长标准差 ${fingerprint.sentenceLengthStdDev}`,
      "rhythm",
    ));
  }
  return rules.slice(0, 50);
}

function mapSamples(chapters: readonly DistillableChapter[]): StyleDistillationSample[] {
  return chapters
    .filter((chapter) => chapter.content.length > 0)
    .slice(0, 12)
    .map((chapter, index) => {
      const text = excerptFor(chapter).slice(0, 1_200);
      return {
        id: `sample-${chapter.number}-${index + 1}`,
        sceneType: sampleSceneType(text),
        text,
        evidence: `第${chapter.number}章原文摘录（${text.length} 字）`,
        transfer: "source-only",
        status: "needs-review",
      };
    });
}

export interface BuildStyleDistillationInput {
  readonly source: ReturnType<typeof normalizeStyleDistillationSource>;
  readonly knowledge?: DissectKnowledgePack;
  readonly fingerprint?: DistilledStyleProfile;
  readonly modelAvailable?: boolean;
}

export interface BuiltStyleDistillationPackage {
  readonly rules: readonly StyleDistillationRule[];
  readonly samples: readonly StyleDistillationSample[];
  readonly fingerprint: DistilledStyleProfile;
  readonly warnings: readonly string[];
}

export function buildStyleDistillationPackage(input: BuildStyleDistillationInput): BuiltStyleDistillationPackage {
  const knowledge = input.knowledge ?? extractKnowledgePack(input.source.chapters);
  const fingerprint = input.fingerprint ?? distillStyleProfile(input.source.chapters.map((chapter) => chapter.content));
  const warnings = [
    input.modelAvailable
      ? "已先生成确定性规则基线；模型按章节批次抽取声音、语言、节奏、对话、场景写法与一致性规则，进度见批次状态。"
      : "当前入口没有可用模型：已生成确定性规则基线，模型批次保持待处理。可在叙述者对话中调用 style.distill_start 并传入 jobId 继续。",
    "人物、世界和剧情事实不会写入可迁移规则；样本默认 source-only，需作者逐项复核。",
    knowledge.styleHints.customVocabulary.length > 0
      ? "已忽略来源专名和题材词汇，避免把来源绑定内容带入本书文风。"
      : "",
  ].filter(Boolean);
  return {
    rules: mapRules(knowledge, fingerprint),
    samples: mapSamples(input.source.chapters),
    fingerprint,
    warnings,
  };
}

export function makePreviewSource(input: StyleDistillationSourceInput): StyleDistillationSource {
  const source = normalizeStyleDistillationSource(input);
  return {
    sourceId: `source-${source.sourceFingerprint.slice(0, 24)}`,
    sourceName: source.sourceName,
    sourceFingerprint: source.sourceFingerprint,
    chapterRange: source.chapterRange,
    chapterCount: source.chapters.length,
    status: "preview",
    progress: { completed: 0, total: 1, percent: 0 },
    coverage: source.coverage,
    rules: [],
    samples: [],
    fingerprint: null,
    warnings: [],
  };
}

/** 按章节顺序切批：只收非空章节，每章按上限截断计入预算。 */
export function planStyleDistillationBatches(chapters: readonly DistillableChapter[]): StyleDistillationBatch[] {
  const batches: StyleDistillationBatch[] = [];
  let numbers: number[] = [];
  let chars = 0;
  const flush = () => {
    if (numbers.length === 0) return;
    const index = batches.length;
    batches.push({
      id: `batch-${String(index + 1).padStart(3, "0")}`,
      index,
      chapterNumbers: numbers,
      charCount: chars,
      status: "pending",
      attempts: 0,
      ruleIds: [],
      issues: [],
    });
    numbers = [];
    chars = 0;
  };
  for (const chapter of chapters) {
    if (chapter.content.length === 0) continue;
    const size = Math.min(chapter.content.length, STYLE_DISTILLATION_CHAPTER_CHAR_LIMIT);
    if (numbers.length > 0 && (chars + size > STYLE_DISTILLATION_BATCH_CHAR_BUDGET
      || numbers.length >= STYLE_DISTILLATION_BATCH_MAX_CHAPTERS)) {
      flush();
    }
    numbers.push(chapter.number);
    chars += size;
  }
  flush();
  return batches;
}

/**
 * 由批次推导任务状态与进度：基线算一步，每个已结束（done/failed）的批次算一步。
 * active 表示本进程是否有运行者正在处理该任务；没有运行者时残留的 running 批次视为待处理。
 */
export function settleStyleDistillationJobState(job: StyleDistillationJob, active: boolean): StyleDistillationJob {
  const batches = active
    ? job.batches
    : job.batches.map((batch) => batch.status === "running" ? { ...batch, status: "pending" as const } : batch);
  const unfinished = batches.filter((batch) => batch.status === "pending" || batch.status === "running").length;
  const total = batches.length + 1;
  const completed = total - unfinished;
  const status: StyleDistillationJob["status"] = job.status === "failed"
    ? "failed"
    : unfinished > 0
      ? (active ? "running" : "paused")
      : job.adoption ? "adopted" : "ready";
  return {
    ...job,
    batches,
    status,
    progress: { completed, total, percent: Math.round((completed / total) * 100) },
  };
}

export interface InitialStyleDistillationJob {
  readonly job: StyleDistillationJob;
  readonly chapters: readonly DistillableChapter[];
}

/** 新建任务：确定性基线与统计指纹立即可审，模型批次全部待处理。 */
export function makeInitialStyleDistillationJob(
  bookId: string,
  jobId: string,
  input: StyleDistillationSourceInput,
  modelAvailable = false,
): InitialStyleDistillationJob {
  const source = normalizeStyleDistillationSource(input);
  const result = buildStyleDistillationPackage({ source, modelAvailable });
  const timestamp = now();
  const job = StyleDistillationJobSchema.parse({
    schemaVersion: STYLE_DISTILLATION_SCHEMA_VERSION,
    jobId,
    bookId,
    sourceId: `source-${source.sourceFingerprint.slice(0, 24)}`,
    sourceName: source.sourceName,
    sourceFingerprint: source.sourceFingerprint,
    chapterRange: source.chapterRange,
    chapterCount: source.chapters.length,
    status: "paused",
    progress: { completed: 1, total: 1, percent: 100 },
    coverage: source.coverage,
    rules: result.rules,
    samples: result.samples,
    fingerprint: result.fingerprint,
    warnings: result.warnings,
    createdAt: timestamp,
    updatedAt: timestamp,
    batches: planStyleDistillationBatches(source.chapters),
  });
  return { job: settleStyleDistillationJobState(job, false), chapters: source.chapters };
}

function jobPath(bookRoot: string, jobId: string): string {
  if (!/^[A-Za-z0-9_-]{8,120}$/u.test(jobId)) {
    throw new StyleDistillationError("蒸馏任务 ID 无效。", "STYLE_DISTILLATION_INVALID_INPUT");
  }
  return join(resolve(bookRoot), STYLE_DISTILLATIONS_RELATIVE_DIR, `${jobId}.json`);
}

export async function saveStyleDistillationJob(bookRoot: string, job: StyleDistillationJob): Promise<StyleDistillationJob> {
  const parsed = StyleDistillationJobSchema.parse(job);
  const file = jobPath(bookRoot, parsed.jobId);
  const dir = join(resolve(bookRoot), STYLE_DISTILLATIONS_RELATIVE_DIR);
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.style-distillation-${randomUUID()}.tmp`);
  const raw = `${JSON.stringify(parsed, null, 2)}\n`;
  try {
    await writeFile(temporary, raw, "utf8");
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return parsed;
}

export async function loadStyleDistillationJob(bookRoot: string, jobId: string): Promise<StyleDistillationJob> {
  const file = jobPath(bookRoot, jobId);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StyleDistillationError("蒸馏任务不存在或尚未保存。", "STYLE_DISTILLATION_NOT_FOUND");
    }
    throw error;
  }
  try {
    return StyleDistillationJobSchema.parse(JSON.parse(raw));
  } catch {
    throw new StyleDistillationError("蒸馏任务文件损坏；请删除该任务后重新预览。", "STYLE_DISTILLATION_CORRUPTED");
  }
}

const JOB_FILE_PATTERN = /^([A-Za-z0-9_-]{8,120})\.json$/u;

/** 列出本书全部蒸馏任务（跳过损坏文件并如实返回其 ID）。 */
export async function listStyleDistillationJobs(bookRoot: string): Promise<{
  readonly jobs: readonly StyleDistillationJob[];
  readonly corruptedJobIds: readonly string[];
}> {
  const dir = join(resolve(bookRoot), STYLE_DISTILLATIONS_RELATIVE_DIR);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { jobs: [], corruptedJobIds: [] };
    throw error;
  }
  const jobs: StyleDistillationJob[] = [];
  const corruptedJobIds: string[] = [];
  for (const name of names.sort()) {
    const jobId = JOB_FILE_PATTERN.exec(name)?.[1];
    if (!jobId) continue;
    try {
      jobs.push(await loadStyleDistillationJob(bookRoot, jobId));
    } catch (error) {
      if (error instanceof StyleDistillationError && error.code === "STYLE_DISTILLATION_CORRUPTED") {
        corruptedJobIds.push(jobId);
        continue;
      }
      throw error;
    }
  }
  jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { jobs, corruptedJobIds };
}

// 来源快照只服务于批次恢复：存在任务目录，不进入正式章节、经纬或文风预设。
const StyleDistillationSourceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/u),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  chapters: z.array(z.object({
    number: z.number().int().positive(),
    title: z.string(),
    content: z.string(),
  }).strict()).max(MAX_STYLE_DISTILLATION_CHAPTERS),
}).strict();

function sourceSnapshotPath(bookRoot: string, jobId: string): string {
  return jobPath(bookRoot, jobId).replace(/\.json$/u, ".source.json");
}

function chaptersFingerprint(chapters: readonly DistillableChapter[]): string {
  return sha256(JSON.stringify(chapters.map(({ number, title, content }) => ({ number, title, content }))));
}

export async function saveStyleDistillationSourceSnapshot(
  bookRoot: string,
  jobId: string,
  sourceFingerprint: string,
  chapters: readonly DistillableChapter[],
): Promise<void> {
  const snapshot = StyleDistillationSourceSnapshotSchema.parse({
    schemaVersion: 1,
    jobId,
    sourceFingerprint,
    chapters: chapters.map(({ number, title, content }) => ({ number, title, content })),
  });
  const dir = join(resolve(bookRoot), STYLE_DISTILLATIONS_RELATIVE_DIR);
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.style-distillation-source-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, "utf8");
    await rename(temporary, sourceSnapshotPath(bookRoot, jobId));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/** 读取来源快照并核对指纹；缺失或被改动都拒绝恢复，避免拿错文本继续抽取。 */
export async function loadStyleDistillationSourceSnapshot(
  bookRoot: string,
  job: Pick<StyleDistillationJob, "jobId" | "sourceFingerprint">,
): Promise<readonly DistillableChapter[]> {
  let raw: string;
  try {
    raw = await readFile(sourceSnapshotPath(bookRoot, job.jobId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StyleDistillationError(
        "该任务没有可用的来源快照，无法继续模型批次；请重新提交参考文本新建任务。",
        "STYLE_DISTILLATION_SOURCE_MISSING",
      );
    }
    throw error;
  }
  let snapshot: z.infer<typeof StyleDistillationSourceSnapshotSchema>;
  try {
    snapshot = StyleDistillationSourceSnapshotSchema.parse(JSON.parse(raw));
  } catch {
    throw new StyleDistillationError("来源快照损坏，无法继续模型批次；请重新提交参考文本新建任务。", "STYLE_DISTILLATION_SOURCE_MISSING");
  }
  if (snapshot.jobId !== job.jobId || snapshot.sourceFingerprint !== job.sourceFingerprint
    || chaptersFingerprint(snapshot.chapters) !== job.sourceFingerprint) {
    throw new StyleDistillationError("来源快照与任务指纹不一致，已拒绝继续；请重新提交参考文本新建任务。", "STYLE_DISTILLATION_SOURCE_MISSING");
  }
  return snapshot.chapters;
}

export function newStyleDistillationJobId(): string {
  return randomUUID();
}

export function chaptersFromSourceInput(input: StyleDistillationSourceInput): readonly DissectSourceChapter[] {
  return normalizeStyleDistillationSource(input).chapters;
}
