export interface SplitChapter {
  readonly title: string;
  readonly content: string;
}

/**
 * Split a single text file into chapters by matching title lines.
 *
 * Default pattern matches:
 * - "第一章 xxxx" / "第1章 xxxx"
 * - "# 第1章 xxxx" / "## 第23章 xxxx"
 *
 * Each match marks the start of a new chapter. Content between matches
 * belongs to the preceding chapter.
 */
export function splitChapters(
  text: string,
  pattern?: string,
): ReadonlyArray<SplitChapter> {
  const defaultPattern = /^#{0,2}\s*第[零一二三四五六七八九十百千万\d]+章\s*(.*)/;
  const regex = pattern ? new RegExp(pattern, "m") : defaultPattern;

  const lines = text.split("\n");
  const chapters: Array<{ title: string; startLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(regex);
    if (match) {
      chapters.push({
        title: (match[1] ?? "").trim(),
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
    const content = contentLines.join("\n").trim();

    result.push({
      title: chapter.title || `第${i + 1}章`,
      content,
    });
  }

  return result;
}
