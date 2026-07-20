import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { IdeWorkbench } from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench/ide";
import type {
  WorkbenchCanvasContext,
  WorkbenchResourceNode,
} from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench";

import { runtimeJson } from "./auth";
import {
  createRuntimeProductClient,
  type RuntimeBookSummary,
  type RuntimeProductClient,
  type RuntimeWorkspaceResource,
} from "./product-contract";
import { RuntimeNarratorPanelMount } from "./RuntimeNarratorPanelMount";

export interface RuntimeWritingWorkbenchRouteProps {
  readonly bookId: string;
  readonly onCanvasContextChange: (context: WorkbenchCanvasContext) => void;
  readonly onNavigateToConversation: (narratorId: string) => void;
  readonly onChanged?: () => void | Promise<void>;
  readonly client?: RuntimeProductClient;
}

function toNode(bookId: string, resource: RuntimeWorkspaceResource, title?: string): WorkbenchResourceNode {
  const isChapter = resource.kind === "chapter";
  const isCandidate = resource.kind === "candidate";
  const isDraft = resource.kind === "draft";
  const isReadableReference = resource.kind === "story"
    || resource.kind === "story-markdown"
    || resource.kind === "jingwei"
    || resource.kind === "book-config"
    || resource.kind === "chapter-index";
  const kind: WorkbenchResourceNode["kind"] = isChapter
    ? "chapter"
    : isCandidate
      ? "candidate"
      : isDraft
        ? "draft"
        : isReadableReference
          ? "story"
          : "unsupported";
  const supported = isChapter || isCandidate || isDraft || isReadableReference;
  const canRead = resource.capabilities.read === true;
  const canEdit = resource.capabilities.update === true && (isChapter || isDraft);
  return {
    id: resource.id,
    kind,
    title: title ?? resource.title,
    ...(resource.content !== undefined && resource.content !== null ? { content: resource.content } : {}),
    ...(resource.path ? { path: resource.path } : {}),
    metadata: {
      bookId,
      ...(resource.path ? { filePath: resource.path, isFile: true } : {}),
      ...(isChapter ? { isChapter: true } : {}),
      ...(resource.metadata ?? {}),
    },
    capabilities: {
      open: canRead,
      readonly: !canEdit,
      unsupported: !supported,
      edit: canEdit,
      delete: resource.capabilities.delete === true,
      apply: isCandidate || isDraft,
    },
  };
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function chapterFileTitle(resource: RuntimeWorkspaceResource, name: string): string {
  if (resource.kind !== "chapter") return name;
  const match = name.match(/^(\d{4})_(.+)\.md$/u);
  if (!match) return resource.title || name;
  const number = Number(match[1]);
  return `第${number}章 ${resource.title || match[2].replaceAll("_", " ")}`;
}

/** Build the Explorer from the same path-shaped tree used by the IDE file view. */
function mapResourcesToFileTree(bookId: string, resources: readonly RuntimeWorkspaceResource[]): WorkbenchResourceNode[] {
  type MutableDir = WorkbenchResourceNode & { children: WorkbenchResourceNode[] };
  const roots: MutableDir[] = [];
  const ensureDir = (parts: string[]): MutableDir => {
    let siblings = roots;
    let currentPath = "";
    let current: MutableDir | undefined;
    for (let index = 0; index < parts.length; index += 1) {
      currentPath = currentPath ? `${currentPath}/${parts[index]}` : parts[index];
      let next = siblings.find((node) => node.metadata?.filePath === currentPath) as MutableDir | undefined;
      if (!next) {
        next = {
          id: `file-dir:${currentPath}`,
          kind: "group",
          title: index === 0 ? ({ chapters: "正文", story: "设定", jingwei: "经纬文件" }[parts[0]] ?? parts[0]) : parts[index],
          capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
          metadata: { bookId, filePath: currentPath, isDirectory: true },
          children: [],
        };
        siblings.push(next);
      }
      current = next;
      siblings = next.children as MutableDir[];
    }
    return current!;
  };

  for (const resource of resources) {
    const path = resource.path?.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
    if (!path) continue;
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const parent = parts.length === 1 ? null : ensureDir(parts.slice(0, -1));
    const name = fileName(path);
    const leaf = toNode(bookId, resource, chapterFileTitle(resource, name));
    if (parent) parent.children.push(leaf);
    else roots.push(leaf as MutableDir);
  }
  const sort = (nodes: readonly WorkbenchResourceNode[]): WorkbenchResourceNode[] => [...nodes]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((node) => node.children ? { ...node, children: sort(node.children) } : node);
  return sort([...roots.values()]);
}

/** Maps the trusted Runtime snapshot into the retained NovelFork workbench. */
export function mapRuntimeWorkspaceToWorkbenchNodes(
  bookId: string,
  resources: readonly RuntimeWorkspaceResource[],
  book?: RuntimeBookSummary,
): WorkbenchResourceNode[] {
  const activeResources = resources.filter((resource) => {
    const status = resource.metadata?.status;
    return status !== "archived" && status !== "rejected";
  });
  const fileTree = mapResourcesToFileTree(bookId, activeResources);
  if (!book) return fileTree;
  return [{
    id: `book:${book.id}`,
    kind: "book",
    title: book.title,
    metadata: { bookId, status: book.status },
    capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
    children: fileTree,
  }];
}

function replaceNode(nodes: readonly WorkbenchResourceNode[], replacement: WorkbenchResourceNode): WorkbenchResourceNode[] {
  return nodes.map((node) => {
    if (node.id === replacement.id) return replacement;
    return node.children?.length ? { ...node, children: replaceNode(node.children, replacement) } : node;
  });
}

function appendChapter(nodes: readonly WorkbenchResourceNode[], chapter: WorkbenchResourceNode): WorkbenchResourceNode[] {
  return nodes.map((node) => {
    if (node.metadata?.filePath === "chapters" && node.metadata.isDirectory) {
      return { ...node, children: [...(node.children ?? []), chapter] };
    }
    return node.children?.length ? { ...node, children: appendChapter(node.children, chapter) } : node;
  });
}

/**
 * Runtime workspace facade for the preserved IDE shell. The book ID is only a
 * semantic product identifier; every `/api/books/*` request is authenticated and
 * revalidated against the server-owned binding before novel-plugin can use it.
 */
export function RuntimeWritingWorkbenchRoute({
  bookId,
  onCanvasContextChange,
  onNavigateToConversation,
  onChanged,
  client: suppliedClient,
}: RuntimeWritingWorkbenchRouteProps) {
  const defaultClient = useMemo(() => createRuntimeProductClient(), []);
  const client = suppliedClient ?? defaultClient;
  const [nodes, setNodes] = useState<WorkbenchResourceNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<WorkbenchResourceNode | null>(null);
  const [narrators, setNarrators] = useState<Awaited<ReturnType<RuntimeProductClient["listNarrators"]>>>([]);
  const [activeNarratorId, setActiveNarratorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workspace, narrators] = await Promise.all([
        client.getWorkspace(bookId),
        client.listNarrators(bookId),
      ]);
      const nextNodes = mapRuntimeWorkspaceToWorkbenchNodes(bookId, workspace.resources, workspace.book);
      const readableNarrators = narrators.filter((candidate) => candidate.capabilities.read === true);
      const defaultNarrator = readableNarrators.find((candidate) => candidate.status !== "archived") ?? readableNarrators[0];
      setNodes(nextNodes);
      setNarrators(readableNarrators);
      setActiveNarratorId((current) =>
        current && readableNarrators.some((candidate) => candidate.id === current)
          ? current
          : defaultNarrator?.id ?? null,
      );
      setSelectedNode((current) => {
        if (!current) return null;
        const flatten = (items: readonly WorkbenchResourceNode[]): WorkbenchResourceNode | null => {
          for (const item of items) {
            if (item.id === current.id) return item;
            const nested = item.children ? flatten(item.children) : null;
            if (nested) return nested;
          }
          return null;
        };
        return flatten(nextNodes);
      });
    } catch (cause) {
      setNodes([]);
      setNarrators([]);
      setActiveNarratorId(null);
      setSelectedNode(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [bookId, client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSave = useCallback(async (node: WorkbenchResourceNode, content: string) => {
    if (!node.capabilities.edit) throw new Error("此 Runtime 资源不可编辑");
    const result = await client.saveWorkspaceResource(bookId, node.id, content);
    const saved = toNode(bookId, result.resource);
    setNodes((current) => replaceNode(current, saved));
    setSelectedNode((current) => current?.id === saved.id ? saved : current);
  }, [bookId, client]);

  const handleCreateChapter = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await client.createWorkspaceChapter(bookId);
      const chapter = toNode(bookId, result.resource);
      setNodes((current) => appendChapter(current, chapter));
      setSelectedNode(chapter);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }, [bookId, client]);

  const handleCreateSession = useCallback(async () => {
    if (creatingSession) return;
    setCreatingSession(true);
    setError(null);
    try {
      const created = await client.createNarrator(bookId, { title: "新建对话" });
      setNarrators((current) => [
        ...current.filter((candidate) => candidate.id !== created.id),
        created,
      ]);
      setActiveNarratorId(created.id);
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreatingSession(false);
    }
  }, [bookId, client, creatingSession, onChanged]);

  const activeNarrator = narrators.find((candidate) => candidate.id === activeNarratorId) ?? null;

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col" data-testid="runtime-writing-workbench">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <p className="text-sm text-muted-foreground">章节、经纬、写作资源与叙事记忆</p>
        <Button type="button" size="sm" onClick={() => void handleCreateChapter()} disabled={creating || loading}>
          {creating ? "创建中…" : "新建章节"}
        </Button>
      </div>
      {loading ? <p className="p-4 text-sm text-muted-foreground" role="status">正在加载工作台…</p> : null}
      {error ? <p className="p-4 text-sm text-destructive" role="alert">工作台加载失败：{error}</p> : null}
      {!loading && !error ? (
        <IdeWorkbench
          bookId={bookId}
          nodes={nodes}
          selectedNode={selectedNode}
          onOpen={setSelectedNode}
          onDeselectNode={() => setSelectedNode(null)}
          onSave={handleSave}
          onCanvasContextChange={onCanvasContextChange}
          runtimeProductMode
          runtimeFetch={(input, init) => runtimeJson<unknown>(input, init)}
          chatSlot={activeNarrator ? (
            <RuntimeNarratorPanelMount
              key={activeNarrator.id}
              bookId={bookId}
              narrator={activeNarrator}
              compact
            />
          ) : undefined}
          onSwitchToAgent={activeNarrator ? () => onNavigateToConversation(activeNarrator.id) : undefined}
          bookSessions={narrators.map((narrator) => ({
            id: narrator.id,
            title: narrator.title,
            updatedAt: narrator.updatedAt,
          }))}
          activeSessionId={activeNarrator?.id ?? null}
          onSwitchSession={setActiveNarratorId}
          onCreateSession={activeNarrator ? () => void handleCreateSession() : undefined}
        />
      ) : null}
    </section>
  );
}
