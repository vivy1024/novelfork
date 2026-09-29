/**
 * 文风金库（T2.7）—— AI 原稿与作者改稿的对照。
 *
 * - AI 写章（pipeline.write、叙述者 chapter.write）落盘时，另存一份原稿到
 *   story/style-vault/chapter-NNNN.json。正文的唯一权威仍是章节文件；原稿只是历史样本，
 *   同章 AI 重写时覆盖为最新一版，作者保存从不写原稿。
 * - 人工占比：把当前正文与原稿逐句比对，原样保留的句子计为 AI，其余计为作者；
 *   规则确定、可解释，不依赖模型，也不声称能代表外部检测器的判断。
 * - 改稿样本：按段对齐，找出「与原稿相似但作者改过」的段落，组成 AI 原文 → 作者改稿对，
 *   供作者确认后采纳为本书范文（采纳走文风预设的既有保存路径，不在这里写预设）。
 */

import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";

import { CHAPTERS_DIRECTORY, readChapterIndex } from "../writing-resource/chapter-layout.js";
import { createStylePreset, STYLE_SCENE_TYPES, type StylePreset } from "./style-preset.js";
import { loadStylePreset, saveStylePreset, type LoadedStylePreset } from "./style-preset-store.js";

export const STYLE_VAULT_RELATIVE_DIR = join("story", "style-vault");

const AiDraftSchema = z.object({
  schemaVersion: z.literal(1),
  chapterNumber: z.number().int().positive(),
  text: z.string(),
  source: z.enum(["pipeline.write", "chapter.write"]),
  createdAt: z.string(),
}).strict();

export type ChapterAiDraft = z.infer<typeof AiDraftSchema>;

function draftFileName(chapterNumber: number): string {
  return `chapter-${String(chapterNumber).padStart(4, "0")}.json`;
}

