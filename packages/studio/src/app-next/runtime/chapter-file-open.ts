const CHAPTER_FILE = /^(\d{1,9})[_-].+\.md$/iu;

function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+/gu, "/");
}

/**
 * 叙述者面板要打开的文件若是本书的章节，返回章号；否则返回 null。
 *
 * 路径可能是绝对路径（工具结果、文件浏览器）也可能相对叙述者工作目录；两种都只认
 * `<书籍根>/chapters/…/NNNN_标题.md`。书籍根取叙述者的可信工作目录，不从路径本身推断。
 * Windows 下盘符与目录名不区分大小写。
 */
export function chapterNumberFromRuntimeFilePath(
  filePath: string,
  bookRoot: string | null | undefined,
): number | null {
  if (!filePath) return null;
  const path = normalize(filePath);
  let relative: string;
  if (/^(?:[a-z]:\/|\/)/iu.test(path)) {
    if (!bookRoot) return null;
    const root = normalize(bookRoot).replace(/\/$/u, "");
    if (path.slice(0, root.length + 1).toLowerCase() !== `${root.toLowerCase()}/`) return null;
    relative = path.slice(root.length + 1);
  } else {
    relative = path.replace(/^\.\//u, "");
  }
  const segments = relative.split("/");
  if (segments[0] !== "chapters" || segments.includes("..") || segments.length < 2) return null;
  const match = CHAPTER_FILE.exec(segments.at(-1) ?? "");
  if (!match) return null;
  const chapterNumber = Number(match[1]);
  return Number.isSafeInteger(chapterNumber) && chapterNumber > 0 ? chapterNumber : null;
}
