import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildLengthSpec,
  countChapterLength,
  isOutsideHardRange,
  type LengthSpec,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import { handleWritingSkillsCheckCompliance } from "./writing-skill-handlers.js";

export interface ChapterWriteInput {
  bookId: string;
  chapterNumber: number;
  content: string;
}

export type TrustedChapterWritePurpose = "complete-chapter" | "revision";

export interface TrustedChapterWriteOptions {
  /** Absolute root supplied by the trusted Runtime resource binding. */
  bookRoot: string;
  /**
   * Legacy trusted storage handle. Writing Skills compliance reads SKILL.md files
   * under the bound book root, so this is no longer required for chapter writes.
   */
  storage?: StorageDatabase;
  /**
   * Internal-only write intent. Runtime tool input never exposes this field:
   * direct chapter.write defaults to a complete-chapter commit, while targeted
   * rewrite tools opt into revision semantics.
   */
  purpose?: TrustedChapterWritePurpose;
}

type ChapterLengthData = {
  actual: number;
  target: number;
  hardMin: number;
  hardMax: number;
  countingMode: LengthSpec["countingMode"];
};

type WritingSkillViolation = {
  skillId: string;
  skillName: string;
  checkId: string;
  rule: string;
  violation: string;
  severity: "warning" | "error";
  explanation: string;
};

export type ChapterWriteResult =
  | {
      ok: true;
      summary: string;
      data: {
        bookId: string;
        chapterNumber: number;
        fileName: string;
        wordCount: number;
        updatedAt: string;
        length: ChapterLengthData;
        writingSkillWarnings: WritingSkillViolation[];
      };
    }
  | {
      ok: false;
      error: string;
      summary: string;
      data?: { length?: ChapterLengthData; writingSkillViolations?: WritingSkillViolation[] };
    };

const CHAPTER_FILE_PATTERN = /^(\d{1,9})[_-].+\.md$/iu;
const MAX_CONTENT_LENGTH = 2_000_000;

function chapterNumberFromFileName(fileName: string): number | null {
  const match = CHAPTER_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  const chapterNumber = Number(match[1]);
  return Number.isSafeInteger(chapterNumber) && chapterNumber > 0 ? chapterNumber : null;
}

async function loadBookLengthSpec(
  bookId: string,
  bookRoot: string,
): Promise<LengthSpec> {
  const parsed = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("book.json 不是有效对象。");
  }
  const config = parsed as { id?: unknown; chapterWordCount?: unknown; language?: unknown };
  if (typeof config.id === "string" && config.id !== bookId) {
    throw new Error("book.json 与可信书籍绑定不匹配。");
  }
  if (typeof config.chapterWordCount !== "number" || !Number.isSafeInteger(config.chapterWordCount) || config.chapterWordCount < 1) {
    throw new Error("book.json 缺少有效的 chapterWordCount 设置。");
  }
  return buildLengthSpec(config.chapterWordCount, config.language === "en" ? "en" : "zh");
}

function toLengthData(actual: number, spec: LengthSpec): ChapterLengthData {
  return {
    actual,
    target: spec.target,
    hardMin: spec.hardMin,
    hardMax: spec.hardMax,
    countingMode: spec.countingMode,
  };
}

function writingSkillViolations(value: unknown): WritingSkillViolation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is WritingSkillViolation => (
    Boolean(item)
    && typeof item === "object"
    && ((item as { severity?: unknown }).severity === "warning" || (item as { severity?: unknown }).severity === "error")
    && typeof (item as { skillId?: unknown }).skillId === "string"
    && typeof (item as { skillName?: unknown }).skillName === "string"
    && typeof (item as { rule?: unknown }).rule === "string"
    && typeof (item as { violation?: unknown }).violation === "string"
  ));
}

