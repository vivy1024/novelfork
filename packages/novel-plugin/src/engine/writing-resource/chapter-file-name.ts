/**
 * 章节文件名约定（不依赖 node:fs，前后端共用）。
 *
 * 章节正文落在 `chapters/<卷目录>/<四位章号>_<标题>.md`。服务端的布局与对账
 * （chapter-layout.ts）和前端的显示名都从这里解析，避免两边各写一份正则。
 */

export const CHAPTER_FILE_PATTERN = /^(\d{1,9})[_-](.+)\.md$/iu;

export interface ParsedChapterFile {
  readonly number: number;
  readonly fileName: string;
  readonly title: string;
}

export function parseChapterFileName(fileName: string): ParsedChapterFile | null {
  const baseName = fileName.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? fileName;
  const match = CHAPTER_FILE_PATTERN.exec(baseName);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return {
    number,
    fileName: baseName,
    title: match[2]!.replace(/[_-]+/gu, " ").trim() || `第 ${number} 章`,
  };
}
