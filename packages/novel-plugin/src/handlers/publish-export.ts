/**
 * publish.export — 最小发布包。
 *
 * 只写出投稿真正需要的四样：作品信息、目录、章节正文、可选投稿建议。
 * 不把附件、叙事记忆、经纬、技能、迁移备份或 .novelfork 工作数据混进发布包。
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  chapterFileName,
  chapterTitleFromContent,
  chapterWordCount,
  listChapterFiles,
  parseChapterFileName,
} from "../engine/writing-resource/chapter-layout.js";
import { handleChapterRead } from "./chapter-read.js";
import { handlePublishCheck } from "./publish-check.js";

export const PUBLISH_EXPORT_DIRECTORY = "export/publish";

export interface PublishExportInput {
  readonly bookId: string;
  readonly bookRoot: string;
  readonly fromChapter?: number;
  readonly toChapter?: number;
  /** 是否附带 publish.check 的投稿准备建议。默认 true。 */
  readonly includeAdvice?: boolean;
  readonly platform?: string;
  readonly storage?: StorageDatabase;
}

export interface PublishExportChapter {
  readonly number: number;
  readonly title: string;
  readonly fileName: string;
  readonly wordCount: number;
}

export interface PublishExportResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly error?: string;
  readonly bookId?: string;
  readonly outputDir?: string;
  readonly files?: readonly string[];
  readonly chapters?: readonly PublishExportChapter[];
  readonly included?: readonly string[];
  readonly excluded?: readonly string[];
  readonly adviceIncluded?: boolean;
  readonly adviceStatus?: string;
}

interface BookInfo {
  readonly id: string;
  readonly title: string;
  readonly genre?: string;
  readonly platform?: string;
  readonly language?: string;
  readonly status?: string;
  readonly targetChapters?: number;
  readonly chapterWordCount?: number;
}