/** 原子写：先写临时文件再改名，进程中断不会留下半个原稿。 */
export async function saveChapterAiDraft(
  bookRoot: string,
  input: { readonly chapterNumber: number; readonly text: string; readonly source: ChapterAiDraft["source"]; readonly now?: Date },
): Promise<void> {
  const dir = join(bookRoot, STYLE_VAULT_RELATIVE_DIR);
  await mkdir(dir, { recursive: true });
  const draft: ChapterAiDraft = {
    schemaVersion: 1,
    chapterNumber: input.chapterNumber,
    text: input.text,
    source: input.source,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  const temporary = join(dir, `.draft-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    await rename(temporary, join(dir, draftFileName(input.chapterNumber)));
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** 没有原稿返回 null；原稿损坏时抛错，调用方如实报告，不当作「没有 AI 参与」。 */
export async function readChapterAiDraft(bookRoot: string, chapterNumber: number): Promise<ChapterAiDraft | null> {
  const raw = await readFile(join(bookRoot, STYLE_VAULT_RELATIVE_DIR, draftFileName(chapterNumber)), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return null;
  const parsed = AiDraftSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`第 ${chapterNumber} 章的 AI 原稿文件格式不对，无法比对。`);
  return parsed.data;
}

async function listDraftChapters(bookRoot: string): Promise<Set<number>> {
  const names = await readdir(join(bookRoot, STYLE_VAULT_RELATIVE_DIR)).catch(() => [] as string[]);
  const chapters = new Set<number>();
  for (const name of names) {
    const match = /^chapter-(\d{4,})\.json$/u.exec(name);
    if (match) chapters.add(Number(match[1]));
  }
  return chapters;
}

// ─── 纯函数：逐句比对与段落对齐 ─────────────────────────────────────────

function normalize(text: string): string {
  return text.replace(/\r\n?/gu, "\n").replace(/[ \t　]+/gu, "").trim();
}

/** 按中文句末标点与换行切句；标点留在句尾，空句丢弃。 */
export function splitSentences(text: string): string[] {
  return normalize(text)
    .split(/(?<=[。！？!?…])|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export interface AuthorShare {
  /** 当前正文中原样来自 AI 原稿的字数。 */
  readonly aiChars: number;
  /** 当前正文中作者改写或新写的字数。 */
  readonly authorChars: number;
  readonly totalChars: number;
  /** 作者占比 0–1；正文为空时为 0。 */
  readonly authorRatio: number;
}

/**
 * 逐句比对：原稿里的句子按出现次数计入多重集合，当前正文的句子能在集合里匹配到就算 AI（匹配一次消耗一次），
 * 否则算作者。删掉的 AI 句子不计入当前正文，自然不影响占比。
 */
export function computeAuthorShare(aiText: string, currentText: string): AuthorShare {
  const pool = new Map<string, number>();
  for (const sentence of splitSentences(aiText)) pool.set(sentence, (pool.get(sentence) ?? 0) + 1);
  let aiChars = 0;
  let authorChars = 0;
  for (const sentence of splitSentences(currentText)) {
    const left = pool.get(sentence) ?? 0;
    if (left > 0) {
      pool.set(sentence, left - 1);
      aiChars += sentence.length;
    } else {
      authorChars += sentence.length;
    }
  }
  const totalChars = aiChars + authorChars;
  return { aiChars, authorChars, totalChars, authorRatio: totalChars > 0 ? authorChars / totalChars : 0 };
}

function bigrams(text: string): Set<string> {
  const compact = normalize(text).replace(/\s+/gu, "");
  const grams = new Set<string>();
  for (let i = 0; i < compact.length - 1; i += 1) grams.add(compact.slice(i, i + 2));
  return grams;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export interface RevisionPair {
  readonly aiText: string;
  readonly authorText: string;
  /** 两段的字符二元组相似度 0–1：太低是另起炉灶，太高是没怎么改。 */
  readonly similarity: number;
}

// 网文段落普遍很短（一两句对白就是一段），下限不能按出版物的段落长度定。
const MIN_PARAGRAPH_CHARS = 12;
const MIN_SIMILARITY = 0.25;
const MAX_SIMILARITY = 0.9;

/**
 * 按段对齐改稿：每个当前段落找最相似的原稿段落，相似度落在「改过但还认得出」区间的记为一对。
 * 同一原稿段只配一次；结果按改动幅度从大到小排序。
 */
export function extractRevisionPairs(aiText: string, currentText: string, limit = 8): RevisionPair[] {
  const paragraphs = (text: string) => normalize(text).split(/\n+/u).map((item) => item.trim()).filter((item) => item.length >= MIN_PARAGRAPH_CHARS);
  const aiParagraphs = paragraphs(aiText).map((text) => ({ text, grams: bigrams(text) }));
  const used = new Set<number>();
  const pairs: RevisionPair[] = [];
  for (const current of paragraphs(currentText)) {
    const grams = bigrams(current);
    let best = -1;
    let bestScore = 0;
    aiParagraphs.forEach((candidate, index) => {
      if (used.has(index)) return;
      const score = similarity(grams, candidate.grams);
      if (score > bestScore) { bestScore = score; best = index; }
    });
    if (best < 0 || bestScore < MIN_SIMILARITY || bestScore >= MAX_SIMILARITY) continue;
    used.add(best);
    pairs.push({ aiText: aiParagraphs[best]!.text, authorText: current, similarity: Math.round(bestScore * 1000) / 1000 });
  }
  return pairs.sort((a, b) => a.similarity - b.similarity).slice(0, limit);
}

// ─── 全书视图 ───────────────────────────────────────────────────────────

export interface ChapterVaultSummary {
  readonly chapterNumber: number;
  readonly title: string;
  readonly hasAiDraft: boolean;
  readonly share?: AuthorShare;
  /** 原稿存在但无法读取时的原因。 */
  readonly error?: string;
}

async function readCurrentChapterText(bookRoot: string, fileName: string): Promise<string> {
  return readFile(join(bookRoot, CHAPTERS_DIRECTORY, fileName), "utf8");
}

export async function summarizeStyleVault(bookRoot: string): Promise<{
  readonly chapters: readonly ChapterVaultSummary[];
  /** 有原稿的章合计的作者占比（按字数加权）；没有任何原稿时为 null。 */
  readonly overallAuthorRatio: number | null;
}> {
  const [index, drafted] = await Promise.all([readChapterIndex(bookRoot), listDraftChapters(bookRoot)]);
  const chapters: ChapterVaultSummary[] = [];
  let authorChars = 0;
  let totalChars = 0;
  for (const entry of [...index].sort((a, b) => a.number - b.number)) {
    if (!drafted.has(entry.number)) {
      chapters.push({ chapterNumber: entry.number, title: entry.title, hasAiDraft: false });
      continue;
    }
    try {
      const draft = await readChapterAiDraft(bookRoot, entry.number);
      const current = await readCurrentChapterText(bookRoot, entry.fileName);
      const share = computeAuthorShare(draft?.text ?? "", current);
      authorChars += share.authorChars;
      totalChars += share.totalChars;
      chapters.push({ chapterNumber: entry.number, title: entry.title, hasAiDraft: true, share });
    } catch (error) {
      chapters.push({ chapterNumber: entry.number, title: entry.title, hasAiDraft: true, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { chapters, overallAuthorRatio: totalChars > 0 ? authorChars / totalChars : null };
}

export async function readChapterVaultDetail(bookRoot: string, chapterNumber: number): Promise<{
  readonly chapterNumber: number;
  readonly hasAiDraft: boolean;
  readonly share?: AuthorShare;
  readonly revisionPairs: readonly RevisionPair[];
  readonly draftCreatedAt?: string;
}> {
  const entry = (await readChapterIndex(bookRoot)).find((item) => item.number === chapterNumber);
  if (!entry) throw new Error(`第 ${chapterNumber} 章不在章节索引里。`);
  const draft = await readChapterAiDraft(bookRoot, chapterNumber);
  if (!draft) return { chapterNumber, hasAiDraft: false, revisionPairs: [] };
  const current = await readCurrentChapterText(bookRoot, entry.fileName);
  return {
    chapterNumber,
    hasAiDraft: true,
    share: computeAuthorShare(draft.text, current),
    revisionPairs: extractRevisionPairs(draft.text, current),
    draftCreatedAt: draft.createdAt,
  };
}

// ─── 采纳改稿为本书范文 ─────────────────────────────────────────────────

/** 作者改稿在文风预设里的固定来源；排在来源最前，写作注入时作者本人的写法优先被召回。 */
export const AUTHOR_REVISION_SOURCE_ID = "author-revisions";

export interface AdoptRevisionInput {
  readonly chapterNumber: number;
  /** 作者改稿段（成为范文正文）。 */
  readonly authorText: string;
  /** 对应的 AI 原文段（作为证据保存，说明作者改了什么）。 */
  readonly aiText: string;
  readonly sceneType?: (typeof STYLE_SCENE_TYPES)[number];
}

function sampleId(chapterNumber: number, authorText: string): string {
  return `rev-${chapterNumber}-${createHash("sha256").update(authorText).digest("hex").slice(0, 10)}`;
}

/**
 * 把作者点名的改稿段写进预设的「作者改稿」来源。作者主动采纳即视为确认，标 confirmed + 可迁移；
 * 同一段重复采纳按内容去重。版本不一致时由 saveStylePreset 抛 STYLE_PRESET_CONFLICT，不覆盖别处的修改。
 */
export async function adoptRevisionSamples(
  bookRoot: string,
  inputs: readonly AdoptRevisionInput[],
  expectedRevision: string | null,
): Promise<LoadedStylePreset> {
  const loaded = await loadStylePreset(bookRoot);
  const preset: StylePreset = loaded.preset ?? createStylePreset();
  const existing = preset.sources.find((source) => source.id === AUTHOR_REVISION_SOURCE_ID);
  const samples = [...(existing?.samples ?? [])];
  for (const input of inputs) {
    const id = sampleId(input.chapterNumber, input.authorText);
    if (samples.some((sample) => sample.id === id)) continue;
    samples.push({
      id,
      sceneType: input.sceneType ?? "general",
      text: input.authorText.slice(0, 4_000),
      evidence: `第${input.chapterNumber}章作者改稿；AI 原文：${input.aiText}`.slice(0, 4_000),
      transfer: "transferable",
      status: "confirmed",
    });
  }
  // 预设单来源最多 100 段：超出时保留最新采纳的，旧的让位（顺序即采纳先后）。
  const kept = samples.slice(-100);
  const source = { id: AUTHOR_REVISION_SOURCE_ID, title: "作者改稿", rules: existing?.rules ?? [], samples: kept };
  const next: StylePreset = {
    ...preset,
    sources: [source, ...preset.sources.filter((item) => item.id !== AUTHOR_REVISION_SOURCE_ID)],
  };
  return saveStylePreset(bookRoot, next, expectedRevision);
}
