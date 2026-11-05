/**
 * 旧稿导入（T4.2）：源快照 → 切分预览 → 作者确认 → 逐章事实 → 全书综合 → 发布。
 *
 * 本文件只管「数据」：原文快照、切分计划、计划编辑与任务文件。写章、结算与综合在
 * handlers/manuscript-import-service.ts，复用现有章节写入层与章后结算，不另造路径。
 *
 * 目录布局（都在书内，随书走）：
 *   story/import/<jobId>/source.<ext>          单个文本文件的原始字节（只写一次，之后只读）
 *   story/import/<jobId>/source/NNNN-<名>      文件夹导入时每个章节文件的原始字节
 *   story/import/<jobId>/plan.json             由快照派生的切分计划（换规则或手动调整会重写）
 *   story/import/<jobId>/job.json              任务状态：阶段、逐章写入与结算进度、导入报告
 *
 * 快照写入后所有步骤只读快照与由它派生的计划，不再读作者原文件；作者原文件从不经服务端。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

import { MAX_SPLIT_TEXT_LENGTH, splitChapters } from "@vivy1024/novelfork-core";

import { writeFileAtomic } from "../writing-resource/atomic-write.js";

export const MANUSCRIPT_IMPORT_SCHEMA_VERSION = 1 as const;
export const MANUSCRIPT_IMPORT_RELATIVE_DIR = join("story", "import");
/**
 * 原始字节总上限。上传走产品路由的 8 MiB 长文本请求体上限（product-runtime body-limit.ts），
 * 这里留 1 MiB 给 multipart 包装；GBK 约 2 字节一字、UTF-8 约 3 字节一字，足够两三百万字以内的旧稿。
 */
export const MAX_MANUSCRIPT_BYTES = 7 * 1024 * 1024;
export const MAX_MANUSCRIPT_FILES = 2_000;
export const MAX_MANUSCRIPT_CHAPTERS = 2_000;
const MAX_TITLE_LENGTH = 120;
const PREVIEW_SNIPPET = 60;

export type ManuscriptEncoding = "utf-8" | "utf-16le" | "gb18030";

export class ManuscriptImportError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MANUSCRIPT_IMPORT_INVALID_INPUT"
      | "MANUSCRIPT_IMPORT_TOO_LARGE"
      | "MANUSCRIPT_IMPORT_NOT_FOUND"
      | "MANUSCRIPT_IMPORT_CORRUPTED"
      | "MANUSCRIPT_IMPORT_CONFLICT"
      | "MANUSCRIPT_IMPORT_WRONG_PHASE"
      | "MANUSCRIPT_IMPORT_BUSY"
      | "MANUSCRIPT_IMPORT_SNAPSHOT_MISMATCH"
      | "MANUSCRIPT_IMPORT_INVALID_PATTERN"
      | "MANUSCRIPT_IMPORT_MODEL_UNAVAILABLE",
    readonly explanation: Explanation,
  ) {
    super(message);
    this.name = "ManuscriptImportError";
  }
}

const explanationSchema = z.object({
  whatHappened: z.string().min(1).max(4_000),
  whyItMatters: z.string().min(1).max(4_000),
  suggestedAction: z.string().min(1).max(4_000),
}).strict();
export type Explanation = z.infer<typeof explanationSchema>;

function fail(
  code: ManuscriptImportError["code"],
  whatHappened: string,
  whyItMatters: string,
  suggestedAction: string,
): never {
  throw new ManuscriptImportError(whatHappened, code, { whatHappened, whyItMatters, suggestedAction });
}

// ─── 解码 ────────────────────────────────────────────────────────────────

/** 识别旧稿编码：BOM 优先，其次严格 UTF-8，都不是按 GB18030（兼容 GBK/GB2312）。 */
export function decodeManuscriptBytes(bytes: Uint8Array): { readonly text: string; readonly encoding: ManuscriptEncoding } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("gb18030").decode(bytes), encoding: "gb18030" };
  }
}

