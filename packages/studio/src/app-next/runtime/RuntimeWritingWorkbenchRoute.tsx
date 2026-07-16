import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { IdeWorkbench } from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench/ide";
import type {
  WorkbenchCanvasContext,
  WorkbenchResourceNode,
} from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench";

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
  readonly client?: RuntimeProductClient;
}

function toNode(bookId: string, resource: RuntimeWorkspaceResource): WorkbenchResourceNode {
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
    title: resource.title,
    ...(resource.content !== undefined && resource.content !== null ? { content: resource.content } : {}),
    ...(resource.path ? { path: resource.path } : {}),
    metadata: {
      bookId,
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
  const chapters = activeResources
    .filter((resource) => resource.kind === "chapter")
    .map((resource) => toNode(bookId, resource));
  const candidates = activeResources
    .filter((resource) => resource.kind === "candidate")
    .map((resource) => toNode(bookId, resource));
  const drafts = activeResources
    .filter((resource) => resource.kind === "draft")
    .map((resource) => toNode(bookId, resource));
  const archived = resources
    .filter((resource) => resource.metadata?.status === "archived" || resource.metadata?.status === "rejected")
    .map((resource) => toNode(bookId, resource));
  const references = resources
    .filter((resource) => !["chapter", "candidate", "draft"].includes(resource.kind))
    .map((resource) => toNode(bookId, resource));
  const groupCapabilities = { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false } as const;
  const groups: WorkbenchResourceNode[] = [
    {
      id: "runtime-group:chapters",
      kind: "group",
      title: "章节",
      capabilities: groupCapabilities,
      children: chapters,
    },
    ...(candidates.length
      ? [{ id: "runtime-group:candidates", kind: "group" as const, title: "候选稿", capabilities: groupCapabilities, children: candidates }]
      : []),
    ...(drafts.length
      ? [{ id: "runtime-group:drafts", kind: "group" as const, title: "草稿", capabilities: groupCapabilities, children: drafts }]
      : []),
    ...(archived.length
      ? [{ id: "runtime-group:archived", kind: "group" as const, title: "已归档", capabilities: groupCapabilities, children: archived }]
      : []),
    ...(references.length
      ? [{
          id: "runtime-group:reference",
          kind: "group" as const,
          title: "大纲与设定",
          capabilities: groupCapabilities,
          children: references,
        }]
      : []),
    {
      id: "jingwei-panel-entry",
      kind: "jingwei",
      title: "经纬资料",
      metadata: { bookId, action: "open-jingwei-panel" },
      capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
    },
    {
      id: "narrative-memory-graph",
      kind: "storyline",
      title: "Narrative Memory",
      metadata: { bookId, isNarrativeMemoryEntry: true },
      capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
    },
  ];

  if (!book) return groups;
  return [{
    id: `book:${book.id}`,
    kind: "book",
    title: book.title,
    metadata: { bookId: book.id, status: book.status },
    capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
    children: groups,
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
    if (node.id === "runtime-group:chapters") {
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
  client: suppliedClient,
}: RuntimeWritingWorkbenchRouteProps) {
  const defaultClient = useMemo(() => createRuntimeProductClient(), []);
  const client = suppliedClient ?? defaultClient;
  const [nodes, setNodes] = useState<WorkbenchResourceNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<WorkbenchResourceNode | null>(null);
  const [narrator, setNarrator] = useState<Awaited<ReturnType<RuntimeProductClient["listNarrators"]>>[number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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
      setNodes(nextNodes);
      setNarrator(narrators.find((candidate) => candidate.capabilities.read === true) ?? null);
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
      setNarrator(null);
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

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col" data-testid="runtime-writing-workbench">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <p className="text-sm text-muted-foreground">Runtime 受控小说工作台：章节、经纬、写作资源与 Narrative Memory 均来自真实书籍绑定</p>
        <Button type="button" size="sm" onClick={() => void handleCreateChapter()} disabled={creating || loading}>
          {creating ? "创建中…" : "新建章节"}
        </Button>
      </div>
      {loading ? <p className="p-4 text-sm text-muted-foreground" role="status">正在加载 Runtime 工作台…</p> : null}
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
          chatSlot={narrator ? (
            <RuntimeNarratorPanelMount
              key={narrator.id}
              bookId={bookId}
              narrator={narrator}
              compact
            />
          ) : undefined}
          onSwitchToAgent={narrator ? () => onNavigateToConversation(narrator.id) : undefined}
          bookSessions={narrator ? [{ id: narrator.id, title: narrator.title, updatedAt: narrator.updatedAt }] : []}
          activeSessionId={narrator?.id ?? null}
        />
      ) : null}
    </section>
  );
}
