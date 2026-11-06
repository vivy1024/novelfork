/**
 * 卷摘要 / 全书梗概的生成、结算后排队刷新与存量回填。
 *
 * 输入只用章摘要（经纬 chapter-summaries），不读正文：一卷几十章的摘要合计几千字，够模型归纳，
 * 也让每条结论都能回指到具体章摘要（FABLES：摘要会引入不忠实陈述，必须可回溯）。
 * 均匀覆盖（FABLES：摘要系统性偏重结尾）：
 *   - 提示词要求按开头 / 中段 / 结尾分段落笔，每段都要写到；
 *   - 卷内章数超过 CHUNK_THRESHOLD 时先按 CHUNK_SIZE 章一组分段归纳，再合并（RAPTOR 式按章结构建树），
 *     模型不会因输入过长只看到末尾；
 *   - 全书梗概由各卷卷摘要再压缩一次，要求每卷都写到。
 *
 * 触发（不阻塞结算）：结算写完本章章摘要后，把「刷新本书层级前情」排进按书串行的后台队列：
 *   - 已写完的卷（最新章摘要已到卷末）缺失或过期 → 生成卷摘要（每次最多 MAX_VOLUMES_PER_RUN 卷，就近优先）；
 *   - 当前卷每满 CHECKPOINT_CHAPTERS 章 → 生成一份阶段卷摘要（卷未完时召回用它代替逐章首句）；
 *   - 下一章召回需要的全书梗概缺失或过期 → 在折叠卷的卷摘要齐全时生成。
 * 失败只记日志；下一次结算或手动回填会重新发现缺失 / 过期并重试。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  arcSummaryId,
  arcSummaryTableExists,
  chapterSummaryFingerprint,
  getArcSummary,
  isArcSummaryFresh,
  listArcSummaries,
  reviveArcSummary,
  rowsInRange,
  synopsisSegmentId,
  upsertArcSummary,
  type ArcSummaryContent,
  type ArcSummaryRecord,
} from "./arc-summary-store.js";
import { loadConfirmedChapterSummaries, type ChapterSummaryRow } from "./chapter-summary-source.js";
import { DEFAULT_PRIOR_VOLUME_CARDS, firstSentence, planStoryArc, type StoryArcSegment } from "./story-arc.js";

export type ArcSummaryGenerateText = (request: {
  messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
}) => Promise<{ text: string; model?: string }>;

/** 当前卷阶段摘要的步长：每满这么多章生成一份。 */
export const CHECKPOINT_CHAPTERS = 25;
/** 每次结算后最多补几卷（就近优先）；更早的缺口交给手动回填。 */
export const MAX_VOLUMES_PER_RUN = 2;
const CHUNK_THRESHOLD = 60;
const CHUNK_SIZE = 40;
const PER_CHAPTER_INPUT_CHARS = 160;
const VOLUME_TEXT_MAX = 600;
const SYNOPSIS_TEXT_MAX = 1200;
const GIST_MAX = 120;

export function checkpointSegmentId(segmentId: string, checkpointChapter: number): string {
  return `${segmentId}@${checkpointChapter}`;
}

