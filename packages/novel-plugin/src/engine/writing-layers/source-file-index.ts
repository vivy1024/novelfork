import { open, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { splitChapters } from "@vivy1024/novelfork-core";
import { findDialogueRanges } from "../compliance/dialogue-spans.js";

export const MAX_BOOK_TEXT_FILE_BYTES = 60 * 1024 * 1024;
const INTERNAL_DIRS = new Set([".git", ".narrafork", ".novelfork"]);
const SCAN_SKIP = new Set([...INTERNAL_DIRS, "chapters", "story", "node_modules"]);

export class BookTextFileError extends Error {
  constructor(message: string, readonly code: "BOOK_FILE_UNSAFE" | "BOOK_FILE_TOO_LARGE" | "BOOK_FILE_INVALID") {
    super(message);
    this.name = "BookTextFileError";
  }
}

function assertInside(root: string, path: string): void {
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)
    || rel.split(/[\\/]/u).some((part) => INTERNAL_DIRS.has(part.toLowerCase()) || part.includes(":"))) {
    throw new BookTextFileError("只能读取本书目录内的参考文件，不能读取内部数据或目录外文件。", "BOOK_FILE_UNSAFE");
  }
}

/** 同时检查表面路径和真实路径，符号链接不能绕过书根或内部数据保护。 */
export async function resolveSafeBookFilePath(bookRoot: string, filePath: string): Promise<string> {
  if (!filePath.trim() || filePath.includes("\0")) throw new BookTextFileError("参考文件路径无效。", "BOOK_FILE_INVALID");
  const root = await realpath(bookRoot);
  const path = resolve(root, filePath);
  assertInside(root, path);
  const actual = await realpath(path);
  assertInside(root, actual);
  const info = await stat(actual);
  if (!info.isFile()) throw new BookTextFileError("参考来源必须是普通文本文件。", "BOOK_FILE_INVALID");
  if (info.size > MAX_BOOK_TEXT_FILE_BYTES) throw new BookTextFileError("参考文件超过 60 MB，请按卷拆分。", "BOOK_FILE_TOO_LARGE");
  return actual;
}

export interface WorkspaceReferenceFile {
  readonly filePath: string;
  readonly byteLength: number;
  readonly modifiedAt: string;
}