function normalizeNewlines(text: string): string {
  return text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ─── 任务文件 ─────────────────────────────────────────────────────────────

const settleStatus = z.enum(["pending", "running", "done", "skipped", "failed"]);

const jobChapterSchema = z.object({
  index: z.number().int().positive(),
  chapterNumber: z.number().int().positive(),
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  /** 写入章节文件时的正文指纹（与章节索引 contentHash 同一算法）；未写入时缺省。 */
  contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  written: z.boolean(),
  settle: z.object({
    status: settleStatus,
    attempts: z.number().int().nonnegative(),
    extracted: z.number().int().nonnegative().optional(),
    autoApplied: z.number().int().nonnegative().optional(),
    pending: z.number().int().nonnegative().optional(),
    highRiskPending: z.number().int().nonnegative().optional(),
    /** 面向作者的结果说明（成功的计数句或失败的三段式展开）。 */
    summary: z.string().max(8_000).optional(),
    error: z.string().max(200).optional(),
    finishedAt: z.string().datetime().optional(),
  }).strict(),
}).strict();

const sourceFileSchema = z.object({
  name: z.string().min(1).max(400),
  // 只认写入时能产生的两种形状（单文件 source.<ext>，文件夹 source/<4 位序号>-<净化名>）：
  // job.json 可能被篡改或来自导入的书包，读快照时不能信任它指向任务目录以外。
  storedAs: z.string().min(1).max(400).regex(/^source(?:\.(?:txt|md|markdown|text)|\/\d{4}-[^/\\\u0000-\u001f]+)$/u),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  encoding: z.enum(["utf-8", "utf-16le", "gb18030"]),
}).strict();

const reportSchema = z.object({
  generatedAt: z.string().datetime(),
  chapterCount: z.number().int().nonnegative(),
  settledChapters: z.number().int().nonnegative(),
  unsettledChapters: z.array(z.number().int().positive()),
  failedChapters: z.array(z.object({
    chapterNumber: z.number().int().positive(),
    title: z.string(),
    reason: z.string().max(8_000),
  }).strict()),
  eventCount: z.number().int().nonnegative(),
  pendingEventCount: z.number().int().nonnegative(),
  highRiskPendingCount: z.number().int().nonnegative(),
  pendingReviewTotal: z.number().int().nonnegative(),
  entityCount: z.number().int().nonnegative(),
  relationCount: z.number().int().nonnegative(),
  foreshadow: z.object({
    total: z.number().int().nonnegative(),
    byPhase: z.record(z.string(), z.number().int().nonnegative()),
    items: z.array(z.object({ label: z.string(), phase: z.string(), setupChapter: z.number().int().optional() }).strict()).max(30),
  }).strict(),
  storylines: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() }).strict()).max(50),
  /**
   * 从正文统计起草、仍待作者确认的人物草稿（经纬人物条目，needs-review）。确认后才进实体图谱与场景校验。
   * 旧任务文件没有这一项。
   */
  characterDrafts: z.object({
    pending: z.number().int().nonnegative(),
    /** 本次综合新起草的数量（重跑综合时已有的不重复起草）。 */
    stagedThisRun: z.number().int().nonnegative(),
    /** 起草门槛（人物角色事件条数 + 出场章数）。 */
    threshold: z.number().int().positive(),
    items: z.array(z.object({
      entryId: z.string(),
      title: z.string(),
      firstChapter: z.number().int().optional(),
      occurrences: z.number().int().optional(),
    }).strict()).max(30),
    explanation: explanationSchema,
  }).strict().optional(),
  warnings: z.array(z.string().max(4_000)).max(50),
}).strict();
export type ManuscriptImportReport = z.infer<typeof reportSchema>;

export const ManuscriptImportJobSchema = z.object({
  schemaVersion: z.literal(MANUSCRIPT_IMPORT_SCHEMA_VERSION),
  jobId: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/u),
  bookId: z.string().min(1).max(200),
  sourceName: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: z.object({
    kind: z.enum(["text", "files"]),
    /** 快照整体指纹：单文件为原始字节哈希；多文件为清单（顺序、名称、各自哈希）的哈希。 */
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    bytes: z.number().int().nonnegative(),
    charCount: z.number().int().nonnegative(),
    files: z.array(sourceFileSchema).min(1).max(MAX_MANUSCRIPT_FILES),
  }).strict(),
  /**
   * preview：切分预览，章节尚未写入；writing：作者已确认、正在逐章写入（中断后可续写）；
   * written：章节已全部写入，逐章事实与综合进行中；
   * published：作者点了「完成导入」。
   */
  phase: z.enum(["preview", "writing", "written", "published"]),
  split: z.object({
    mode: z.enum(["rule", "by-file"]),
    pattern: z.string().max(200).optional(),
  }).strict(),
  planRevision: z.number().int().nonnegative(),
  /** 确认后才有：每章的书内章号、写入与结算进度。 */
  chapters: z.array(jobChapterSchema).max(MAX_MANUSCRIPT_CHAPTERS),
  settlement: z.object({
    state: z.enum(["idle", "running", "paused", "blocked", "done"]),
    explanation: explanationSchema.optional(),
    updatedAt: z.string().datetime().optional(),
  }).strict(),
  report: reportSchema.optional(),
  publishedAt: z.string().datetime().optional(),
}).strict();
export type ManuscriptImportJob = z.infer<typeof ManuscriptImportJobSchema>;
export type ManuscriptImportJobChapter = z.infer<typeof jobChapterSchema>;