function clip(text: string, max: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function parseModelJson(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  const body = fenced ?? text.trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(body.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** 解析模型输出；摘要为空视为失败。关键章只保留来源章号里的（防编造回指）。 */
export function parseArcSummaryResponse(text: string, sourceChapters: readonly number[], maxChars: number): ArcSummaryContent {
  const parsed = parseModelJson(text);
  const summaryRaw = typeof parsed?.summary === "string" ? parsed.summary : "";
  if (!summaryRaw.trim()) throw new Error("模型没有给出可用的摘要（缺 summary 字段或为空）。");
  const summary = clip(summaryRaw, maxChars);
  const gistRaw = typeof parsed?.gist === "string" && parsed.gist.trim() ? parsed.gist : firstSentence(summary, GIST_MAX);
  const allowed = new Set(sourceChapters);
  const keyChapters = Array.isArray(parsed?.keyChapters)
    ? [...new Set(parsed.keyChapters.map((value) => Number(value)).filter((value) => Number.isInteger(value) && allowed.has(value)))].sort((a, b) => a - b).slice(0, 10)
    : [];
  return { text: summary, gist: clip(gistRaw, GIST_MAX), keyChapters };
}

function chapterLines(rows: readonly ChapterSummaryRow[]): string {
  return rows.map((row) => `第${row.chapter}章${row.fieldTitle ? `《${row.fieldTitle}》` : ""}：${clip(row.summary, PER_CHAPTER_INPUT_CHARS)}`).join("\n");
}

const VOLUME_SYSTEM_PROMPT = [
  "你是长篇网文的卷摘要整理器。只依据给出的逐章摘要归纳，不得补充摘要里没有的情节、人物、设定或因果。",
  "输出严格 JSON（不要解释、不要代码块围栏）：",
  '{"summary":"300-450字的卷摘要","gist":"一句话概括（不超过80字）","keyChapters":[章号]}',
  "summary 按时间顺序写，开头、中段、结尾三部分的篇幅大致相当，每部分都要写到，不能只写结尾；",
  "写清主要人物的处境变化、关键冲突与结果、仍未解决的悬念。",
  "keyChapters 选 3-8 个情节转折所在的章，只能从给出的章号里选。",
].join("\n");

const PART_SYSTEM_PROMPT = [
  "你是长篇网文的分段摘要整理器。只依据给出的逐章摘要归纳，不得补充摘要里没有的内容。",
  "输出严格 JSON（不要解释、不要代码块围栏）：",
  '{"summary":"150-250字，按时间顺序均匀覆盖这一段的开头、中段、结尾","gist":"一句话","keyChapters":[章号]}',
  "keyChapters 只能从给出的章号里选。",
].join("\n");

const SYNOPSIS_SYSTEM_PROMPT = [
  "你是长篇网文的全书梗概整理器。只依据给出的各卷卷摘要压缩，不得补充其中没有的内容。",
  "输出严格 JSON（不要解释、不要代码块围栏）：",
  '{"summary":"不超过900字的梗概","gist":"一句话概括（不超过80字）","keyChapters":[章号]}',
  "summary 按卷的先后写，每一卷都要写到且篇幅大致均衡，不能只写最近几卷；写清主线走向与人物处境的变化。",
  "keyChapters 选整段里最关键的 3-10 个转折章，只能从各卷给出的章号里选。",
].join("\n");

async function callModel(
  generateText: ArcSummaryGenerateText,
  system: string,
  user: string,
  sourceChapters: readonly number[],
  maxChars: number,
  maxTokens: number,
): Promise<{ content: ArcSummaryContent; model?: string }> {
  const response = await generateText({
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.2,
    maxTokens,
  });
  return { content: parseArcSummaryResponse(response.text, sourceChapters, maxChars), ...(response.model ? { model: response.model } : {}) };
}

/** 把章均匀切成若干组（每组 ≤ CHUNK_SIZE），避免最后一组只剩零头。 */
function evenChunks<T>(items: readonly T[], size: number): T[][] {
  const count = Math.ceil(items.length / size);
  const per = Math.ceil(items.length / count);
  return Array.from({ length: count }, (_, index) => items.slice(index * per, (index + 1) * per)).filter((chunk) => chunk.length > 0);
}

export interface GenerateVolumeSummaryInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly segment: StoryArcSegment;
  /** 覆盖到的末章（完整卷 = segment.to；阶段摘要 = 检查点章）。 */
  readonly through: number;
  readonly rows: readonly ChapterSummaryRow[];
  readonly generateText: ArcSummaryGenerateText;
  readonly now?: () => Date;
}

/** 生成并落盘一卷（或一卷前段）的卷摘要。rows 为本书章摘要（会按区间过滤）。 */
export async function generateVolumeSummary(input: GenerateVolumeSummaryInput): Promise<ArcSummaryRecord> {
  const { segment } = input;
  const inRange = rowsInRange(input.rows, segment.from, input.through).sort((a, b) => a.chapter - b.chapter);
  if (inRange.length === 0) throw new Error(`《${segment.title}》第${segment.from}–${input.through}章没有章摘要，无法归纳。`);
  const sourceChapters = inRange.map((row) => row.chapter);
  const fingerprint = chapterSummaryFingerprint(inRange);
  const header = `《${segment.title}》第${segment.from}–${input.through}章${segment.goal ? `（卷目标：${segment.goal}）` : ""}`;

  let result: { content: ArcSummaryContent; model?: string };
  if (inRange.length <= CHUNK_THRESHOLD) {
    result = await callModel(input.generateText, VOLUME_SYSTEM_PROMPT, `${header}，共 ${inRange.length} 章摘要：\n${chapterLines(inRange)}`, sourceChapters, VOLUME_TEXT_MAX, 900);
  } else {
    const parts: { from: number; to: number; content: ArcSummaryContent }[] = [];
    for (const chunk of evenChunks(inRange, CHUNK_SIZE)) {
      const from = chunk[0]!.chapter;
      const to = chunk.at(-1)!.chapter;
      const part = await callModel(
        input.generateText,
        PART_SYSTEM_PROMPT,
        `${header} 中的第${from}–${to}章，共 ${chunk.length} 章摘要：\n${chapterLines(chunk)}`,
        chunk.map((row) => row.chapter),
        400,
        600,
      );
      parts.push({ from, to, content: part.content });
    }
    const merged = parts.map((part) => `【第${part.from}–${part.to}章】${part.content.text}（关键章：${part.content.keyChapters.join("、") || "无"}）`).join("\n");
    result = await callModel(input.generateText, VOLUME_SYSTEM_PROMPT, `${header}，已按章分段归纳为 ${parts.length} 段（各段篇幅相当，合并时每段都要写到）：\n${merged}`, sourceChapters, VOLUME_TEXT_MAX, 900);
  }

  const isCheckpoint = input.through < segment.to;
  const record = upsertArcSummary(input.storage, {
    bookId: input.bookId,
    kind: "volume",
    segmentId: isCheckpoint ? checkpointSegmentId(segment.id, input.through) : segment.id,
    segmentTitle: segment.title,
    chapterFrom: segment.from,
    chapterTo: input.through,
    sourceChapters,
    inputFingerprint: fingerprint,
    content: result.content,
    ...(result.model ? { model: result.model } : {}),
    generatedAt: (input.now?.() ?? new Date()).getTime(),
  });
  // 召回只用整卷摘要或最近一个检查点：整卷落盘后清掉本卷全部阶段摘要，新检查点落盘后清掉更早的检查点。
  deleteCheckpointRows(input.storage, input.bookId, segment.id, isCheckpoint ? record.id : undefined);
  return record;
}

function deleteCheckpointRows(storage: StorageDatabase, bookId: string, segmentId: string, keepId?: string): void {
  const prefix = `${segmentId}@`;
  const stale = listArcSummaries(storage, bookId, "volume").filter((record) => record.segmentId.startsWith(prefix) && record.id !== keepId);
  const remove = storage.sqlite.prepare(`DELETE FROM narrative_arc_summary WHERE book_id = ? AND id = ?`);
  for (const record of stale) remove.run(bookId, record.id);
}

export interface GenerateSynopsisInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  /** 被折叠进梗概的卷（按章号升序），每卷都必须已有未过期的卷摘要。 */
  readonly segments: readonly StoryArcSegment[];
  readonly volumeRecords: readonly ArcSummaryRecord[];
  readonly rows: readonly ChapterSummaryRow[];
  readonly generateText: ArcSummaryGenerateText;
  readonly now?: () => Date;
}

export async function generateSynopsis(input: GenerateSynopsisInput): Promise<ArcSummaryRecord> {
  if (input.segments.length === 0) throw new Error("没有可折叠的卷。");
  const from = input.segments[0]!.from;
  const to = input.segments.at(-1)!.to;
  const inRange = rowsInRange(input.rows, from, to).sort((a, b) => a.chapter - b.chapter);
  const byId = new Map(input.volumeRecords.map((record) => [record.segmentId, record]));
  const blocks = input.segments.map((segment) => {
    const record = byId.get(segment.id);
    if (!record) throw new Error(`《${segment.title}》还没有卷摘要，先生成卷摘要再生成全书梗概。`);
    return `【${segment.title}·第${segment.from}–${segment.to}章】${record.content.text}（关键章：${record.content.keyChapters.join("、") || "无"}）`;
  });
  const sourceChapters = inRange.map((row) => row.chapter);
  const result = await callModel(
    input.generateText,
    SYNOPSIS_SYSTEM_PROMPT,
    `第${from}–${to}章，共 ${input.segments.length} 卷的卷摘要：\n${blocks.join("\n")}`,
    sourceChapters,
    SYNOPSIS_TEXT_MAX,
    1500,
  );
  return upsertArcSummary(input.storage, {
    bookId: input.bookId,
    kind: "synopsis",
    segmentId: synopsisSegmentId(input.segments.at(-1)!.id),
    segmentTitle: `${input.segments[0]!.title}至${input.segments.at(-1)!.title}`,
    chapterFrom: from,
    chapterTo: to,
    sourceChapters,
    inputFingerprint: chapterSummaryFingerprint(inRange),
    content: { ...result.content, volumeIds: input.segments.map((segment) => segment.id) },
    ...(result.model ? { model: result.model } : {}),
    generatedAt: (input.now?.() ?? new Date()).getTime(),
  });
}

// ---------------------------------------------------------------------------
// 规划：哪些卷摘要 / 梗概缺失或过期
// ---------------------------------------------------------------------------

export type ArcTargetState = "missing" | "stale" | "fresh";

export interface ArcSummaryTarget {
  readonly kind: "volume" | "checkpoint" | "synopsis";
  readonly segmentId: string;
  readonly title: string;
  readonly from: number;
  readonly to: number;
  readonly state: ArcTargetState;
  /** 待确认 / 已确认（state=fresh 时有意义）。 */
  readonly status?: ArcSummaryRecord["status"];
  /** 梗概：折叠进来的卷。 */
  readonly segments?: readonly StoryArcSegment[];
  /** 梗概：折叠卷里还缺卷摘要的，缺时暂不生成。 */
  readonly blockedBy?: readonly string[];
  readonly segment?: StoryArcSegment;
}

export interface ArcSummaryPlan {
  readonly latestChapter: number;
  readonly targets: readonly ArcSummaryTarget[];
  readonly rows: readonly ChapterSummaryRow[];
}

function stateOf(record: ArcSummaryRecord | undefined, rows: readonly ChapterSummaryRow[], from: number, to: number): ArcTargetState {
  if (!record) return "missing";
  return isArcSummaryFresh(record, rows, { from, to }) ? "fresh" : "stale";
}

/**
 * 按「写下一章」时的召回口径规划：已写完的卷、当前卷的最近检查点、下一章召回会用到的全书梗概。
 * priorVolumeCards 与召回保持一致（默认 5）：只有更早的卷才折叠进梗概。
 */
export function planArcSummaries(storage: StorageDatabase, bookId: string, options: { readonly priorVolumeCards?: number } = {}): ArcSummaryPlan {
  const rows = loadConfirmedChapterSummaries(storage, bookId);
  const latestChapter = rows.at(-1)?.chapter ?? 0;
  if (latestChapter <= 0) return { latestChapter: 0, targets: [], rows };
  const records = new Map(listArcSummaries(storage, bookId).map((record) => [`${record.kind}:${record.segmentId}`, record]));
  const plan = planStoryArc(storage, bookId, latestChapter + 1);
  const targets: ArcSummaryTarget[] = [];

  const completed = plan.prior.filter((segment) => rowsInRange(rows, segment.from, segment.to).length > 0);
  for (const segment of completed) {
    const record = records.get(`volume:${segment.id}`);
    targets.push({
      kind: "volume", segmentId: segment.id, title: segment.title, from: segment.from, to: segment.to, segment,
      state: stateOf(record, rows, segment.from, segment.to),
      ...(record ? { status: record.status } : {}),
    });
  }

  const current = plan.current;
  const written = latestChapter - current.from + 1;
  const checkpoint = current.from + Math.floor(written / CHECKPOINT_CHAPTERS) * CHECKPOINT_CHAPTERS - 1;
  if (written >= CHECKPOINT_CHAPTERS && checkpoint < current.to && rowsInRange(rows, current.from, checkpoint).length > 0) {
    const segmentId = checkpointSegmentId(current.id, checkpoint);
    const record = records.get(`volume:${segmentId}`);
    targets.push({
      kind: "checkpoint", segmentId, title: current.title, from: current.from, to: checkpoint, segment: current,
      state: stateOf(record, rows, current.from, checkpoint),
      ...(record ? { status: record.status } : {}),
    });
  }

  const priorLimit = Math.max(0, options.priorVolumeCards ?? DEFAULT_PRIOR_VOLUME_CARDS);
  const folded = completed.slice(0, Math.max(0, completed.length - priorLimit));
  if (folded.length > 0) {
    const segmentId = synopsisSegmentId(folded.at(-1)!.id);
    const record = records.get(`synopsis:${segmentId}`);
    const blockedBy = folded
      .filter((segment) => stateOf(records.get(`volume:${segment.id}`), rows, segment.from, segment.to) !== "fresh")
      .map((segment) => segment.id);
    targets.push({
      kind: "synopsis", segmentId, title: `${folded[0]!.title}至${folded.at(-1)!.title}`, from: folded[0]!.from, to: folded.at(-1)!.to,
      segments: folded,
      blockedBy,
      state: stateOf(record, rows, folded[0]!.from, folded.at(-1)!.to),
      ...(record ? { status: record.status } : {}),
    });
  }
  return { latestChapter, targets, rows };
}

export interface RunArcSummaryInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly generateText: ArcSummaryGenerateText;
  readonly now?: () => Date;
  /** 最多补几卷；缺省不限。 */
  readonly maxVolumes?: number;
  /** 就近优先（结算后刷新）还是从早到晚（回填）。 */
  readonly order?: "nearest-first" | "oldest-first";
  readonly priorVolumeCards?: number;
}