/** 不跟随目录链接；文件链接仍经真实路径守卫。最多返回稳定文件名顺序的 200 项。 */
export async function listWorkspaceReferenceFiles(bookRoot: string): Promise<WorkspaceReferenceFile[]> {
  const root = await realpath(bookRoot);
  const files: WorkspaceReferenceFile[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (files.length >= 200) return;
      if (SCAN_SKIP.has(entry.name.toLowerCase())) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!/\.(?:txt|md)$/iu.test(extname(entry.name))) continue;
      try {
        const actual = await resolveSafeBookFilePath(root, path);
        const info = await stat(actual);
        files.push({ filePath: relative(root, path).split(sep).join("/"), byteLength: info.size, modifiedAt: info.mtime.toISOString() });
      } catch (error) {
        if (!(error instanceof BookTextFileError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  await visit(root);
  return files;
}

export async function readBookTextFile(bookRoot: string, filePath: string): Promise<{ text: string; encoding: "utf-8" | "gb18030"; byteLength: number }> {
  const path = await resolveSafeBookFilePath(bookRoot, filePath);
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BOOK_TEXT_FILE_BYTES) throw new BookTextFileError("参考文件超过 60 MB 或不是普通文件。", "BOOK_FILE_TOO_LARGE");
    // 有界读取：即使读取期间文件增长，也不会分配无界缓冲区。
    const bytes = new Uint8Array(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > info.size) throw new BookTextFileError("参考文件读取期间发生变化，请重试。", "BOOK_FILE_INVALID");
    const data = bytes.subarray(0, length);
    let text: string;
    let encoding: "utf-8" | "gb18030" = "utf-8";
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
    catch { text = new TextDecoder("gb18030").decode(data); encoding = "gb18030"; }
    return { text: text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n"), encoding, byteLength: length };
  } finally { await handle.close(); }
}

export type MechanicalFeature = "dialogue_banter" | "bill_inventory" | "combat_counter" | "ancient_scripture" | "institution_rule" | "narrative";
export interface MechanicalChapter {
  readonly number: number;
  readonly title: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly charCount: number;
  readonly dialogueRatio: number;
  readonly avgParagraphChars: number;
  readonly avgSentenceChars: number;
  readonly dominantFeatures: MechanicalFeature[];
  readonly featureScores: { bill: number; combat: number; ancient: number; banter: number };
}
const BILL = /\d+(?:\.\d+)?\s*(?:枚|块|颗|两|万|亿|元|天|月|年|成|倍|灵石)|灵石|贷款|利息|成本|收益|折算|工时|罚款|欠款|余额|报酬|算账/gu;
const COMBAT = /剑|刀|拳|杀|轰|破|阵|法术|真元|灵力|闪避|格挡|神通|偷袭/gu;
const ANCIENT = /曰|乃|遂|皆|亦|虚空|仙基|道统|紫府|果位|天机|诏|卷|残篇/gu;
const COLLOQUIAL = /怎么|什么|这个|那个|咱们|你们|哈哈|嘿嘿|卧槽|妈的|吧|吗|呢/gu;
const BANTER = /[？！!?]|吐槽|扯淡|混蛋|卧槽|哈哈|嘿嘿|啧|呸|吧|吗|呢|啊/gu;
const INSTITUTION = /合同|条款|违约|考核|学分|规矩|条例|签署|甲方|权限|乙方|剥削/gu;
const count = (text: string, regex: RegExp): number => text.match(regex)?.length ?? 0;
const rounded = (value: number): number => Math.round(value * 10_000) / 10_000;

/** 词面统计不是文学判断；仅为零模型成本抽样提供确定性线索。 */
export function mechanicalTextFeatures(text: string): Pick<MechanicalChapter, "dialogueRatio" | "featureScores" | "dominantFeatures"> {
  const length = Math.max(1, text.replace(/\s/gu, "").length);
  const density = (hits: number) => rounded(hits * 1000 / length);
  const dialogueRatio = rounded(Math.min(1, findDialogueRanges(text).reduce((sum, range) => sum + range.end - range.start, 0) / Math.max(1, text.length)));
  const ancientHits = count(text, ANCIENT);
  const featureScores = {
    bill: density(count(text, BILL)), combat: density(count(text, COMBAT)),
    ancient: count(text, COLLOQUIAL) > ancientHits ? 0 : density(ancientHits),
    banter: dialogueRatio >= 0.35 ? density(count(text, BANTER)) : 0,
  };
  const dominantFeatures: MechanicalFeature[] = [];
  if (featureScores.bill >= 3) dominantFeatures.push("bill_inventory");
  if (featureScores.combat >= 5) dominantFeatures.push("combat_counter");
  if (featureScores.ancient >= 4) dominantFeatures.push("ancient_scripture");
  if (featureScores.banter >= 3) dominantFeatures.push("dialogue_banter");
  if (density(count(text, INSTITUTION)) >= 3) dominantFeatures.push("institution_rule");
  if (!dominantFeatures.length) dominantFeatures.push("narrative");
  return { dialogueRatio, featureScores, dominantFeatures };
}

export function buildMechanicalBookIndex(input: { sourceName?: string; text: string; splitPattern?: string }) {
  const text = input.text.replace(/\r\n?/gu, "\n");
  const split = splitChapters(text, input.splitPattern);
  const parts = split.length ? split : [{ title: input.sourceName || "全文", content: text.trim() }];
  // 正文按切分顺序向前定位，避免逐章从全文开头扫描；空章回退到前一章末尾。
  let cursor = 0;
  let line = 1;
  const advance = (end: number) => {
    for (let at = text.indexOf("\n", cursor); at >= 0 && at < end; at = text.indexOf("\n", at + 1)) line += 1;
    cursor = end;
  };
  const chapters: MechanicalChapter[] = parts.map((part, index) => {
    const found = part.content ? text.indexOf(part.content, cursor) : cursor;
    const start = found >= 0 ? found : cursor;
    advance(start);
    const startLine = line;
    advance(start + part.content.length);
    const paragraphs = part.content.split(/\n+/u).map((p) => p.trim()).filter(Boolean);
    const sentences = part.content.split(/[。！？!?；;]+/u).map((s) => s.trim()).filter(Boolean);
    return {
      number: index + 1, title: part.title, startLine, endLine: line, charCount: part.content.length,
      avgParagraphChars: rounded(paragraphs.reduce((sum, p) => sum + p.length, 0) / Math.max(1, paragraphs.length)),
      avgSentenceChars: rounded(sentences.reduce((sum, s) => sum + s.length, 0) / Math.max(1, sentences.length)),
      ...mechanicalTextFeatures(part.content),
    };
  });
  const rationale: Record<number, string> = {};
  const add = (number: number, why: string) => {
    if (number < 1 || number > chapters.length) return;
    rationale[number] = rationale[number] ? `${rationale[number]}；${why}` : why;
  };
  for (let number = 1; number <= Math.min(3, chapters.length); number += 1) add(number, "黄金开局");
  const topChapters = Object.fromEntries((["bill", "combat", "ancient", "banter"] as const).map((key) => {
    const ranked = [...chapters].sort((a, b) => b.featureScores[key] - a.featureScores[key] || a.number - b.number).filter((c) => c.featureScores[key] > 0).slice(0, 5);
    for (const chapter of ranked.slice(0, 2)) add(chapter.number, `${key} 特征峰值`);
    return [key, ranked.map((chapter) => ({ number: chapter.number, title: chapter.title, score: chapter.featureScores[key] }))];
  })) as Record<"bill" | "combat" | "ancient" | "banter", { number: number; title: string; score: number }[]>;
  const institutionCandidates = chapters.filter((c) => c.dominantFeatures.includes("institution_rule"));
  const institution = institutionCandidates
    .sort((a, b) => Number(b.dominantFeatures[0] === "institution_rule") - Number(a.dominantFeatures[0] === "institution_rule")
      || b.charCount - a.charCount || a.number - b.number)[0];
  if (institution) add(institution.number, "制度规矩代表");
  for (const ratio of [0.2, 0.4, 0.6, 0.8, 1]) add(Math.max(1, Math.round(chapters.length * ratio)), "中后段跨度代表");
  // 峰值重合时用均匀分位补足 15 章；短书返回全书。
  for (let index = 0; Object.keys(rationale).length < Math.min(15, chapters.length) && index < 30; index += 1) {
    add(Math.max(1, Math.round(1 + (chapters.length - 1) * index / 29)), "全书均匀补样");
  }
  return {
    sourceName: input.sourceName ?? "参考文本", chapterCount: chapters.length,
    totalCharCount: text.length, chapters, topChapters,
    recommendedChapters: { chapterNumbers: Object.keys(rationale).map(Number).sort((a, b) => a - b), rationale },
  };
}
