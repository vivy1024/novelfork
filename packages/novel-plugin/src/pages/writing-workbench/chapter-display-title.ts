/**
 * 章节在界面上的显示名。
 *
 * 章节文件名 `0001_雨夜.md` 是存储约定，作者在标签页、面包屑、章节树里看到的应是
 * 「第 1 章 雨夜」。资源管理器（原始文件树）仍显示真实文件名，重命名、移动等文件操作
 * 也继续用文件名；这里只换显示，不改节点数据。
 */

import { parseChapterFileName } from "../../engine/writing-resource/chapter-file-name";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

/** 章节正文所在的顶层目录，界面上叫「正文」。 */
export const CHAPTERS_ROOT_DIRECTORY = "chapters";
export const CHAPTERS_ROOT_LABEL = "正文";

/** 标题本身已写成「第X章…」时不再重复加章号前缀。 */
const CHAPTER_PREFIX = /^第\s*[0-9一二三四五六七八九十百千万零〇两]+\s*章/u;

function baseName(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? path;
}

/** 按章号与标题拼显示名：`第 1 章 雨夜`；没有可用标题时只给 `第 1 章`。 */
export function formatChapterTitle(chapterNumber: number, title?: string | null): string {
  const label = `第 ${chapterNumber} 章`;
  const trimmed = title?.trim() ?? "";
  if (!trimmed || trimmed === label) return label;
  if (CHAPTER_PREFIX.test(trimmed)) return trimmed;
  return `${label} ${trimmed}`;
}

/**
 * 章节文件路径（或文件名）→ 显示名。认不出章号的文件返回 null，由调用方退回原名。
 * `0001.md` 这种只有章号的文件也算章节（与资源树的章号识别一致）。
 */
export function chapterDisplayTitleFromPath(path: string): string | null {
  const name = baseName(path);
  const parsed = parseChapterFileName(name);
  if (parsed) return formatChapterTitle(parsed.number, parsed.title);
  const bare = /^(\d{1,9})\.md$/iu.exec(name);
  if (!bare) return null;
  const number = Number(bare[1]);
  return Number.isSafeInteger(number) && number > 0 ? formatChapterTitle(number) : null;
}

function nodeFilePath(node: WorkbenchResourceNode): string {
  const raw = node.metadata?.filePath ?? node.path ?? "";
  return typeof raw === "string" ? raw.replaceAll("\\", "/") : "";
}

/** 是否为 chapters/ 下的章节文件节点（资源树把它标成 kind=chapter）。 */
function isChapterFileNode(node: WorkbenchResourceNode): boolean {
  return node.kind === "chapter" && node.metadata?.isFile === true;
}

/**
 * 章节视图（标签页、面包屑、故事推进的章节树）里节点的显示名。
 * - 章节文件：`第 N 章 标题`；
 * - `chapters` 顶层目录：`正文`；
 * - 其它节点：原标题。
 */
export function resourceDisplayTitle(node: WorkbenchResourceNode): string {
  if (isChapterFileNode(node)) {
    return chapterDisplayTitleFromPath(nodeFilePath(node) || node.title) ?? node.title;
  }
  if (node.metadata?.isDirectory === true && nodeFilePath(node) === CHAPTERS_ROOT_DIRECTORY) {
    return CHAPTERS_ROOT_LABEL;
  }
  return node.title;
}

/**
 * 按标签页记录恢复显示名：旧版本把章节文件名存成了标签标题，读取时换成显示名。
 * 章节标签的 nodeId 形如 `file:chapters/卷01/0001_雨夜.md`。
 */
export function chapterTabTitle(nodeId: string, storedTitle: string): string {
  if (!nodeId.startsWith(`file:${CHAPTERS_ROOT_DIRECTORY}/`)) return storedTitle;
  return chapterDisplayTitleFromPath(nodeId.slice("file:".length)) ?? storedTitle;
}

/**
 * 文件节点的面包屑路径段（不含书名）。章节文件把顶层 `chapters` 显示为「正文」、
 * 末段显示为章节名；段数与真实路径一致，点击某段仍按路径前缀定位目录。
 */
export function fileBreadcrumbParts(node: WorkbenchResourceNode): string[] {
  const parts = nodeFilePath(node).split("/").filter(Boolean);
  if (!isChapterFileNode(node) || parts.length === 0) return parts;
  return parts.map((part, index) => {
    if (index === 0 && part === CHAPTERS_ROOT_DIRECTORY) return CHAPTERS_ROOT_LABEL;
    if (index === parts.length - 1) return chapterDisplayTitleFromPath(part) ?? part;
    return part;
  });
}
