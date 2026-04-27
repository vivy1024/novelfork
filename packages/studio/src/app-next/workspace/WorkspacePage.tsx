import { useEffect, useMemo, useState } from "react";

import { ResourceWorkspaceLayout, SectionLayout } from "../components/layouts";
import {
  buildStudioResourceTree,
  type GeneratedChapterCandidate,
  type StudioResourceNode,
  type StudioResourceTreeInput,
} from "./resource-adapter";
import { fetchJson } from "../../hooks/use-api";
import type { BookDetail, ChapterSummary } from "../../shared/contracts";

const SAMPLE_BOOK: BookDetail = {
  id: "book-1",
  title: "灵潮纪元",
  status: "active",
  platform: "qidian",
  genre: "xuanhuan",
  targetChapters: 100,
  chapters: 2,
  chapterCount: 2,
  lastChapterNumber: 2,
  totalWords: 6200,
  approvedChapters: 1,
  pendingReview: 1,
  pendingReviewChapters: 1,
  failedReview: 0,
  failedChapters: 0,
  updatedAt: "2026-04-27T00:00:00.000Z",
  createdAt: "2026-04-20T00:00:00.000Z",
  chapterWordCount: 3000,
  language: "zh",
};

const SAMPLE_CHAPTERS: readonly ChapterSummary[] = [
  { number: 1, title: "第一章 灵潮初起", status: "approved", wordCount: 3100, auditIssueCount: 0, updatedAt: "2026-04-27T00:00:00.000Z", fileName: "0001-first.md" },
  { number: 2, title: "第二章 入城", status: "ready-for-review", wordCount: 3100, auditIssueCount: 2, updatedAt: "2026-04-27T01:00:00.000Z", fileName: "0002-city.md" },
];

const SAMPLE_GENERATED: readonly GeneratedChapterCandidate[] = [
  { id: "candidate-2", bookId: "book-1", targetChapterId: "2", title: "第二章 AI 候选", source: "write-next", createdAt: "2026-04-27T02:00:00.000Z", status: "candidate" },
];

const SAMPLE_INPUT: StudioResourceTreeInput = {
  book: SAMPLE_BOOK,
  chapters: SAMPLE_CHAPTERS,
  generatedChapters: SAMPLE_GENERATED,
  drafts: [{ id: "draft-1", bookId: "book-1", title: "城门冲突片段", updatedAt: "2026-04-27T03:00:00.000Z", wordCount: 800 }],
  bibleCounts: { characters: 3, locations: 2, factions: 1, items: 4, foreshadowing: 5, worldRules: 6 },
};

export interface WorkspaceChapterApi {
  readonly loadChapter: (bookId: string, chapterNumber: number) => Promise<{ readonly content: string }>;
  readonly saveChapter: (bookId: string, chapterNumber: number, content: string) => Promise<void>;
}

interface WorkspacePageProps {
  readonly chapterApi?: WorkspaceChapterApi;
}

const DEFAULT_CHAPTER_API: WorkspaceChapterApi = {
  loadChapter: (bookId, chapterNumber) => fetchJson<{ content: string }>(`/books/${bookId}/chapters/${chapterNumber}`),
  saveChapter: async (bookId, chapterNumber, content) => {
    await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  },
};

