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

const OPENABLE_EXT = new Set([".md", ".txt", ".json", ".markdown", ".yaml", ".yml"]);

function isOpenable(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && OPENABLE_EXT.has(name.slice(dot).toLowerCase());
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
  drafts: "草稿",
  story: "设定",
  "generated-candidates": "候选稿",
  jingwei: "经纬文件",
};

/** 判断是否为纯标题占位文件(如 0001_第_1_章.md,只有"# 第 X 章"一行) */
function isTitlePlaceholder(name: string): boolean {
  const match = name.match(/^\d{4}_(.+)\.md$/);
  if (!match) return false;
  return /^第_?\d+_?章$/.test(match[1]);
}

function entryToNode(entry: TreeEntry, bookId: string): WorkbenchResourceNode {
  if (entry.type === "directory") {
    const displayName = DIR_DISPLAY_NAMES[entry.name] ?? entry.name;
    // 目录内过滤掉纯标题占位文件
    const children = (entry.children ?? [])
      .filter(c => !(c.type === "file" && isTitlePlaceholder(c.name)))
      .map(c => entryToNode(c, bookId));
    return {
      id: `file-dir:${entry.path}`,
      kind: "group",
      title: displayName,
      capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: true, apply: false },
      metadata: { filePath: entry.path, bookId, isDirectory: true },
      children,
    };
  }

  const openable = isOpenable(entry.name);
  const isChapter = isChapterFile(entry.path);

  // 章节文件:用章节 kind + 中文标题
  if (isChapter) {
    return {
      id: `file:${entry.path}`,
      kind: "chapter" as WorkbenchResourceKind,
      title: chapterDisplayName(entry.name),
      path: entry.path,
      capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
      metadata: { filePath: entry.path, bookId, isFile: true, isChapter: true },
    };
  }

  // 普通文件:可打开可编辑
  return {
    id: `file:${entry.path}`,
    kind: "chapter" as WorkbenchResourceKind,
    title: entry.name,
    path: entry.path,
    capabilities: { open: openable, readonly: false, unsupported: !openable, edit: openable, delete: true, apply: false },
    metadata: { filePath: entry.path, bookId, isFile: true },
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
        setNodes(tree.map(e => entryToNode(e, bookId)));
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
