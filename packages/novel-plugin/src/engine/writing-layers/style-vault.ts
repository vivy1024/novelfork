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

import { mkdir, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";

import { CHAPTERS_DIRECTORY, readChapterIndex } from "../writing-resource/chapter-layout.js";
import { resolveChapterFile } from "../writing-resource/chapter-path-guard.js";
import { createStylePreset, STYLE_SCENE_TYPES, type StylePreset } from "./style-preset.js";
import { loadStylePreset, saveStylePreset, StylePresetError, type LoadedStylePreset } from "./style-preset-store.js";
import {
  computeVaultFingerprint, fingerprintRefreshStatus, stampExternalBasis, type FingerprintRefreshStatus,
} from "./style-vault-fingerprint.js";
import { writeFileAtomic } from "../writing-resource/atomic-write.js";

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
  // 原子写（fsync + rename，Windows 瞬时占用自动重试）：写入中断时 AI 草稿只会是旧版或新版。
  await writeFileAtomic(join(dir, draftFileName(input.chapterNumber)), `${JSON.stringify(draft, null, 2)}\n`);
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

// 逐句比对与段落对齐的纯函数在 style-vault-share.ts（前端实时徽标共用）。
export { computeAuthorShare, extractRevisionPairs, splitSentences, type AuthorShare, type RevisionPair } from "./style-vault-share.js";
import { computeAuthorShare, extractRevisionPairs, type AuthorShare, type RevisionPair } from "./style-vault-share.js";

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
  const path = resolveChapterFile(join(bookRoot, CHAPTERS_DIRECTORY), fileName);
  if (!path) throw new Error(`章节文件路径不在章节目录内：${JSON.stringify(fileName)}`);
  return readFile(path, "utf8");
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

/**
 * 采纳某段作者改稿时生成的范文 id（确定性：同章同文同 id）。
 * 聚合「未采纳改稿段」时用它与预设里的已采纳范文对账，不要另造一套 id。
 */
export function revisionSampleId(chapterNumber: number, authorText: string): string {
  return `rev-${chapterNumber}-${createHash("sha256").update(authorText).digest("hex").slice(0, 10)}`;
}

export interface FingerprintRefreshResult {
  /** refreshed：本次已重算；pending：未到阈值；skipped：到了阈值但放弃（见 reason），指纹保持原样。 */
  readonly outcome: "refreshed" | "pending" | "skipped";
  /** 写入后（或放弃时按当时预设）的计数状态。 */
  readonly status: FingerprintRefreshStatus;
  readonly reason?: string;
}

export type AdoptRevisionResult = LoadedStylePreset & { readonly fingerprintRefresh: FingerprintRefreshResult };

function revisionSamplesOf(preset: StylePreset | null) {
  return preset?.sources.find((source) => source.id === AUTHOR_REVISION_SOURCE_ID)?.samples ?? [];
}

/** 文风金库面板展示用：当前指纹已计入多少段作者改稿、还差多少段更新。预设读不出时返回 null，不拖垮占比视图。 */
export async function readVaultFingerprintStatus(bookRoot: string): Promise<FingerprintRefreshStatus | null> {
  try {
    const loaded = await loadStylePreset(bookRoot);
    return fingerprintRefreshStatus(loaded.preset?.fingerprint ?? null, revisionSamplesOf(loaded.preset));
  } catch {
    return null;
  }
}

/**
 * 新增作者改稿达阈值时重算统计指纹。只替换 fingerprint，指南、范文、来源规则原样保留；
 * 以调用方读到的版本号写入：期间作者又保存过预设时放弃本次重算并给出原因，绝不覆盖作者刚保存的内容。
 * 放弃不影响已完成的采纳，下一次采纳时会按最新预设重新判断。
 */
export async function refreshFingerprintFromVault(
  bookRoot: string,
  snapshot: LoadedStylePreset,
  now: Date = new Date(),
): Promise<{ readonly loaded: LoadedStylePreset; readonly result: FingerprintRefreshResult }> {
  const preset = snapshot.preset;
  const samples = revisionSamplesOf(preset);
  const status = fingerprintRefreshStatus(preset?.fingerprint ?? null, samples);
  if (!preset || !status.due) return { loaded: snapshot, result: { outcome: "pending", status } };
  try {
    const saved = await saveStylePreset(bookRoot, { ...preset, fingerprint: computeVaultFingerprint(samples, now) }, snapshot.revision);
    return {
      loaded: saved,
      result: { outcome: "refreshed", status: fingerprintRefreshStatus(saved.preset?.fingerprint ?? null, samples) },
    };
  } catch (error) {
    const reason = error instanceof StylePresetError && error.code === "STYLE_PRESET_CONFLICT"
      ? "文风预设在采纳后又被保存过，本次没有自动更新统计指纹，以免覆盖刚保存的内容；下次采纳时会按最新预设重新计算。"
      : `自动更新统计指纹失败，指纹保持原样：${error instanceof Error ? error.message : String(error)}`;
    console.warn(`[style-vault] ${reason}`);
    return { loaded: snapshot, result: { outcome: "skipped", status, reason } };
  }
}

/**
 * 把作者点名的改稿段写进预设的「作者改稿」来源。作者主动采纳即视为确认，标 confirmed + 可迁移；
 * 同一段重复采纳按内容去重。版本不一致时由 saveStylePreset 抛 STYLE_PRESET_CONFLICT，不覆盖别处的修改。
 * 采纳写入成功后再判断是否到了重算统计指纹的阈值（见 style-vault-fingerprint.ts）。
 */
export async function adoptRevisionSamples(
  bookRoot: string,
  inputs: readonly AdoptRevisionInput[],
  expectedRevision: string | null,
  options: { readonly now?: Date } = {},
): Promise<AdoptRevisionResult> {
  const now = options.now ?? new Date();
  const loaded = await loadStylePreset(bookRoot);
  const preset: StylePreset = loaded.preset ?? createStylePreset();
  const existing = preset.sources.find((source) => source.id === AUTHOR_REVISION_SOURCE_ID);
  const samples = [...(existing?.samples ?? [])];
  const baselineIds = samples.map((sample) => sample.id);
  for (const input of inputs) {
    const id = revisionSampleId(input.chapterNumber, input.authorText);
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
  const added = samples.length > baselineIds.length;
  const next: StylePreset = {
    ...preset,
    sources: [source, ...preset.sources.filter((item) => item.id !== AUTHOR_REVISION_SOURCE_ID)],
    // 指纹来自别处（手动提取 / 蒸馏）且尚未记来历时，以采纳前的范文为起点开始计数，不把旧范文算作新增。
    fingerprint: added ? stampExternalBasis(preset.fingerprint, baselineIds, now) : preset.fingerprint,
  };
  const saved = await saveStylePreset(bookRoot, next, expectedRevision);
  const refreshed = await refreshFingerprintFromVault(bookRoot, saved, now);
  return { ...refreshed.loaded, fingerprintRefresh: refreshed.result };
}
