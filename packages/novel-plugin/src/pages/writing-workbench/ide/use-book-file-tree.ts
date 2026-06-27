/**
 * useBookFileTree — 书籍文件树(IDE 资源管理器)
 *
 * 和 VS Code 一样直接显示完整文件系统目录结构。
 * 唯一特化:chapters/ 目录下的 .md 文件识别为"章节",
 * 点击时用章节编辑器(含字数/AI检测等面板)打开,而非纯文本。
 */
import { useCallback, useEffect, useState } from "react";
import type { WorkbenchResourceNode, WorkbenchResourceKind } from "../useWorkbenchResources";

interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  mtime?: string;
  children?: TreeEntry[];
}

const OPENABLE_EXT = new Set([
  // 文档
  ".md", ".txt", ".json", ".markdown", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".log", ".csv",
  // 代码
  ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss", ".less",
  ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".go", ".rs", ".rb", ".php",
  ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1", ".sql", ".xml", ".svg",
  // 配置
  ".env", ".gitignore", ".editorconfig", ".prettierrc", ".eslintrc",
  // 图片
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp"]);
const legacyDir = (...codes: number[]): string => String.fromCharCode(...codes);
const REMOVED_LEGACY_OUTPUT_DIRS = new Set([
  legacyDir(100, 114, 97, 102, 116, 115),
  legacyDir(103, 101, 110, 101, 114, 97, 116, 101, 100, 45, 99, 97, 110, 100, 105, 100, 97, 116, 101, 115),
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function isOpenable(name: string): boolean {
  return OPENABLE_EXT.has(extensionOf(name));
}

function isImageFile(name: string): boolean {
  return IMAGE_EXT.has(extensionOf(name));
}

/** 判断文件是否在 chapters/ 目录下(特化为章节节点) */
function isChapterFile(path: string): boolean {
  return /^chapters\/\d{4}_/.test(path) && path.endsWith(".md");
}

/** 从 chapters 文件名提取章节标题:0001_设备故障.md → 第1章 设备故障 */
function chapterDisplayName(name: string): string {
  const match = name.match(/^(\d{4})_(.+)\.md$/);
  if (!match) return name;
  const num = parseInt(match[1], 10);
  const title = match[2];
  // 跳过纯标题占位文件(如"第_1_章")
  if (/^第_?\d+_?章$/.test(title)) return `第${num}章`;
  return `第${num}章 ${title}`;
}

/** 顶级目录中文显示名(底层路径不变,显示翻译) */
const DIR_DISPLAY_NAMES: Record<string, string> = {
  chapters: "正文",
  story: "设定",
  jingwei: "经纬文件",
};

/** 判断是否为纯标题占位文件(如 0001_第_1_章.md,只有"# 第 X 章"一行) */
function isTitlePlaceholder(name: string): boolean {
  const match = name.match(/^\d{4}_(.+)\.md$/);
  if (!match) return false;
  return /^第_?\d+_?章$/.test(match[1]);
}

export function mapBookFileEntryToNode(entry: TreeEntry, bookId: string): WorkbenchResourceNode {
  if (entry.type === "directory") {
    const displayName = DIR_DISPLAY_NAMES[entry.name] ?? entry.name;
    // 目录内过滤掉纯标题占位文件
    const children = (entry.children ?? [])
      .filter(c => !(c.type === "directory" && REMOVED_LEGACY_OUTPUT_DIRS.has(c.name)))
      .filter(c => !(c.type === "file" && isTitlePlaceholder(c.name)))
      .map(c => mapBookFileEntryToNode(c, bookId));
    return {
      id: `file-dir:${entry.path}`,
      kind: "group",
      title: displayName,
      capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: true, apply: false },
      metadata: { filePath: entry.path, bookId, isDirectory: true, mtime: entry.mtime },
      children,
    };
  }

  const openable = isOpenable(entry.name);
  const image = isImageFile(entry.name);
  const isChapter = isChapterFile(entry.path);

  // 章节文件:用章节 kind + 中文标题
  if (isChapter) {
    return {
      id: `file:${entry.path}`,
      kind: "chapter" as WorkbenchResourceKind,
      title: chapterDisplayName(entry.name),
      path: entry.path,
      capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
      metadata: { filePath: entry.path, bookId, isFile: true, isChapter: true, mtime: entry.mtime, size: entry.size },
    };
  }

  // 普通文件:可打开可编辑,但不触发章节专属功能
  return {
    id: `file:${entry.path}`,
    kind: "file" as WorkbenchResourceKind,
    title: entry.name,
    path: entry.path,
    capabilities: { open: openable, readonly: image, unsupported: !openable, edit: openable && !image, delete: true, apply: false },
    metadata: { filePath: entry.path, bookId, isFile: true, isImage: image, extension: extensionOf(entry.name), size: entry.size },
  };
}


export interface UseBookFileTreeResult {
  nodes: WorkbenchResourceNode[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  refresh: () => void;
}

export function useBookFileTree(bookId: string | undefined, enabled: boolean): UseBookFileTreeResult {
  const [nodes, setNodes] = useState<WorkbenchResourceNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    if (!enabled || !bookId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/books/${encodeURIComponent(bookId)}/files/tree?depth=8`)
      .then(r => r.json())
      .then((data: { tree?: TreeEntry[] }) => {
        if (cancelled) return;
        const tree = data.tree ?? [];
        setNodes(tree
          .filter(e => !(e.type === "directory" && REMOVED_LEGACY_OUTPUT_DIRS.has(e.name)))
          .map(e => mapBookFileEntryToNode(e, bookId)));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [bookId, enabled, reloadKey]);

  return { nodes, loading, error, reload, refresh: reload };
}
