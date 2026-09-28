import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { LengthCountingMode } from "@vivy1024/novelfork-core";

import { chapterContentFingerprint } from "../narrative-memory/settlement-idempotency.js";
import type { ChapterContentChange } from "./chapter-change-effects.js";
import {
  CHAPTERS_DIRECTORY,
  chapterWordCount,
  normalizeChapterRelativePath,
  readChapterIndex,
  synchronizeChapterLayout,
  writeChapterIndex,
  type ChapterVolumeDirectoryResolver,
} from "./chapter-layout.js";

export interface ReconciledChapterFile extends ChapterContentChange {
  /** 相对书籍根目录，如 `chapters/卷01/0001_山门初雪.md`。 */
  readonly relativePath: string;
  readonly kind: "created" | "modified";
}

/**
 * 章节文件对账：把磁盘上的章节正文与 `chapters/index.json` 记录的最近状态比对，找出被改过的章节。
 *
 * 写章节的不只有写作台：叙述者的通用写工具、Runtime 的文件编辑器与回退、外部编辑器都会直接改文件，
 * 它们不经过产品层，写作统计、审计过期标记和索引字数都会漏掉。对账在事后补上这些动作，
 * 所以无论谁写的，结果都一样。
 *
 * 判定规则：
 * - 文件修改时间不晚于索引记录时间，且索引带正文指纹 → 视为未变，不读正文；
 * - 否则读正文比指纹，指纹相同只刷新记录时间，避免下次重读；
 * - 新出现的章节文件按"从 0 字新增"处理。
 *
 * 这里只更新索引并返回变更清单；写作日志与审计标记由调用方对每条变更执行 `applyChapterContentChange`。
 */
export async function reconcileChapterFiles(input: {
  readonly bookId: string;
  readonly bookRoot: string;
  readonly countingMode: LengthCountingMode;
  readonly resolveVolumeDirectory: ChapterVolumeDirectoryResolver;
}): Promise<ReconciledChapterFile[]> {
  const { bookId, bookRoot, countingMode } = input;
  const indexedBefore = new Set((await readChapterIndex(bookRoot)).map((entry) => entry.number));
  await synchronizeChapterLayout(bookId, bookRoot, input.resolveVolumeDirectory, { countingMode });

  const index = await readChapterIndex(bookRoot);
  const changes: ReconciledChapterFile[] = [];
  let indexChanged = false;

  for (const entry of index) {
    const relativePath = normalizeChapterRelativePath(join(CHAPTERS_DIRECTORY, entry.fileName));
    const absolutePath = join(bookRoot, relativePath);
    const info = await stat(absolutePath).catch(() => null);
    if (!info?.isFile()) continue;

    const created = !indexedBefore.has(entry.number);
    // 文件修改时间比毫秒更精细，先取整再比，否则每次都会重读。
    const modifiedAt = Math.floor(info.mtimeMs);
    // 旧索引没有观察时间，退回用 updatedAt 比较。
    const observedAt = typeof entry.fileModifiedAt === "number" ? entry.fileModifiedAt : Date.parse(entry.updatedAt);
    const knownHash = typeof entry.contentHash === "string" ? entry.contentHash : null;
    if (!created && knownHash && Number.isFinite(observedAt) && modifiedAt <= observedAt) continue;

    const content = await readFile(absolutePath, "utf8").catch(() => null);
    if (content === null) continue;
    const contentHash = chapterContentFingerprint(content);
    const wordCount = chapterWordCount(content, countingMode);

    if (!created && knownHash === contentHash) {
      if (entry.fileModifiedAt !== modifiedAt) {
        entry.fileModifiedAt = modifiedAt;
        indexChanged = true;
      }
      continue;
    }

    const previousWordCount = created ? 0 : entry.wordCount;
    const unchangedLegacy = !created && !knownHash && Number.isFinite(observedAt) && modifiedAt <= observedAt;
    entry.wordCount = wordCount;
    entry.contentHash = contentHash;
    entry.fileModifiedAt = modifiedAt;
    indexChanged = true;
    // 旧索引没有指纹：修改时间不晚于记录时间说明正文没动过，只补指纹，不算一次变更。
    if (unchangedLegacy) continue;

    // 绕过产品层的写入没有逻辑时间，以文件修改时间为准。
    const changedAt = new Date(modifiedAt).toISOString();
    entry.updatedAt = changedAt;
    changes.push({
      chapterNumber: entry.number,
      relativePath,
      kind: created ? "created" : "modified",
      previousWordCount,
      wordCount,
      content,
      changedAt,
    });
  }

  if (indexChanged) await writeChapterIndex(bookRoot, index);
  return changes;
}