const planChapterSchema = z.object({
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  content: z.string(),
  /** 原文里被识别为标题的那一行；合并相邻章时还原进正文，免得误判的标题行丢字。 */
  headingLine: z.string().max(400),
  sourceFile: z.string().max(400).optional(),
}).strict();
export type PlanChapter = z.infer<typeof planChapterSchema>;

const planSchema = z.object({
  schemaVersion: z.literal(MANUSCRIPT_IMPORT_SCHEMA_VERSION),
  jobId: z.string(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  revision: z.number().int().nonnegative(),
  /** 第一章标题之前、没有归入任何章节的字数（序言、作品信息等）。 */
  preambleChars: z.number().int().nonnegative(),
  /** 切分时的提示（如某文件里识别到多章）。 */
  notes: z.array(z.string().max(1_000)).max(50),
  chapters: z.array(planChapterSchema).max(MAX_MANUSCRIPT_CHAPTERS * 2),
}).strict();
export type ManuscriptImportPlan = z.infer<typeof planSchema>;

function assertJobId(jobId: string): void {
  if (!/^[A-Za-z0-9_-]{8,120}$/u.test(jobId)) {
    fail("MANUSCRIPT_IMPORT_INVALID_INPUT", "导入任务 ID 无效。", "任务 ID 决定读写哪个目录，格式不对就无法确认目标。", "从导入页重新打开任务。");
  }
}

export function manuscriptImportDir(bookRoot: string, jobId: string): string {
  assertJobId(jobId);
  return join(resolve(bookRoot), MANUSCRIPT_IMPORT_RELATIVE_DIR, jobId);
}

const jobWrites = new Map<string, Promise<void>>();

function jobKey(bookRoot: string, jobId: string): string {
  const absolute = resolve(bookRoot);
  return `${process.platform === "win32" ? absolute.toLowerCase() : absolute}::${jobId}`;
}

/** 同一任务的读改写串行，避免并发请求互相覆盖任务文件。 */
export async function withManuscriptJobLock<T>(bookRoot: string, jobId: string, task: () => Promise<T>): Promise<T> {
  const key = jobKey(bookRoot, jobId);
  const previous = jobWrites.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const tail = previous.then(() => gate);
  jobWrites.set(key, tail);
  await previous;
  try { return await task(); }
  finally {
    release();
    if (jobWrites.get(key) === tail) jobWrites.delete(key);
  }
}

export async function saveManuscriptImportJob(bookRoot: string, job: ManuscriptImportJob): Promise<ManuscriptImportJob> {
  const parsed = ManuscriptImportJobSchema.parse({ ...job, updatedAt: new Date().toISOString() });
  await writeFileAtomic(join(manuscriptImportDir(bookRoot, parsed.jobId), "job.json"), `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

export async function loadManuscriptImportJob(bookRoot: string, jobId: string): Promise<ManuscriptImportJob> {
  let raw: string;
  try {
    raw = await readFile(join(manuscriptImportDir(bookRoot, jobId), "job.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail("MANUSCRIPT_IMPORT_NOT_FOUND", "这个导入任务不存在。", "任务文件不在这本书里，可能已被删除或链接写错了书。", "回书架重新点「导入旧稿」。");
    }
    throw error;
  }
  try {
    return ManuscriptImportJobSchema.parse(JSON.parse(raw));
  } catch {
    fail("MANUSCRIPT_IMPORT_CORRUPTED", "导入任务文件损坏，读不出来。", "继续会拿错进度：可能重复写章或漏掉结算。", "原文快照仍在 story/import 下；重新导入一次即可。");
  }
}

export async function listManuscriptImportJobs(bookRoot: string): Promise<ManuscriptImportJob[]> {
  const dir = join(resolve(bookRoot), MANUSCRIPT_IMPORT_RELATIVE_DIR);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const jobs: ManuscriptImportJob[] = [];
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]{8,120}$/u.test(name)) continue;
    try { jobs.push(await loadManuscriptImportJob(bookRoot, name)); } catch { /* 损坏或不完整的任务跳过 */ }
  }
  return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function savePlan(bookRoot: string, plan: ManuscriptImportPlan): Promise<ManuscriptImportPlan> {
  const parsed = planSchema.parse(plan);
  await writeFileAtomic(join(manuscriptImportDir(bookRoot, parsed.jobId), "plan.json"), `${JSON.stringify(parsed)}\n`);
  return parsed;
}

export async function loadPlan(bookRoot: string, job: Pick<ManuscriptImportJob, "jobId" | "source">): Promise<ManuscriptImportPlan> {
  let parsed: ManuscriptImportPlan;
  try {
    parsed = planSchema.parse(JSON.parse(await readFile(join(manuscriptImportDir(bookRoot, job.jobId), "plan.json"), "utf8")));
  } catch {
    fail("MANUSCRIPT_IMPORT_CORRUPTED", "切分计划读不出来。", "没有计划就不知道每章从哪里到哪里。", "在导入页点「换规则重切」从原文快照重新生成计划。");
  }
  if (parsed.sourceSha256 !== job.source.sha256 || parsed.jobId !== job.jobId) {
    fail("MANUSCRIPT_IMPORT_SNAPSHOT_MISMATCH", "切分计划与原文快照对不上。", "计划可能来自别的任务，写进书里会是错的正文。", "在导入页点「换规则重切」从原文快照重新生成计划。");
  }
  return parsed;
}

// ─── 源快照 ─────────────────────────────────────────────────────────────

export interface ManuscriptSourceFileInput {
  /** 文件名或文件夹内相对路径，只用于排序、展示与按文件切章的标题。 */
  readonly name: string;
  readonly bytes: Uint8Array;
}

function safeStoredName(index: number, name: string): string {
  const base = name.replace(/\\/gu, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").trim().slice(0, 120) || "file";
  return `${String(index + 1).padStart(4, "0")}-${cleaned}`;
}

function extensionOf(name: string): string {
  const match = /\.(txt|md|markdown|text)$/iu.exec(name);
  return match ? `.${match[1]!.toLowerCase()}` : ".txt";
}

/** 文件夹里的章节文件按相对路径自然序排列（「第2章」排在「第10章」前）。 */
export function sortManuscriptFiles<T extends { readonly name: string }>(files: readonly T[]): T[] {
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  return [...files].sort((left, right) => collator.compare(left.name, right.name));
}

interface DecodedSource {
  readonly kind: "text" | "files";
  readonly files: ReadonlyArray<{ readonly name: string; readonly text: string }>;
}

/** 新建任务：先落快照（独占写入，之后不再改），再落计划与任务文件。 */
export async function createManuscriptImportJob(input: {
  readonly bookRoot: string;
  readonly bookId: string;
  readonly sourceName: string;
  readonly files: readonly ManuscriptSourceFileInput[];
  readonly splitPattern?: string;
}): Promise<{ readonly job: ManuscriptImportJob; readonly plan: ManuscriptImportPlan }> {
  if (input.files.length === 0) fail("MANUSCRIPT_IMPORT_INVALID_INPUT", "没有收到任何旧稿文件。", "没有原文就无法切章。", "选择一个 txt/md 文件，或一个只有章节文件的文件夹。");
  const sourceName = input.sourceName.trim().slice(0, 200);
  if (!sourceName) fail("MANUSCRIPT_IMPORT_INVALID_INPUT", "缺少旧稿名称。", "名称用于导入报告与原文快照的标识。", "填写书名或保留文件名后重试。");
  if (input.files.length > MAX_MANUSCRIPT_FILES) {
    fail("MANUSCRIPT_IMPORT_TOO_LARGE", `文件夹里有 ${input.files.length} 个文件，最多支持 ${MAX_MANUSCRIPT_FILES} 个。`, "文件过多时预览与写章都会很慢。", "分几次导入，或先把章节合并成一个文本文件。");
  }
  const totalBytes = input.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (totalBytes > MAX_MANUSCRIPT_BYTES) {
    fail("MANUSCRIPT_IMPORT_TOO_LARGE", `旧稿共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB，超过 ${MAX_MANUSCRIPT_BYTES / 1024 / 1024} MB 上限。`, "过大的正文会占满内存，切章也可能超时。", "按卷拆成几份分别导入。");
  }

  const kind: DecodedSource["kind"] = input.files.length === 1 ? "text" : "files";
  const ordered = kind === "files" ? sortManuscriptFiles(input.files) : [...input.files];
  const decoded = ordered.map((file) => ({ file, ...decodeManuscriptBytes(file.bytes) }));
  const charCount = decoded.reduce((sum, item) => sum + normalizeNewlines(item.text).length, 0);
  if (charCount > MAX_SPLIT_TEXT_LENGTH) {
    fail("MANUSCRIPT_IMPORT_TOO_LARGE", `旧稿共 ${charCount} 字，超过 ${MAX_SPLIT_TEXT_LENGTH} 字上限。`, "切章器对超长正文有上限，防止卡住服务。", "按卷拆成几份分别导入。");
  }

  const jobId = randomUUID();
  const dir = manuscriptImportDir(input.bookRoot, jobId);
  await mkdir(dir, { recursive: true });
  const files: Array<z.infer<typeof sourceFileSchema>> = [];
  if (kind === "text") {
    const only = decoded[0]!;
    const storedAs = `source${extensionOf(only.file.name)}`;
    await writeFile(join(dir, storedAs), only.file.bytes, { flag: "wx" });
    files.push({ name: only.file.name.slice(0, 400) || storedAs, storedAs, bytes: only.file.bytes.byteLength, sha256: sha256(only.file.bytes), encoding: only.encoding });
  } else {
    await mkdir(join(dir, "source"), { recursive: true });
    for (const [index, item] of decoded.entries()) {
      const storedAs = `source/${safeStoredName(index, item.file.name)}`;
      await writeFile(join(dir, storedAs), item.file.bytes, { flag: "wx" });
      files.push({ name: item.file.name.slice(0, 400), storedAs, bytes: item.file.bytes.byteLength, sha256: sha256(item.file.bytes), encoding: item.encoding });
    }
  }
  const sourceSha = kind === "text"
    ? files[0]!.sha256
    : sha256(JSON.stringify(files.map((file) => [file.name, file.sha256])));
  const timestamp = new Date().toISOString();
  const split = kind === "files" && !input.splitPattern?.trim()
    ? { mode: "by-file" as const }
    : { mode: "rule" as const, ...(input.splitPattern?.trim() ? { pattern: input.splitPattern.trim() } : {}) };
  const source = { kind, sha256: sourceSha, bytes: totalBytes, charCount, files };
  const plan = buildPlanFromSource(
    { kind, files: decoded.map((item) => ({ name: item.file.name, text: normalizeNewlines(item.text) })) },
    split,
    { jobId, sourceSha256: sourceSha, revision: 1 },
  );
  await savePlan(input.bookRoot, plan);
  const job = await saveManuscriptImportJob(input.bookRoot, {
    schemaVersion: MANUSCRIPT_IMPORT_SCHEMA_VERSION,
    jobId,
    bookId: input.bookId,
    sourceName,
    createdAt: timestamp,
    updatedAt: timestamp,
    source,
    phase: "preview",
    split,
    planRevision: plan.revision,
    chapters: [],
    settlement: { state: "idle" },
  });
  return { job, plan };
}

/** 读回快照并逐个核对哈希；任何一处对不上都拒绝继续。 */
export async function readManuscriptSnapshot(bookRoot: string, job: ManuscriptImportJob): Promise<DecodedSource> {
  const dir = manuscriptImportDir(bookRoot, job.jobId);
  const files: Array<{ name: string; text: string }> = [];
  const root = resolve(dir);
  for (const file of job.source.files) {
    // schema 已限定形状；这里再按解析后的绝对路径核对一次仍在任务目录内（纵深防御）。
    const target = resolve(root, file.storedAs);
    const rel = relative(root, target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      fail("MANUSCRIPT_IMPORT_CORRUPTED", "导入任务记录的原文快照路径不合法。", "任务文件可能被改动过，继续读取可能读到任务目录以外的文件。", "重新导入一次旧稿。");
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(target));
    } catch {
      fail("MANUSCRIPT_IMPORT_SNAPSHOT_MISMATCH", `原文快照缺少 ${file.storedAs}。`, "快照不全时重切会丢掉正文。", "重新导入一次旧稿。");
    }
    if (sha256(bytes) !== file.sha256) {
      fail("MANUSCRIPT_IMPORT_SNAPSHOT_MISMATCH", `原文快照 ${file.storedAs} 已被改动，与导入时的哈希不一致。`, "快照是这次导入唯一的原文依据，被改过就不能保证切出来的是原稿。", "重新导入一次旧稿。");
    }
    files.push({ name: file.name, text: normalizeNewlines(decodeManuscriptBytes(bytes).text) });
  }
  return { kind: job.source.kind, files };
}

// ─── 切分 ────────────────────────────────────────────────────────────────

function lastNonBlankLine(text: string): string {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim();
    if (line) return line;
  }
  return "";
}

/**
 * 用现有分章规则（core splitChapters：T-07 的解析器校验、行长与累计时限）切章，
 * 再从原文里找回每章的标题行（合并时还原用）与第一章之前未归入章节的字数。
 */
export function splitByRule(text: string, pattern?: string): { readonly chapters: PlanChapter[]; readonly preambleChars: number } {
  let split: ReturnType<typeof splitChapters>;
  try {
    split = splitChapters(text, pattern?.trim() || undefined);
  } catch (error) {
    fail(
      "MANUSCRIPT_IMPORT_INVALID_PATTERN",
      `分章规则不可用：${error instanceof Error ? error.message : String(error)}`,
      "规则有问题时可能切错或卡住，所以这次没有切。",
      "修改规则后重切，或清空规则使用自动识别（第N章 / 第N回 / Chapter N）。",
    );
  }
  // splitChapters 只交回标题与正文；标题行（合并时还原用）与序言字数从原文顺序找回：
  // 正文是两条标题行之间去掉首尾空白的原文，所以上一章正文之后的第一个非空行就是本章标题行。
  const chapters: PlanChapter[] = [];
  let cursor = 0;
  let preambleChars = 0;
  const nextLine = (from: number): { line: string; end: number } => {
    const offset = text.slice(from).search(/\S/u);
    if (offset < 0) return { line: "", end: text.length };
    const start = from + offset;
    const lineEnd = text.indexOf("\n", start);
    const end = lineEnd < 0 ? text.length : lineEnd;
    return { line: text.slice(start, end).trim(), end };
  };
  for (const [index, chapter] of split.entries()) {
    let headingLine: string;
    if (index === 0) {
      // 第一章之前可能有序言：正文定位后，往回取最近的非空行当标题行。
      const contentStart = chapter.content ? text.indexOf(chapter.content) : -1;
      if (contentStart >= 0) {
        const before = text.slice(0, contentStart);
        headingLine = lastNonBlankLine(before);
        const headingAt = before.lastIndexOf(headingLine);
        preambleChars = headingAt > 0 ? visibleChars(before.slice(0, headingAt)) : 0;
        cursor = contentStart + chapter.content.length;
      } else {
        const heading = nextLine(0);
        headingLine = heading.line;
        cursor = heading.end;
      }
    } else {
      const heading = nextLine(cursor);
      headingLine = heading.line;
      const found = chapter.content ? text.indexOf(chapter.content, heading.end) : -1;
      cursor = found >= 0 ? found + chapter.content.length : heading.end;
    }
    chapters.push({
      title: (chapter.title || `第${index + 1}章`).slice(0, MAX_TITLE_LENGTH),
      content: chapter.content,
      headingLine: headingLine.slice(0, 400),
    });
  }
  return { chapters, preambleChars };
}

function titleFromFileName(name: string, fallbackIndex: number): string {
  const base = (name.replace(/\\/gu, "/").split("/").pop() ?? "").replace(/\.[^.]+$/u, "");
  const stripped = base.replace(/^[\s\d_.\-、]+/u, "").trim();
  return (stripped || base.trim() || `第${fallbackIndex}章`).slice(0, MAX_TITLE_LENGTH);
}

function splitByFile(files: DecodedSource["files"]): { chapters: PlanChapter[]; notes: string[] } {
  const chapters: PlanChapter[] = [];
  const notes: string[] = [];
  for (const [index, file] of files.entries()) {
    const text = file.text.trim();
    let detected: ReturnType<typeof splitByRule> | undefined;
    try { detected = splitByRule(text); } catch { detected = undefined; }
    if (detected && detected.chapters.length === 1 && detected.preambleChars === 0) {
      chapters.push({ ...detected.chapters[0]!, sourceFile: file.name.slice(0, 400) });
      continue;
    }
    if (detected && detected.chapters.length > 1) {
      notes.push(`文件「${file.name}」里识别到 ${detected.chapters.length} 个章节标题，按文件切会把它们合成一章；如果这是多章合集，改用「按规则切分」。`);
    }
    chapters.push({ title: titleFromFileName(file.name, index + 1), content: text, headingLine: "", sourceFile: file.name.slice(0, 400) });
  }
  return { chapters, notes };
}

export function buildPlanFromSource(
  source: DecodedSource,
  split: ManuscriptImportJob["split"],
  meta: { readonly jobId: string; readonly sourceSha256: string; readonly revision: number },
): ManuscriptImportPlan {
  if (split.mode === "by-file") {
    const byFile = splitByFile(source.files);
    return { schemaVersion: MANUSCRIPT_IMPORT_SCHEMA_VERSION, ...meta, preambleChars: 0, notes: byFile.notes, chapters: byFile.chapters };
  }
  const text = source.files.map((file) => file.text.trim()).join("\n\n");
  const byRule = splitByRule(text, split.pattern);
  return { schemaVersion: MANUSCRIPT_IMPORT_SCHEMA_VERSION, ...meta, preambleChars: byRule.preambleChars, notes: [], chapters: byRule.chapters };
}

// ─── 计划编辑 ─────────────────────────────────────────────────────────────

export type PlanEdit =
  | { readonly op: "rename"; readonly index: number; readonly title: string }
  | { readonly op: "merge"; readonly index: number }
  | { readonly op: "split"; readonly index: number; readonly atLine: number; readonly title?: string };

function planIndex(plan: ManuscriptImportPlan, index: number): number {
  if (!Number.isSafeInteger(index) || index < 1 || index > plan.chapters.length) {
    fail("MANUSCRIPT_IMPORT_INVALID_INPUT", `第 ${index} 项不在当前切分里（共 ${plan.chapters.length} 章）。`, "切分可能已被别处改过。", "刷新导入页后再调整。");
  }
  return index - 1;
}

function cleanTitle(title: string): string {
  const value = title.replace(/\s+/gu, " ").trim();
  if (!value) fail("MANUSCRIPT_IMPORT_INVALID_INPUT", "章节标题不能为空。", "空标题的章节在目录里无法辨认。", "填写标题后再保存。");
  if (value.length > MAX_TITLE_LENGTH) fail("MANUSCRIPT_IMPORT_INVALID_INPUT", `章节标题最多 ${MAX_TITLE_LENGTH} 字。`, "过长的标题会让章节文件名被截断。", "缩短标题后再保存。");
  return value;
}

/**
 * 编辑切分计划（只在预览阶段）：改标题、与下一章合并、从某一行拆成两章。
 * 合并时把下一章的标题行还原进正文，误判的标题（如正文里恰好以「第一章节课…」开头的一行）不会丢字。
 */
export function applyPlanEdit(plan: ManuscriptImportPlan, edit: PlanEdit): ManuscriptImportPlan {
  const chapters = [...plan.chapters];
  if (edit.op === "rename") {
    const at = planIndex(plan, edit.index);
    chapters[at] = { ...chapters[at]!, title: cleanTitle(edit.title) };
  } else if (edit.op === "merge") {
    const at = planIndex(plan, edit.index);
    if (at + 1 >= chapters.length) {
      fail("MANUSCRIPT_IMPORT_INVALID_INPUT", "最后一章后面没有可以合并的章节。", "合并只能把相邻的两章并成一章。", "选择前一章与它合并。");
    }
    const first = chapters[at]!;
    const second = chapters[at + 1]!;
    const pieces = [first.content.trim(), second.headingLine.trim(), second.content.trim()].filter(Boolean);
    chapters.splice(at, 2, { ...first, content: pieces.join("\n\n") });
  } else {
    const at = planIndex(plan, edit.index);
    const chapter = chapters[at]!;
    const lines = chapter.content.split("\n");
    if (!Number.isSafeInteger(edit.atLine) || edit.atLine < 1 || edit.atLine >= lines.length) {
      fail("MANUSCRIPT_IMPORT_INVALID_INPUT", `拆分位置第 ${edit.atLine + 1} 行不在这一章正文内（共 ${lines.length} 行）。`, "拆分点必须在章内，前后各至少留一行。", "重新选择要作为新章开头的那一行。");
    }
    const head = lines.slice(0, edit.atLine).join("\n").trim();
    const startLine = lines[edit.atLine]!.trim();
    // 没给标题时，若那一行短得像标题就拿它当新章标题并从正文里去掉；否则保留在正文里。
    // 那一行本身是「第N章 标题」时按同一套分章规则取出标题，与自动切分得到的标题一致。
    const lineIsTitle = !edit.title && startLine.length > 0 && startLine.length <= 40;
    const tailLines = lineIsTitle ? lines.slice(edit.atLine + 1) : lines.slice(edit.atLine);
    const headingTitle = lineIsTitle ? (splitChapters(startLine)[0]?.title ?? "").trim() : "";
    const title = edit.title
      ? cleanTitle(edit.title)
      : lineIsTitle ? (headingTitle || startLine).slice(0, MAX_TITLE_LENGTH) : `${chapter.title}（下）`.slice(0, MAX_TITLE_LENGTH);
    if (!head) fail("MANUSCRIPT_IMPORT_INVALID_INPUT", "拆分点之前没有正文。", "拆出的前一章会是空章。", "选择更靠后的一行作为新章开头。");
    chapters.splice(at, 1, { ...chapter, content: head }, {
      title,
      content: tailLines.join("\n").trim(),
      headingLine: lineIsTitle ? startLine.slice(0, 400) : "",
      ...(chapter.sourceFile ? { sourceFile: chapter.sourceFile } : {}),
    });
  }
  return { ...plan, revision: plan.revision + 1, chapters };
}

// ─── 预览 ────────────────────────────────────────────────────────────────

export interface PlanAnomaly {
  readonly code: "empty" | "too-short" | "too-long" | "duplicate-title";
  readonly message: string;
}

export interface PlanPreviewChapter {
  readonly index: number;
  readonly title: string;
  readonly chars: number;
  readonly lineCount: number;
  readonly head: string;
  readonly tail: string;
  readonly sourceFile?: string;
  readonly anomalies: readonly PlanAnomaly[];
}

export interface PlanPreview {
  readonly revision: number;
  readonly chapterCount: number;
  readonly totalChars: number;
  readonly chapters: readonly PlanPreviewChapter[];
  /** 全局提示：序言未入章、未识别出章节、按文件切时的多章文件等。 */
  readonly warnings: readonly string[];
}

function visibleChars(text: string): number {
  return text.replace(/\s+/gu, "").length;
}

function snippet(text: string, fromEnd: boolean): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= PREVIEW_SNIPPET) return collapsed;
  return fromEnd ? `…${collapsed.slice(-PREVIEW_SNIPPET)}` : `${collapsed.slice(0, PREVIEW_SNIPPET)}…`;
}

function titleKey(title: string): string {
  return title.replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/** 预览与异常提示：过短 / 过长按全书中位数相对判定，并给绝对下限，避免短篇被误报。 */
export function previewPlan(plan: ManuscriptImportPlan): PlanPreview {
  const sizes = plan.chapters.map((chapter) => visibleChars(chapter.content));
  const typical = median(sizes);
  const shortLimit = Math.max(200, typical * 0.2);
  const longLimit = Math.max(20_000, typical * 3);
  const titleCounts = new Map<string, number>();
  for (const chapter of plan.chapters) {
    const key = titleKey(chapter.title);
    if (key) titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }
  const chapters = plan.chapters.map((chapter, offset): PlanPreviewChapter => {
    const chars = sizes[offset]!;
    const anomalies: PlanAnomaly[] = [];
    if (chars === 0) anomalies.push({ code: "empty", message: "这一章没有正文，可能是误判的标题行；可与下一章合并。" });
    else if (chars < shortLimit && plan.chapters.length > 1) anomalies.push({ code: "too-short", message: `只有 ${chars} 字，明显短于全书常见章长（约 ${Math.round(typical)} 字），可能是误切；核对后可与相邻章合并。` });
    if (chars > longLimit) anomalies.push({ code: "too-long", message: `有 ${chars} 字，远长于常见章长（约 ${Math.round(typical)} 字），可能漏认了章节标题；可从某一行拆开，或换规则重切。` });
    if ((titleCounts.get(titleKey(chapter.title)) ?? 0) > 1) anomalies.push({ code: "duplicate-title", message: `标题「${chapter.title}」与其他章重复，可能是同一章被导入了两次，或标题需要改。` });
    return {
      index: offset + 1,
      title: chapter.title,
      chars,
      lineCount: chapter.content.split("\n").length,
      head: snippet(chapter.content, false),
      tail: snippet(chapter.content, true),
      ...(chapter.sourceFile ? { sourceFile: chapter.sourceFile } : {}),
      anomalies,
    };
  });
  const warnings = [...plan.notes];
  if (plan.chapters.length === 0) warnings.push("没有识别出任何章节标题。换一条分章规则重切（例如以「楔子」「序章」或数字开头的行），或改用按文件切分。");
  if (plan.preambleChars > 0) warnings.push(`第一章标题之前有 ${plan.preambleChars} 字没有归入任何章节（多为作品信息或序言），导入时不会写进正文；需要保留的话，在原文里给它加上章节标题后重新导入。`);
  if (plan.chapters.length > MAX_MANUSCRIPT_CHAPTERS) warnings.push(`共 ${plan.chapters.length} 章，超过单次导入 ${MAX_MANUSCRIPT_CHAPTERS} 章上限，需要分卷导入。`);
  return {
    revision: plan.revision,
    chapterCount: plan.chapters.length,
    totalChars: sizes.reduce((sum, value) => sum + value, 0),
    chapters,
    warnings,
  };
}

/** 计划里某一章的完整正文按行返回，供作者选拆分点。 */
export function planChapterLines(plan: ManuscriptImportPlan, index: number): readonly string[] {
  return plan.chapters[planIndex(plan, index)]!.content.split("\n");
}
