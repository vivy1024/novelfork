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

/** chapters/ 下的 Markdown 保留真实文件名，但交给章节专用编辑器打开。 */
function isChapterFile(path: string): boolean {
  return /^chapters\/.+\.md$/iu.test(path);
}

export function mapBookFileEntryToNode(entry: TreeEntry, bookId: string): WorkbenchResourceNode {
  if (entry.type === "directory") {
    const children = (entry.children ?? []).map(c => mapBookFileEntryToNode(c, bookId));
    return {
      id: `file-dir:${entry.path}`,
      kind: "group",
      title: entry.name,
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
      title: entry.name,
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
      .then(async r => {
        const data = await r.json() as { tree?: TreeEntry[]; message?: string };
        if (!r.ok) throw new Error(data.message ?? "无法读取书籍文件树");
        return data;
      })
      .then((data: { tree?: TreeEntry[] }) => {
        if (cancelled) return;
        setNodes((data.tree ?? []).map(e => mapBookFileEntryToNode(e, bookId)));
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