export function WorkspacePage({ chapterApi = DEFAULT_CHAPTER_API }: WorkspacePageProps = {}) {
  const tree = useMemo(() => buildStudioResourceTree(SAMPLE_INPUT), []);
  const [selectedNodeId, setSelectedNodeId] = useState("chapter:book-1:1");
  const selectedNode = findNode(tree, selectedNodeId) ?? tree[0]!;

  return (
    <SectionLayout title="创作工作台" description="第一主页面：资源管理器、正文编辑器、AI / 经纬面板三栏闭环。">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium">
            作品选择
            <select aria-label="作品选择" className="ml-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" defaultValue="book-1">
              <option value="book-1">灵潮纪元</option>
            </select>
          </label>
          <input
            aria-label="资源搜索"
            className="min-w-[16rem] rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            placeholder="搜索章节 / 生成稿 / 经纬条目"
            type="search"
          />
        </div>
        <div className="text-sm text-muted-foreground">运行状态：空闲</div>
      </div>

      <ResourceWorkspaceLayout
        explorer={<ResourceTree nodes={tree} selectedNodeId={selectedNode.id} onSelect={setSelectedNodeId} />}
        editor={<WorkspaceEditor chapterApi={chapterApi} node={selectedNode} />}
        assistant={<AssistantPanel selectedNode={selectedNode} />}
      />
    </SectionLayout>
  );
}

