// ---------------------------------------------------------------------------
// File Parser — 作品导入文件解析（.txt / .md / .docx / .epub）
// ---------------------------------------------------------------------------

export interface ParsedChapter {
  title: string;
  content: string;
}

export interface ParseResult {
  chapters: ParsedChapter[];
}

/** 最大章节数截断阈值 */
const MAX_CHAPTERS = 100;

/**
 * 按空行分章解析纯文本。
 * - 连续 2+ 个换行作为章节分隔
 * - 每段第一行作为标题，其余作为内容
 * - 如果没有明显分章，整个文本作为一章
 */
export function parseTxt(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { chapters: [] };

  // 按连续 2+ 个换行分割
  const segments = trimmed.split(/\n\s*\n/).filter((s) => s.trim().length > 0);

  if (segments.length <= 1) {
    // 没有明显分章 → 整个文本作为一章
    const lines = trimmed.split("\n");
    const title = lines[0]?.trim() || "第一章";
    const content = lines.length > 1 ? lines.slice(1).join("\n").trim() : trimmed;
    return { chapters: [{ title, content }] };
  }

  const chapters: ParsedChapter[] = [];
  for (const segment of segments) {
    const lines = segment.split("\n");
    const title = lines[0]?.trim() || `第${chapters.length + 1}章`;
    const content = lines.length > 1 ? lines.slice(1).join("\n").trim() : "";
    chapters.push({ title, content });
  }

  // 大文件截断
  if (chapters.length > MAX_CHAPTERS) {
    return { chapters: chapters.slice(0, MAX_CHAPTERS) };
  }

  return { chapters };
}

/**
 * 根据文件扩展名选择解析器。
 * - txt / md → parseTxt
 * - docx / epub → 暂不支持，返回空结果
 */
export function parseFile(content: string, filename: string): ParseResult {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "txt" || ext === "md") return parseTxt(content);
  // docx 和 epub 暂不实现
  return { chapters: [] };
}
