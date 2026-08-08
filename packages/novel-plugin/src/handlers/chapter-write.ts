import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  buildLengthSpec,
  countChapterLength,
  isOutsideHardRange,
  StateManager,
  type LengthSpec,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import { handleWritingSkillsCheckCompliance } from "./writing-skill-handlers.js";
import { createWritingResourceFileStore } from "../engine/writing-resource/file-store.js";
import { resolveChapterVolumeDirectory } from "./outline-volume.js";

export interface ChapterWriteInput {
  bookId: string;
  chapterNumber: number;
  content: string;
  expectedHash?: string;
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
        hash: string;
        length: ChapterLengthData;
        writingSkillWarnings: WritingSkillViolation[];
      };
    }
  | {
      ok: false;
      error: string;
      summary: string;
      explanation?: string;
      data?: {
        length?: ChapterLengthData;
        writingSkillViolations?: WritingSkillViolation[];
        currentHash?: string;
        expectedHash?: string;
      };
    };

const MAX_CONTENT_LENGTH = 2_000_000;

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

  const stateManager = new StateManager("", { resolveBookDir: () => options.bookRoot });
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await stateManager.acquireBookLock(input.bookId);
  } catch (lockError) {
    return {
      ok: false,
      error: "chapter-write-locked",
      summary: `章节写入已被加锁：${lockError instanceof Error ? lockError.message : String(lockError)}`,
      explanation: "当前书籍正在进行另一个写入操作，加锁冲突。请稍后重试。",
    };
  }

  try {
    const fileStore = createWritingResourceFileStore(() => options.bookRoot, {
      resolveChapterVolumeDirectory: options.storage
        ? (requestedBookId, requestedChapterNumber) => resolveChapterVolumeDirectory(
            options.storage!,
            requestedBookId,
            requestedChapterNumber,
          )
        : undefined,
    });

    if (typeof input.expectedHash === "string") {
      const existingResource = await fileStore.findAcceptedChapter(input.bookId, input.chapterNumber);
      const currentContent = existingResource ? existingResource.content : "";
      const currentHash = createHash("sha256").update(currentContent, "utf8").digest("hex");
      if (currentHash !== input.expectedHash) {
        return {
          ok: false,
          error: "chapter-concurrent-modification",
          summary: `第 ${input.chapterNumber} 章正文在写入前已被并发修改（预期 Hash: ${input.expectedHash}，实际 Hash: ${currentHash}）。`,
          explanation: "检测到章节正文在读取与本次写入之间已被其它并发任务更新，已取消写入以防止覆盖最新正文。请获取最新章节内容后再试。",
          data: {
            currentHash,
            expectedHash: input.expectedHash,
          },
        };
      }
    }

    const lengthSpec = await loadBookLengthSpec(input.bookId, options.bookRoot);
    const wordCount = countChapterLength(input.content, lengthSpec.countingMode);
    const length = toLengthData(wordCount, lengthSpec);
    const validation = await validateCompleteChapterWrite(input, options, length, lengthSpec);
    if (!Array.isArray(validation)) return validation;

    const updatedAt = new Date().toISOString();
    const updated = await fileStore.update(input.bookId, `chapter:${input.chapterNumber}`, {
      content: input.content,
      wordCount,
      updatedAt: Date.parse(updatedAt),
    });
    if (!updated) {
      return { ok: false, error: "chapter-not-found", summary: `章节 ${input.chapterNumber} 不存在，拒绝写入。` };
    }

    const hash = createHash("sha256").update(input.content, "utf8").digest("hex");

    return {
      ok: true,
      summary: `已写入第 ${input.chapterNumber} 章，等待 Runtime 权限确认记录完成。`,
      data: {
        bookId: input.bookId,
        chapterNumber: input.chapterNumber,
        fileName: typeof updated.metadata.fileName === "string" ? updated.metadata.fileName : `${updated.id}.md`,
        wordCount,
        updatedAt,
        hash,
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
  } finally {
    if (releaseLock) {
      await releaseLock().catch(() => undefined);
    }
  }
}
