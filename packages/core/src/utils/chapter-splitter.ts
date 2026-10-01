export interface SplitChapter {
  readonly title: string;
  readonly content: string;
}

/**
 * Split a single text file into chapters by matching title lines.
 *
 * Default pattern matches:
 * - "第一章 xxxx" / "第1章 xxxx"
 * - "第一回 xxxx" / "第1回 xxxx"
 * - "# 第1章 xxxx" / "## 第23章 xxxx"
 * - "CHAPTER I." / "CHAPTER II."
 *
 * Each match marks the start of a new chapter. Content between matches
 * belongs to the preceding chapter.
 */
export function splitChapters(
  text: string,
  pattern?: string,
): ReadonlyArray<SplitChapter> {
  const defaultPattern = /^#{0,2}\s*(?:第[零〇○Ｏ０一二三四五六七八九十百千万\d]+(?:章|回)(?:[:：]|\s+)?\s*(.*)|Chapter\s+(?:\d+|[IVXLCDM]+)(?:\.|:|\s+)?\s*(.*))/i;
  const regex = pattern ? new RegExp(pattern, "m") : defaultPattern;

  const lines = text.split("\n");
  const chapters: Array<{ title: string; startLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(regex);
    if (match) {
      chapters.push({
        title: (match[1] ?? match[2] ?? "").trim(),
        startLine: i,
      });
    }
  }

  if (chapters.length === 0) {
    return [];
  }

  const result: SplitChapter[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]!;
    const nextStart = i + 1 < chapters.length ? chapters[i + 1]!.startLine : lines.length;

    // Content starts after the title line
    const contentLines = lines.slice(chapter.startLine + 1, nextStart);
    const content = stripTrailingLicense(contentLines.join("\n")).trim();

    result.push({
      title: chapter.title || inferFallbackTitle(lines[chapter.startLine] ?? "", i + 1),
      content,
    });
  }

  return result;
}

function stripTrailingLicense(content: string): string {
  const trailerMatch = content.match(/^\s*Project Gutenberg(?:™|\(TM\))?.*$/im);
  if (!trailerMatch || trailerMatch.index === undefined) {
    return content;
  }

  return content.slice(0, trailerMatch.index).trimEnd();
}

function inferFallbackTitle(headingLine: string, chapterNumber: number): string {
  if (/chapter\s+(?:\d+|[ivxlcdm]+)/i.test(headingLine)) {
    return `Chapter ${chapterNumber}`;
  }

  if (/第[零一二三四五六七八九十百千万\d]+回/.test(headingLine)) {
    return `第${chapterNumber}回`;
  }

  return `第${chapterNumber}章`;
}

export interface SplitVolume {
  /** 卷序号（1 起始；原文没有卷标题的旧稿整体算一卷）。 */
  readonly index: number;
  /** 卷标题正文（如「光与影」）；无名卷为 "未命名卷"。 */
  readonly title: string;
}

export interface SplitChapterWithVolume extends SplitChapter {
  /** 该章所属卷（1 起始）。 */
  readonly volumeIndex: number;
}

const VOLUME_HEADING_PATTERN = /^#{0,2}\s*第[零〇○Ｏ０一二三四五六七八九十百千万\d]+卷\s*(.*?)[ 　]*\r?$/i;

/**
 * 带卷捕获的切章：除了按 splitChapters 同一特征切章，还认「第N卷 卷标题」行，
 * 记录每章所属卷，并把卷标题行从上一章正文末尾剔除（splitChapters 会把卷标题吃进上一章正文）。
 * 原文没有卷标题时整体归为一卷（index=1），与旧行为相容。
 */
export function splitChaptersWithVolumes(
  text: string,
  pattern?: string,
): { volumes: readonly SplitVolume[]; chapters: readonly SplitChapterWithVolume[] } {
  const defaultPattern = /^#{0,2}\s*(?:第[零〇○Ｏ０一二三四五六七八九十百千万\d]+(?:章|回)(?:[:：]|\s+)?\s*(.*)|Chapter\s+(?:\d+|[IVXLCDM]+)(?:\.|:|\s+)?\s*(.*))/i;
  const chapterRegex = pattern ? new RegExp(pattern, "m") : defaultPattern;

  const lines = text.split("\n");
  const volumeMarkers: Array<{ title: string; line: number }> = [];
  const chapterMarkers: Array<{ title: string; line: number }> = [];

  lines.forEach((line, lineIndex) => {
    const volumeMatch = !pattern && line.match(VOLUME_HEADING_PATTERN);
    if (volumeMatch) {
      volumeMarkers.push({ title: (volumeMatch[1] ?? "").trim(), line: lineIndex });
      return;
    }
    const chapterMatch = line.match(chapterRegex);
    if (chapterMatch) {
      chapterMarkers.push({ title: (chapterMatch[1] ?? chapterMatch[2] ?? "").trim(), line: lineIndex });
    }
  });

  if (chapterMarkers.length === 0) return { volumes: [], chapters: [] };

  const volumes: SplitVolume[] = [];
  volumeMarkers.forEach((marker, index) => {
    volumes.push({ index: index + 1, title: marker.title || "未命名卷" });
  });

  const volumeIndexAtLine = (lineIndex: number): number => {
    if (volumeMarkers.length === 0) return 1;
    let current = 1;
    for (const marker of volumeMarkers) {
      if (marker.line <= lineIndex) current = volumeMarkers.indexOf(marker) + 1;
    }
    return current;
  };

  const chapters: SplitChapterWithVolume[] = [];
  for (let index = 0; index < chapterMarkers.length; index += 1) {
    const marker = chapterMarkers[index]!;
    const contentStart = marker.line + 1;
    const contentEnd = index + 1 < chapterMarkers.length ? chapterMarkers[index + 1]!.line : lines.length;
    // 本段正文（卷标题行自然落在段内时从尾部剔除）
    const tail = lines.slice(contentStart, contentEnd);
    let cutIndex = tail.length;
    for (let lineIndex = tail.length - 1; lineIndex >= 0; lineIndex -= 1) {
      if (tail[lineIndex]!.match(VOLUME_HEADING_PATTERN)) cutIndex = lineIndex;
    }
    const content = stripTrailingLicense(tail.slice(0, cutIndex).join("\n")).trim();
    chapters.push({
      title: marker.title || inferFallbackTitle(lines[marker.line] ?? "", index + 1),
      content,
      volumeIndex: volumeIndexAtLine(marker.line),
    });
  }

  return { volumes, chapters };
}