async function validateCompleteChapterWrite(
  input: ChapterWriteInput,
  options: TrustedChapterWriteOptions,
  length: ChapterLengthData,
  spec: LengthSpec,
): Promise<ChapterWriteResult | WritingSkillViolation[]> {
  if (options.purpose === "revision") return [];
  if (isOutsideHardRange(length.actual, spec)) {
    return {
      ok: false,
      error: "chapter-length-out-of-range",
      summary: `第 ${input.chapterNumber} 章长度为 ${length.actual}${length.countingMode === "en_words" ? " words" : "字"}，不在本书目标 ${length.target}${length.countingMode === "en_words" ? " words" : "字"} 的硬范围 ${length.hardMin}-${length.hardMax} 内；正文和章节索引均未修改。`,
      data: { length },
    };
  }

  const compliance = await handleWritingSkillsCheckCompliance(
    { bookId: input.bookId, chapterNumber: input.chapterNumber, content: input.content },
    { bookRoot: options.bookRoot },
  );
  if (!compliance.ok) {
    return {
      ok: false,
      error: compliance.error ?? "writing-skills-check-failed",
      summary: `${compliance.summary} 正文和章节索引均未修改。`,
    };
  }
  const violations = writingSkillViolations((compliance.data as { violations?: unknown } | undefined)?.violations);
  const errors = violations.filter((violation) => violation.severity === "error");
  if (errors.length > 0) {
    return {
      ok: false,
      error: "writing-skill-compliance-failed",
      summary: `第 ${input.chapterNumber} 章触发 ${errors.length} 条 Writing Skills 硬性违规；正文和章节索引均未修改。${errors.map((violation) => ` ${violation.skillName}：${violation.violation}`).join("")}`,
      data: { length, writingSkillViolations: violations },
    };
  }
  return violations;
}

async function updateChapterIndex(
  bookRoot: string,
  chapterNumber: number,
  wordCount: number,
  updatedAt: string,
): Promise<void> {
  const indexPath = join(bookRoot, "chapters", "index.json");
  const raw = await readFile(indexPath, "utf8").catch(() => "[]");
  let index: unknown;
  try {
    index = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(index)) return;
  const nextIndex = index.map((entry) => (
    entry && typeof entry === "object" && !Array.isArray(entry) && Number((entry as Record<string, unknown>).number) === chapterNumber
      ? { ...(entry as Record<string, unknown>), wordCount, updatedAt }
      : entry
  ));
  await writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, "utf8");
}

/**
 * Write one existing chapter selected by its numeric resource identity.
 * The caller supplies a trusted root, and this function selects a directory entry
 * itself rather than accepting a client/model path.
 */
export async function handleChapterWrite(
  input: ChapterWriteInput,
  options: TrustedChapterWriteOptions,
): Promise<ChapterWriteResult> {
  if (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1) {
    return { ok: false, error: "invalid-input", summary: "chapterNumber 必须是正整数。" };
  }
  if (typeof input.content !== "string" || input.content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: "invalid-input", summary: `章节正文必须是长度不超过 ${MAX_CONTENT_LENGTH} 的字符串。` };
  }

  try {
    const lengthSpec = await loadBookLengthSpec(input.bookId, options.bookRoot);
    const wordCount = countChapterLength(input.content, lengthSpec.countingMode);
    const length = toLengthData(wordCount, lengthSpec);
    const validation = await validateCompleteChapterWrite(input, options, length, lengthSpec);
    if (!Array.isArray(validation)) return validation;

    const entries = await readdir(join(options.bookRoot, "chapters"), { withFileTypes: true });
    const matched = entries.find((entry) => entry.isFile() && chapterNumberFromFileName(entry.name) === input.chapterNumber);
    if (!matched) {
      return { ok: false, error: "chapter-not-found", summary: `章节 ${input.chapterNumber} 不存在，拒绝写入。` };
    }

    const chapterPath = join(options.bookRoot, "chapters", matched.name);
    const updatedAt = new Date().toISOString();
    await writeFile(chapterPath, input.content, "utf8");
    await updateChapterIndex(options.bookRoot, input.chapterNumber, wordCount, updatedAt);

    return {
      ok: true,
      summary: `已写入第 ${input.chapterNumber} 章，等待 Runtime 权限确认记录完成。`,
      data: {
        bookId: input.bookId,
        chapterNumber: input.chapterNumber,
        fileName: matched.name,
        wordCount,
        updatedAt,
        length,
        writingSkillWarnings: validation.filter((violation) => violation.severity === "warning"),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: "chapter-write-failed",
      summary: `章节写入失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