function ResourceTree({
  nodes,
  onSelect,
  selectedNodeId,
}: {
  readonly nodes: readonly StudioResourceNode[];
  readonly selectedNodeId: string;
  readonly onSelect: (nodeId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">资源管理器</h2>
      <div className="space-y-1">
        {nodes.map((node) => <ResourceNodeButton key={node.id} node={node} onSelect={onSelect} selectedNodeId={selectedNodeId} />)}
      </div>
    </div>
  );
}

function ResourceNodeButton({
  node,
  onSelect,
  selectedNodeId,
}: {
  readonly node: StudioResourceNode;
  readonly selectedNodeId: string;
  readonly onSelect: (nodeId: string) => void;
}) {
  const isSelected = node.id === selectedNodeId;

  return (
    <div className="space-y-1">
      <button
        aria-current={isSelected ? "page" : undefined}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        onClick={() => onSelect(node.id)}
        type="button"
      >
        <span className="min-w-0 truncate">{node.title}</span>
        <span className="flex shrink-0 items-center gap-1 text-xs opacity-80">
          {node.badge && <span>{node.badge}</span>}
          {typeof node.count === "number" && <span>{node.count}</span>}
        </span>
      </button>
      {node.emptyState && !node.children?.some((child) => (child.count ?? 0) > 0) && (
        <div className="rounded-lg border border-dashed border-border p-2 text-xs text-muted-foreground">
          <div>{node.emptyState.title}</div>
          <button className="mt-1 text-primary hover:underline" type="button">{node.emptyState.actionLabel}</button>
        </div>
      )}
      {node.children?.length ? (
        <div className="ml-3 border-l border-border pl-2">
          {node.children.map((child) => <ResourceNodeButton key={child.id} node={child} onSelect={onSelect} selectedNodeId={selectedNodeId} />)}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceEditor({ chapterApi, node }: { readonly chapterApi: WorkspaceChapterApi; readonly node: StudioResourceNode }) {
  if (node.kind === "generated-chapter") {
    return (
      <div className="space-y-4">
        <EditorHeader title={node.title} meta="候选稿 / 不会自动覆盖正式正文" />
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          生成稿 vs 已有章节
        </div>
        <textarea aria-label="章节正文" className="min-h-[22rem] w-full resize-none rounded-xl border border-border bg-background p-4 leading-7" defaultValue="AI 候选正文会先进入候选区，等待用户确认。" />
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" type="button">合并到正式章节</button>
          <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" type="button">替换正式章节</button>
          <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" type="button">另存为草稿</button>
        </div>
      </div>
    );
  }

  if (node.kind === "chapter") {
    return <ChapterEditor chapterApi={chapterApi} node={node} />;
  }

  if (node.kind === "bible-category") {
    return (
      <div className="space-y-4">
        <EditorHeader title={node.title} meta="经纬资料详情" />
        <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          将复用 Bible / Jingwei API 显示 {node.title} 条目；当前分类已有 {node.count ?? 0} 项。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EditorHeader title={node.title} meta={node.status ?? node.kind} />
      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        点击已有章节、生成章节、草稿或经纬分类后，这里显示对应编辑器、候选稿或详情。
      </div>
    </div>
  );
}

function ChapterEditor({ chapterApi, node }: { readonly chapterApi: WorkspaceChapterApi; readonly node: StudioResourceNode }) {
  const chapterNumber = typeof node.metadata?.chapterNumber === "number" ? node.metadata.chapterNumber : Number(node.metadata?.chapterNumber ?? 0);
  const bookId = typeof node.metadata?.bookId === "string" ? node.metadata.bookId : SAMPLE_BOOK.id;
  const [content, setContent] = useState(`${node.title}\n\n这里会接入 ChapterReader / BookDetail 的真实章节内容与保存能力。`);
  const [saveStatus, setSaveStatus] = useState<"loading" | "clean" | "dirty" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSaveStatus("loading");
    setError(null);
    chapterApi.loadChapter(bookId, chapterNumber)
      .then((chapter) => {
        if (cancelled) return;
        setContent(chapter.content);
        setSaveStatus("clean");
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setSaveStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterApi, chapterNumber]);

  const handleSave = async () => {
    setSaveStatus("saving");
    setError(null);
    try {
      await chapterApi.saveChapter(bookId, chapterNumber, content);
      setSaveStatus("saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      setSaveStatus("error");
    }
  };

  const statusLabel = error ? `保存失败：${error}` : saveStatusToLabel(saveStatus);

  return (
    <div className="space-y-4">
      <EditorHeader onSave={() => void handleSave()} saveDisabled={saveStatus === "loading" || saveStatus === "saving"} title={node.title} meta={`章节状态：${node.status ?? "unknown"} · 字数：${countWords(content)} · 保存状态：${statusLabel}`} />
      {saveStatus === "loading" && <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">正在加载章节正文...</div>}
      {error && <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">保存失败：{error}</div>}
      <textarea
        aria-label="章节正文"
        className="min-h-[26rem] w-full resize-none rounded-xl border border-border bg-background p-4 leading-7"
        onChange={(event) => {
          setContent(event.target.value);
          setError(null);
          setSaveStatus("dirty");
        }}
        value={content}
      />
      <div className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">生成稿 vs 已有章节</div>
    </div>
  );
}

function saveStatusToLabel(status: "loading" | "clean" | "dirty" | "saving" | "saved" | "error"): string {
  switch (status) {
    case "loading":
      return "加载中";
    case "dirty":
      return "未保存";
    case "saving":
      return "保存中";
    case "saved":
      return "已保存";
    case "error":
      return "失败";
    case "clean":
    default:
      return "未修改";
  }
}

function countWords(content: string): number {
  return content.replace(/\s+/g, "").length;
}

function EditorHeader({
  title,
  meta,
  onSave,
  saveDisabled = false,
}: {
  readonly title: string;
  readonly meta: string;
  readonly onSave?: () => void;
  readonly saveDisabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>
      <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50" disabled={saveDisabled} onClick={onSave} type="button">保存</button>
    </div>
  );
}

function AssistantPanel({ selectedNode }: { readonly selectedNode: StudioResourceNode }) {
  const actions = ["生成下一章", "续写当前段落", "审校当前章", "改写选中段落", "去 AI 味", "连续性检查"];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">AI / 经纬面板</h2>
      <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">当前上下文：{selectedNode.title}</div>
      {actions.map((label) => (
        <button key={label} className="w-full rounded-xl border border-border px-3 py-2 text-left text-sm hover:bg-muted" type="button">
          {label}
          <span className="ml-2 text-xs text-muted-foreground">输出到候选稿</span>
        </button>
      ))}
      <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
        <div className="font-medium">相关经纬</div>
        <p className="mt-1 text-muted-foreground">人物、地点、伏笔、前文摘要会按当前章节展示；未关联时提供创建入口。</p>
      </div>
    </div>
  );
}

function findNode(nodes: readonly StudioResourceNode[], nodeId: string): StudioResourceNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const found = findNode(node.children ?? [], nodeId);
    if (found) return found;
  }
  return undefined;
}
