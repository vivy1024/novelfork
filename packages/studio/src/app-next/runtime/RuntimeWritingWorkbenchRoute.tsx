import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IdeWorkbench } from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench/ide";
import type {
  WorkbenchCanvasContext,
  WorkbenchResourceNode,
} from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench";
import { WRITING_PROGRESS_EVENT, writingProgressBookId } from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench/writing-progress-event";

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
  const isReadableReference = resource.kind === "story"
    || resource.kind === "story-markdown"
    || resource.kind === "jingwei"
    || resource.kind === "book-config"
    || resource.kind === "chapter-index";
  const kind: WorkbenchResourceNode["kind"] = isChapter
    ? "chapter"
    : isReadableReference
      ? "story"
      : "unsupported";
  const supported = isChapter || isReadableReference;
  const canRead = resource.capabilities.read === true;
  const canEdit = resource.capabilities.update === true && isChapter;
  const unsupportedReason = !supported
    ? `资源类型「${resource.kind}」当前没有接入 NovelFork 工作台查看器；文件仍保留在工作区，可用外部编辑器打开。`
    : undefined;
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
      ...(unsupportedReason ? { unsupportedReason } : {}),
      ...(resource.metadata ?? {}),
    },
    capabilities: {
      open: canRead,
      readonly: !canEdit,
      unsupported: !supported,
      edit: canEdit,
      delete: resource.capabilities.delete === true,
      apply: false,
    },
  };
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function chapterFileTitle(resource: RuntimeWorkspaceResource, name: string): string {
  if (resource.kind !== "chapter") return name;
  const match = name.match(/^(\d{1,9})[_-](.+)\.md$/u);
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
  // 章节标题是「第N章 …」，纯 localeCompare 会把第 10 章排到第 1 章前面，
  // 十章以上的书目录顺序全是乱的。numeric 让数字段按数值比较。
  const sort = (nodes: readonly WorkbenchResourceNode[]): WorkbenchResourceNode[] => [...nodes]
    .sort((a, b) => a.title.localeCompare(b.title, "zh", { numeric: true }))
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
    // 画布状态栏通过 metadata.book.chapterWordCount 读取作者配置的单章目标字数，
    // 之前这里只塞 bookId/status，导致编辑器目标字数恒显示"未设置"。
    metadata: {
      bookId,
      status: book.status,
      book: {
        id: book.id,
        title: book.title,
        ...(book.platform ? { platform: book.platform } : {}),
        ...(typeof book.chapterWordCount === "number" ? { chapterWordCount: book.chapterWordCount } : {}),
        ...(book.language === "zh" || book.language === "en" ? { language: book.language } : {}),
      },
    },
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
  const [creatingSession, setCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadGenerationRef = useRef(0);
  const reloadAbortRef = useRef<AbortController | null>(null);
  const probeGenerationRef = useRef(0);
  const probeAbortRef = useRef<AbortController | null>(null);
  const latestChapterFingerprintRef = useRef<string | null>(null);
  const actionGenerationRef = useRef(0);
  const actionControllersRef = useRef(new Set<AbortController>());
  const currentBookIdRef = useRef(bookId);
  currentBookIdRef.current = bookId;

  const abortActions = useCallback(() => {
    actionGenerationRef.current += 1;
    for (const controller of actionControllersRef.current) controller.abort();
    actionControllersRef.current.clear();
  }, []);

  useEffect(() => abortActions, [abortActions, bookId]);
  useEffect(() => {
    setCreatingSession(false);
  }, [bookId]);

  const reload = useCallback(async (options?: { readonly silent?: boolean }) => {
    const generation = ++reloadGenerationRef.current;
    reloadAbortRef.current?.abort();
    const controller = new AbortController();
    reloadAbortRef.current = controller;
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [workspace, narrators] = await Promise.all([
        client.getWorkspace(bookId, { signal: controller.signal }),
        client.listNarrators(bookId, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted || generation !== reloadGenerationRef.current) return;
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
      latestChapterFingerprintRef.current = [
        workspace.resources.length,
        ...workspace.resources.slice(-3).map((r) => `${r.id}:${typeof r.metadata?.updatedAt === "string" ? r.metadata.updatedAt : ""}`),
      ].join("|");
    } catch (cause) {
      if (controller.signal.aborted || generation !== reloadGenerationRef.current) return;
      if (silent) return;
      setNodes([]);
      setNarrators([]);
      setActiveNarratorId(null);
      setSelectedNode(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === reloadGenerationRef.current && reloadAbortRef.current === controller) {
        reloadAbortRef.current = null;
        if (!controller.signal.aborted && !silent) setLoading(false);
      }
    }
  }, [bookId, client]);

  useEffect(() => {
    latestChapterFingerprintRef.current = null;
    void reload();
    return () => {
      reloadGenerationRef.current += 1;
      reloadAbortRef.current?.abort();
    };
  }, [reload]);

  // ── 写作完成后自动刷新（免 F5）────────────────────────────────
  // pipeline.write / chapter.write / rewrite.apply 等落盘动作在 Runtime 侧
  // 完成后，前端没有事件推送，只能靠轮询感知。这里用「tab 可见 + 轻量探测」：
  // 每 5 秒查一次最新章号/资源指纹，有变化才触发完整 reload，避免无谓开销。
  const probeWorkspaceChange = useCallback(async () => {
    const generation = ++probeGenerationRef.current;
    probeAbortRef.current?.abort();
    const controller = new AbortController();
    probeAbortRef.current = controller;
    try {
      const workspace = await client.getWorkspace(bookId, { signal: controller.signal });
      if (controller.signal.aborted || generation !== probeGenerationRef.current) return;
      // updatedAt 在服务端载荷的 metadata 里（见 book-provision toWorkspaceWritingResource），不在资源顶层。
      const fingerprint = [
        workspace.resources.length,
        ...workspace.resources.slice(-3).map((r) => `${r.id}:${typeof r.metadata?.updatedAt === "string" ? r.metadata.updatedAt : ""}`),
      ].join("|");
      if (latestChapterFingerprintRef.current === null) {
        latestChapterFingerprintRef.current = fingerprint;
        return;
      }
      if (fingerprint !== latestChapterFingerprintRef.current) {
        latestChapterFingerprintRef.current = fingerprint;
        void reload({ silent: true });
      }
    } catch {
      // 探测失败静默跳过——下一轮再试，不影响主流程。
    } finally {
      if (probeAbortRef.current === controller) probeAbortRef.current = null;
    }
  }, [bookId, client, reload]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void probeWorkspaceChange();
    }, 5_000);
    return () => {
      window.clearInterval(interval);
      probeGenerationRef.current += 1;
      probeAbortRef.current?.abort();
    };
  }, [probeWorkspaceChange]);

  useEffect(() => {
    const handler = (event: Event) => {
      const eventBookId = writingProgressBookId(event);
      if (eventBookId && eventBookId !== bookId) return;
      void reload({ silent: true });
    };
    window.addEventListener(WRITING_PROGRESS_EVENT, handler);
    return () => window.removeEventListener(WRITING_PROGRESS_EVENT, handler);
  }, [bookId, reload]);

  const handleSave = useCallback(async (node: WorkbenchResourceNode, content: string) => {
    if (!node.capabilities.edit) throw new Error("此 Runtime 资源不可编辑");
    const generation = actionGenerationRef.current;
    const controller = new AbortController();
    actionControllersRef.current.add(controller);
    try {
      const result = await client.saveWorkspaceResource(bookId, node.id, content, { signal: controller.signal });
      if (controller.signal.aborted || generation !== actionGenerationRef.current || currentBookIdRef.current !== bookId) return;
      const saved = toNode(bookId, result.resource);
      setNodes((current) => replaceNode(current, saved));
      setSelectedNode((current) => current?.id === saved.id ? saved : current);
    } finally {
      actionControllersRef.current.delete(controller);
    }
  }, [bookId, client]);

  const handleCreateSession = useCallback(async () => {
    if (creatingSession) return;
    const generation = actionGenerationRef.current;
    const controller = new AbortController();
    actionControllersRef.current.add(controller);
    setCreatingSession(true);
    setError(null);
    try {
      const created = await client.createNarrator(bookId, { title: "新建对话" }, { signal: controller.signal });
      if (controller.signal.aborted || generation !== actionGenerationRef.current || currentBookIdRef.current !== bookId) return;
      setNarrators((current) => [
        ...current.filter((candidate) => candidate.id !== created.id),
        created,
      ]);
      setActiveNarratorId(created.id);
      if (generation === actionGenerationRef.current && currentBookIdRef.current === bookId) {
        await onChanged?.();
      }
    } catch (cause) {
      if (controller.signal.aborted || generation !== actionGenerationRef.current || currentBookIdRef.current !== bookId) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      actionControllersRef.current.delete(controller);
      if (generation === actionGenerationRef.current && currentBookIdRef.current === bookId) {
        setCreatingSession(false);
      }
    }
  }, [bookId, client, creatingSession, onChanged]);

  const activeNarrator = narrators.find((candidate) => candidate.id === activeNarratorId) ?? null;

  /**
   * 写作视图的动作按钮：把已确认的写章请求交给当前书籍已授权的叙述者。
   * 消息发送走 Runtime 的 canonical narrator API；bookId 只用于前端绑定校验，工具执行与权限确认仍在 Runtime 侧。
   */
  const handleSendToNarrator = useCallback(async (message: string) => {
    if (!activeNarrator || activeNarrator.bookId !== bookId) {
      throw new Error("当前没有属于此书的可用叙述者会话。");
    }
    const generation = actionGenerationRef.current;
    const controller = new AbortController();
    actionControllersRef.current.add(controller);
    try {
      await runtimeJson(`/api/narrators/${encodeURIComponent(activeNarrator.id)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      if (controller.signal.aborted || generation !== actionGenerationRef.current || currentBookIdRef.current !== bookId) return;
    } catch (cause) {
      if (controller.signal.aborted || generation !== actionGenerationRef.current || currentBookIdRef.current !== bookId) return;
      throw cause;
    } finally {
      actionControllersRef.current.delete(controller);
    }
  }, [activeNarrator, bookId]);

  /**
   * 建书十一问完成 → 刷新工作台资源。
   *
   * 编排消息由 novel-plugin 的 IdeWorkbench 构造后经 onSendToNarrator 发出：
   * 消息模板与十一问同属小说领域，放在产品壳里会让 Studio 值依赖 novel-plugin
   * 的 node 侧模块链（writing-skills loader 用 node:os），打不出浏览器包。
   */
  const handleGuideComplete = useCallback(() => {
    void reload();
  }, [reload]);

  const handleRuntimeFetch = useCallback(
    (input: string, init?: RequestInit) => runtimeJson<unknown>(input, init),
    [],
  );

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col" data-testid="runtime-writing-workbench">
      <div className="flex items-center border-b border-border px-4 py-2">
        <p className="text-sm text-muted-foreground">章节、作品基础、写作资源与故事推进</p>
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
          runtimeFetch={handleRuntimeFetch}
          chatSlot={activeNarrator ? (
            <RuntimeNarratorPanelMount
              key={activeNarrator.id}
              bookId={bookId}
              narrator={activeNarrator}
              compact
            />
          ) : undefined}
          onSwitchToAgent={activeNarrator ? () => onNavigateToConversation(activeNarrator.id) : undefined}
          onSendToNarrator={activeNarrator ? handleSendToNarrator : undefined}
          onGuideComplete={handleGuideComplete}
          bookSessions={narrators.map((narrator) => ({
            id: narrator.id,
            title: narrator.title,
            updatedAt: narrator.updatedAt,
          }))}
          activeSessionId={activeNarrator?.id ?? null}
          onSwitchSession={setActiveNarratorId}
          // 始终允许新建（即使当前没有活跃会话），且显式绑定 bookId——
          // 修复右侧面板新建会话不绑书、变成全局游离会话的 bug。
          onCreateSession={creatingSession ? undefined : () => void handleCreateSession()}
        />
      ) : null}
    </section>
  );
}