const EXCLUDED = [
  "附件 / 图片 / 音视频",
  "Narrative Memory（facts/events/logs）",
  "经纬设定与关系图",
  "Writing Skills / .novelfork 工作数据",
  "迁移备份与 last-pipeline-run",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBookInfo(raw: unknown, bookId: string): BookInfo {
  const record = asRecord(raw) ?? {};
  return {
    id: optionalString(record.id) ?? bookId,
    title: optionalString(record.title) ?? bookId,
    ...(optionalString(record.genre) ? { genre: optionalString(record.genre) } : {}),
    ...(optionalString(record.platform) ? { platform: optionalString(record.platform) } : {}),
    ...(optionalString(record.language) ? { language: optionalString(record.language) } : {}),
    ...(optionalString(record.status) ? { status: optionalString(record.status) } : {}),
    ...(optionalNumber(record.targetChapters) ? { targetChapters: optionalNumber(record.targetChapters) } : {}),
    ...(optionalNumber(record.chapterWordCount) ? { chapterWordCount: optionalNumber(record.chapterWordCount) } : {}),
  };
}

function inRange(number: number, from?: number, to?: number): boolean {
  if (from !== undefined && number < from) return false;
  if (to !== undefined && number > to) return false;
  return true;
}

function renderCatalog(book: BookInfo, chapters: readonly PublishExportChapter[]): string {
  const lines = [
    `# ${book.title} 目录`,
    "",
    `共 ${chapters.length} 章，合计 ${chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)} 字。`,
    "",
    ...chapters.map((chapter) => `- 第${chapter.number}章 ${chapter.title}（${chapter.wordCount} 字）→ chapters/${chapter.fileName}`),
    "",
  ];
  return lines.join("\n");
}

function renderReadme(book: BookInfo, chapters: readonly PublishExportChapter[], adviceIncluded: boolean): string {
  return [
    `# ${book.title} 发布包`,
    "",
    "本目录是投稿用的最小发布包，只含作品信息、目录和章节正文。",
    adviceIncluded ? "已附带本地投稿准备建议（publish-advice.md），仅供人工复核，不能替代平台审核。" : "未附带投稿准备建议。需要时用 publish.export(includeAdvice=true) 再导出一次。",
    "",
    "## 包含",
    "- book.json：作品信息（书名/类型/平台/语言/状态/章目标）",
    "- catalog.md：目录",
    `- chapters/：${chapters.length} 章正文`,
    ...(adviceIncluded ? ["- publish-advice.md：本地投稿准备建议"] : []),
    "",
    "## 不包含",
    ...EXCLUDED.map((item) => `- ${item}`),
    "",
    "不要把这个目录当备份包；记忆、附件和迁移数据请走各自的工具，不要拷进这里。",
    "",
  ].join("\n");
}

function renderAdvice(check: Awaited<ReturnType<typeof handlePublishCheck>>): string {
  const evidence = Array.isArray(check.report?.evidence) ? check.report.evidence.slice(0, 20) : [];
  const lines = [
    `# 投稿准备建议`,
    "",
    `平台：${check.platformLabel}`,
    `状态：${check.status}`,
    `已检 ${check.checkedChapters} 章；高风险线索 ${check.blockCount} / 提醒 ${check.warnCount} / 建议 ${check.suggestCount}`,
    check.chapterTarget?.message ? `章目标：${check.chapterTarget.message}` : "",
    "",
    check.summary,
    "",
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "");

  if (check.notes.length > 0) {
    lines.push("## 平台备注", ...check.notes.map((note) => `- ${note}`), "");
  }
  if (evidence.length > 0) {
    lines.push("## 可定位线索（最多 20 条）");
    for (const item of evidence) {
      const chapter = item.chapterNumber ? `第${item.chapterNumber}章` : "全书";
      lines.push(`- ${chapter}｜${item.message}${item.suggestion ? ` → ${item.suggestion}` : ""}`);
    }
    lines.push("");
  }
  lines.push("以上为本地规则线索，发布前仍需人工复核。", "");
  return lines.join("\n");
}

export async function handlePublishExport(input: PublishExportInput): Promise<PublishExportResult> {
  const bookId = input.bookId.trim();
  const bookRoot = input.bookRoot.trim();
  if (!bookId) return { ok: false, error: "missing-book-id", summary: "缺少 bookId。" };
  if (!bookRoot) return { ok: false, error: "missing-book-root", summary: "缺少可信 bookRoot。" };

  const { readFile } = await import("node:fs/promises");
  let bookRaw: unknown = {};
  try {
    bookRaw = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as unknown;
  } catch {
    return { ok: false, error: "book-not-found", summary: "找不到 book.json，无法导出作品信息。" };
  }
  const book = readBookInfo(bookRaw, bookId);

  const files = await listChapterFiles(bookRoot);
  const targets = files.filter((file) => inRange(file.number, input.fromChapter, input.toChapter));
  if (targets.length === 0) {
    return { ok: false, error: "no-chapters", summary: "范围内没有可导出的章节正文。" };
  }

  const storage = input.storage ?? (() => {
    try {
      return getStorageDatabase();
    } catch {
      return undefined;
    }
  })();
  const exported: PublishExportChapter[] = [];
  const chapterBodies: Array<{ fileName: string; content: string }> = [];
  const missing: number[] = [];

  for (const file of targets) {
    const read = await handleChapterRead(
      { bookId, chapterNumber: file.number },
      undefined,
      { bookRoot, ...(storage ? { storage } : {}) },
    );
    if (!read.ok || !read.data?.content?.trim()) {
      missing.push(file.number);
      continue;
    }
    const parsed = parseChapterFileName(file.fileName) ?? file;
    const title = chapterTitleFromContent(parsed, read.data.content);
    const fileName = chapterFileName(file.number, title);
    exported.push({
      number: file.number,
      title,
      fileName,
      wordCount: chapterWordCount(read.data.content),
    });
    chapterBodies.push({ fileName, content: read.data.content.replace(/\r\n/g, "\n").trimEnd() + "\n" });
  }

  if (exported.length === 0) {
    return { ok: false, error: "no-chapters", summary: "范围内章节无法读取，未生成发布包。" };
  }

  const includeAdvice = input.includeAdvice !== false;
  let adviceMarkdown = "";
  let adviceStatus: string | undefined;
  if (includeAdvice) {
    const check = await handlePublishCheck({
      bookId,
      bookRoot,
      ...(storage ? { storage } : {}),
      ...(typeof input.platform === "string" ? { platform: input.platform } : {}),
      ...(typeof input.fromChapter === "number" ? { fromChapter: input.fromChapter } : {}),
      ...(typeof input.toChapter === "number" ? { toChapter: input.toChapter } : {}),
    });
    adviceStatus = check.status;
    if (check.ok && check.status !== "skipped") adviceMarkdown = renderAdvice(check);
  }

  const outputDir = join(bookRoot, PUBLISH_EXPORT_DIRECTORY);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(join(outputDir, "chapters"), { recursive: true });

  const written: string[] = [
    "README.md",
    "book.json",
    "catalog.md",
    ...chapterBodies.map((chapter) => `chapters/${chapter.fileName}`),
  ];
  await writeFile(join(outputDir, "README.md"), renderReadme(book, exported, adviceMarkdown.length > 0), "utf8");
  await writeFile(join(outputDir, "book.json"), `${JSON.stringify({
    ...book,
    exportedChapters: exported.length,
    exportedWords: exported.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    fromChapter: exported[0]?.number,
    toChapter: exported[exported.length - 1]?.number,
  }, null, 2)}\n`, "utf8");
  await writeFile(join(outputDir, "catalog.md"), renderCatalog(book, exported), "utf8");
  for (const chapter of chapterBodies) {
    await writeFile(join(outputDir, "chapters", chapter.fileName), chapter.content, "utf8");
  }
  if (adviceMarkdown) {
    await writeFile(join(outputDir, "publish-advice.md"), adviceMarkdown, "utf8");
    written.push("publish-advice.md");
  }

  const missingNote = missing.length > 0 ? ` 有 ${missing.length} 章读取失败已跳过（${missing.slice(0, 8).join("、")}${missing.length > 8 ? "…" : ""}）。` : "";
  return {
    ok: true,
    bookId,
    outputDir: PUBLISH_EXPORT_DIRECTORY,
    files: written,
    chapters: exported,
    included: [
      "作品信息",
      "目录",
      "章节正文",
      ...(adviceMarkdown ? ["投稿准备建议"] : []),
    ],
    excluded: [...EXCLUDED],
    adviceIncluded: adviceMarkdown.length > 0,
    ...(adviceStatus ? { adviceStatus } : {}),
    summary: `已导出 ${exported.length} 章到 ${PUBLISH_EXPORT_DIRECTORY}/${missingNote}${adviceMarkdown ? " 已附带投稿准备建议。" : " 未附带投稿准备建议。"}`.trim(),
  };
}