export interface RunArcSummaryResult {
  readonly generated: readonly string[];
  readonly failed: readonly { readonly segmentId: string; readonly error: string }[];
  readonly skipped: readonly { readonly segmentId: string; readonly reason: string }[];
}

/** 补齐缺失 / 过期的卷摘要、阶段摘要与全书梗概。单项失败不影响其余项。 */
export async function runArcSummaryGeneration(input: RunArcSummaryInput): Promise<RunArcSummaryResult> {
  const generated: string[] = [];
  const failed: { segmentId: string; error: string }[] = [];
  const skipped: { segmentId: string; reason: string }[] = [];
  if (!arcSummaryTableExists(input.storage)) {
    return { generated, failed, skipped: [{ segmentId: "*", reason: "数据库还没有层级前情表（迁移未执行）。" }] };
  }
  const plan = planArcSummaries(input.storage, input.bookId, { priorVolumeCards: input.priorVolumeCards });
  // 被标过期但指纹仍一致的（重结算后章摘要没变）恢复原状态，不重新生成、不丢作者确认。
  for (const target of plan.targets) {
    if (target.state === "fresh" && target.status === "stale") {
      reviveArcSummary(input.storage, input.bookId, arcSummaryId(input.bookId, target.kind === "synopsis" ? "synopsis" : "volume", target.segmentId));
    }
  }
  const pending = plan.targets.filter((target) => target.kind !== "synopsis" && target.state !== "fresh");
  const ordered = input.order === "oldest-first" ? pending : [...pending].reverse();
  const limited = input.maxVolumes === undefined ? ordered : ordered.slice(0, Math.max(0, input.maxVolumes));
  for (const target of ordered.slice(limited.length)) skipped.push({ segmentId: target.segmentId, reason: "本次不处理，留给下次或手动回填。" });

  for (const target of limited) {
    try {
      await generateVolumeSummary({
        storage: input.storage, bookId: input.bookId, segment: target.segment!, through: target.to, rows: plan.rows, generateText: input.generateText,
        ...(input.now ? { now: input.now } : {}),
      });
      generated.push(target.segmentId);
    } catch (error) {
      failed.push({ segmentId: target.segmentId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const synopsis = plan.targets.find((target) => target.kind === "synopsis");
  if (synopsis && synopsis.state !== "fresh") {
    // 卷摘要刚补过，按当前库重新判断折叠卷是否齐全。
    const volumeRecords = (synopsis.segments ?? []).map((segment) => getArcSummary(input.storage, input.bookId, "volume", segment.id));
    const missing = (synopsis.segments ?? []).filter((segment, index) => {
      const record = volumeRecords[index];
      return !record || !isArcSummaryFresh(record, plan.rows, { from: segment.from, to: segment.to });
    });
    if (missing.length > 0) {
      skipped.push({ segmentId: synopsis.segmentId, reason: `还缺 ${missing.length} 卷的卷摘要，暂不生成全书梗概。` });
    } else {
      try {
        await generateSynopsis({
          storage: input.storage, bookId: input.bookId, segments: synopsis.segments ?? [], volumeRecords: volumeRecords as ArcSummaryRecord[], rows: plan.rows,
          generateText: input.generateText, ...(input.now ? { now: input.now } : {}),
        });
        generated.push(synopsis.segmentId);
      } catch (error) {
        failed.push({ segmentId: synopsis.segmentId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { generated, failed, skipped };
}

// ---------------------------------------------------------------------------
// 结算后的后台队列（按书串行，不阻塞结算）
// ---------------------------------------------------------------------------

const queues = new Map<string, Promise<void>>();

export interface ScheduleArcSummaryRefreshInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly generateText: ArcSummaryGenerateText;
  readonly now?: () => Date;
  /** 失败时的回调（缺省写 console.warn）。 */
  readonly onError?: (message: string) => void;
}

export type ArcSummaryScheduler = (input: ScheduleArcSummaryRefreshInput) => void;

/** 排进后台队列：立即返回；同一本书的刷新串行执行，避免并发重复生成。 */
export const scheduleArcSummaryRefresh: ArcSummaryScheduler = (input) => {
  const report = input.onError ?? ((message: string) => console.warn(`[arc-summary] ${message}`));
  const previous = queues.get(input.bookId) ?? Promise.resolve();
  const next = previous
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    .then(async () => {
      const result = await runArcSummaryGeneration({
        storage: input.storage,
        bookId: input.bookId,
        generateText: input.generateText,
        maxVolumes: MAX_VOLUMES_PER_RUN,
        order: "nearest-first",
        ...(input.now ? { now: input.now } : {}),
      });
      for (const item of result.failed) report(`《${input.bookId}》${item.segmentId} 层级前情生成失败（下次结算或手动回填会重试）：${item.error}`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      // 排队后数据库已关闭（进程退出、测试收尾）：不算失败，下次结算会重新发现缺口。
      if (/database is not open|database has closed|closed database/iu.test(message)) return;
      report(`《${input.bookId}》层级前情刷新失败（下次结算或手动回填会重试）：${message}`);
    });
  queues.set(input.bookId, next);
  void next.finally(() => {
    if (queues.get(input.bookId) === next) queues.delete(input.bookId);
  });
};

/** 等待后台队列清空（测试与回填前使用）。 */
export async function drainArcSummaryQueue(bookId?: string): Promise<void> {
  if (bookId) {
    while (queues.has(bookId)) await queues.get(bookId);
    return;
  }
  while (queues.size > 0) await Promise.all([...queues.values()]);
}

// ---------------------------------------------------------------------------
// 存量回填（维护入口）
// ---------------------------------------------------------------------------

export interface BackfillArcSummariesInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly dryRun?: boolean;
  readonly generateText?: ArcSummaryGenerateText;
  readonly now?: () => Date;
  readonly maxVolumes?: number;
}

export interface BackfillArcSummariesResult {
  readonly bookId: string;
  readonly dryRun: boolean;
  readonly latestChapter: number;
  readonly targets: readonly Omit<ArcSummaryTarget, "segment" | "segments">[];
  readonly toGenerate: number;
  readonly generated: readonly string[];
  readonly failed: readonly { readonly segmentId: string; readonly error: string }[];
  readonly skipped: readonly { readonly segmentId: string; readonly reason: string }[];
}

/**
 * 为已有书补卷摘要与全书梗概。dryRun 只报告哪些缺失 / 过期，不调模型、不写库。
 * 非 dryRun 时从早到晚补齐，单卷失败不影响其余卷；再跑一次只补失败与新过期的。
 */
export async function backfillArcSummaries(input: BackfillArcSummariesInput): Promise<BackfillArcSummariesResult> {
  const dryRun = input.dryRun !== false;
  await drainArcSummaryQueue(input.bookId);
  const plan = planArcSummaries(input.storage, input.bookId);
  const targets = plan.targets.map(({ segment: _segment, segments: _segments, ...rest }) => rest);
  const toGenerate = plan.targets.filter((target) => target.state !== "fresh").length;
  if (dryRun) {
    return { bookId: input.bookId, dryRun, latestChapter: plan.latestChapter, targets, toGenerate, generated: [], failed: [], skipped: [] };
  }
  if (!input.generateText) throw new Error("回填需要可用的文本模型。");
  const result = await runArcSummaryGeneration({
    storage: input.storage,
    bookId: input.bookId,
    generateText: input.generateText,
    order: "oldest-first",
    ...(input.maxVolumes !== undefined ? { maxVolumes: input.maxVolumes } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
  const after = planArcSummaries(input.storage, input.bookId).targets.map(({ segment: _segment, segments: _segments, ...rest }) => rest);
  return { bookId: input.bookId, dryRun, latestChapter: plan.latestChapter, targets: after, toGenerate, ...result };
}
