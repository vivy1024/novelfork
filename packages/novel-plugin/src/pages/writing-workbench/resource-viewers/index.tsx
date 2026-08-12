import { useState, useCallback, type ReactNode } from "react";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sparkles, Pencil, Plus, Trash2 } from "lucide-react";
import type { WorkbenchResourceKind, WorkbenchResourceNode } from "../useWorkbenchResources";
import { CATEGORY_SCHEMAS, type CategorySchema } from "../jingwei/category-schemas";
import { ChapterEditor } from "./ChapterEditor";
import { getImageRawUrl, isImageResourceNode } from "./image-resource";
import { submitNarrativeLineChange } from "../narrative-line-proposals";
import { memoryFactLabel } from "../lore-workspace-split";

export type ResourceViewerKind =
  | "chapter"
  | "story"
  | "jingwei"
  | "storyline"
  | "jingwei-section"
  | "jingwei-entry"
  | "narrative-line"
  | "tool-result"
  | "narrative-memory-entry"
  | "file"
  | "image"
  | "generic";

export interface ResourceViewerRenderOptions {
  onContentChange?: (content: string) => void;
  onTabComplete?: (currentContent: string, cursorPosition: number) => Promise<string | null>;
  bookId?: string;
}

export interface ResourceViewerDefinition {
  kind: ResourceViewerKind;
  label: string;
  render: (node: WorkbenchResourceNode, options?: ResourceViewerRenderOptions) => ReactNode;
}

const editableLabels: Record<string, string> = {
  chapter: "章节正文",
};

function CapabilityNotice({ node }: { node: WorkbenchResourceNode }) {
  const unsupportedReason = typeof node.metadata?.unsupportedReason === "string"
    ? node.metadata.unsupportedReason
    : null;
  return (
    <div className="resource-viewer__capabilities flex flex-wrap items-center gap-1" aria-label="资源能力">
      {node.capabilities.readonly ? <span>只读资源</span> : null}
      {node.capabilities.unsupported ? <span title={unsupportedReason ?? undefined}>不支持的资源类型</span> : null}
      {node.capabilities.apply ? <span>可应用</span> : null}
    </div>
  );
}

function ViewerShell({ node, label, children }: { node: WorkbenchResourceNode; label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col h-full min-h-0" data-resource-kind={node.kind}>
      <header className="resource-viewer__header shrink-0 px-4 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{label}</span>
          <h2 className="text-sm font-medium truncate">{node.title}</h2>
          <CapabilityNotice node={node} />
        </div>
        {node.path ? (
          <div className="mt-1 text-[10px] text-muted-foreground">
            <span className="mr-1">来源路径：</span>
            <span>{node.path}</span>
          </div>
        ) : null}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {children}
      </div>
    </section>
  );
}


function renderChapterEditor(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;

  return (
    <ViewerShell node={node} label={resourceViewerRegistry[node.kind as ResourceViewerKind]?.label ?? "资源"}>
      <ChapterEditor
        content={node.content ?? ""}
        readonly={readonly}
        onContentChange={options.onContentChange}
        placeholder={`在此编辑${editableLabels[node.kind] ?? "内容"}…`}
        ariaLabel={editableLabels[node.kind] ?? "资源正文"}
        bookId={options.bookId}
      />
    </ViewerShell>
  );
}

/** Parse markdown into sections by ## headers for card-based rendering */
function parseJingweiSections(content: string): Array<{ title: string; body: string }> {
  const parts = content.split(/^## /m);
  // First part before any ## is preamble (e.g. # title), skip it
  return parts.slice(1).map((s) => {
    const [titleLine, ...bodyLines] = s.split("\n");
    return { title: titleLine.trim(), body: bodyLines.join("\n").trim() };
  });
}

function isUnfilledSection(body: string): boolean {
  if (!body.trim()) return true;
  return /\*\(待\s*(AI\s*生成|规划)\)\*/.test(body);
}

function JingweiCardView({ node, onContentChange }: { node: WorkbenchResourceNode; onContentChange?: (content: string) => void }) {
  const [editingRaw, setEditingRaw] = useState(false);
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const content = node.content ?? "";
  const sections = parseJingweiSections(content);

  if (editingRaw) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground">原始编辑模式</span>
          <Button size="sm" variant="outline" onClick={() => setEditingRaw(false)}>
            返回卡片视图
          </Button>
        </div>
        <Textarea
          aria-label="经纬资料原始编辑"
          value={content}
          rows={20}
          onChange={(e) => onContentChange?.(e.currentTarget.value)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => setEditingRaw(true)}>
          <Pencil className="size-3" />
          编辑源文件
        </Button>
      </div>
      {sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <p className="text-sm">暂无经纬内容</p>
        </div>
      ) : (
        sections.map((section, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">{section.title}</h3>
            {isUnfilledSection(section.body) ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>尚未填写</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  disabled={generatingSection !== null}
                  onClick={async () => {
                    setGeneratingSection(section.title);
                    setGenerationError(null);
                    try {
                      const res = await fetch("/api/ai/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt: `请为小说的"${section.title}"部分生成详细内容。要求具体、生动、可直接用于写作。输出纯文本，不要解释。`, maxTokens: 1000 }),
                      });
                      const data = await res.json() as { content?: string; error?: string };
                      if (!res.ok) throw new Error(data.error || `AI 生成失败（${res.status}）`);
                      if (!data.content?.trim()) throw new Error("AI 没有返回可用内容。");

                      // Replace placeholder with generated content
                      const updated = node.content?.replace(
                        new RegExp(`## ${section.title}\\n[\\s\\S]*?(?=\\n## |$)`),
                        `## ${section.title}\\n${data.content.trim()}\\n`,
                      );
                      if (updated && onContentChange) onContentChange(updated);
                    } catch (error) {
                      setGenerationError(error instanceof Error ? error.message : "AI 生成失败。");
                    } finally {
                      setGeneratingSection(null);
                    }
                  }}
                >
                  <Sparkles className="size-3" />
                  {generatingSection === section.title ? "生成中…" : "让 AI 生成"}
                </button>
              </div>
            ) : (
              <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{section.body}</div>
            )}
          </div>
        ))
      )}
      {generationError ? <p role="alert" className="text-xs text-destructive">{generationError}</p> : null}
    </div>
  );
}

function renderJingweiFile(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  return (
    <ViewerShell node={node} label="经纬资料">
      <JingweiCardView node={node} onContentChange={options.onContentChange} />
    </ViewerShell>
  );
}

const LAZY_MARKDOWN_PREVIEW_BYTES = 256 * 1024;

function utf8ByteLength(value: string): number {
  return typeof TextEncoder === "undefined" ? value.length : new TextEncoder().encode(value).byteLength;
}

function MarkdownResourceBody({
  node,
  onContentChange,
  bookId,
}: {
  node: WorkbenchResourceNode;
  onContentChange?: (content: string) => void;
  bookId?: string;
}) {
  const content = node.content ?? "";
  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;
  const isLarge = utf8ByteLength(content) > LAZY_MARKDOWN_PREVIEW_BYTES;
  const [previewLarge, setPreviewLarge] = useState(!isLarge);

  if (isLarge && !previewLarge) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-sm font-medium">这是一个较大的 Markdown 文件</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            为避免首次打开卡顿，当前先不建立完整编辑器文档。文件仍可读取；需要格式化预览时再加载。
          </p>
          <p className="text-[11px] text-muted-foreground">
            大小约 {Math.ceil(utf8ByteLength(content) / 1024)} KB，渲染阈值为 256 KB。
          </p>
          <Button type="button" size="sm" onClick={() => setPreviewLarge(true)}>
            加载 Markdown 预览
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ChapterEditor
      content={content}
      readonly={readonly}
      onContentChange={onContentChange}
      placeholder="Markdown 文件内容…"
      ariaLabel="Markdown 文件内容"
      showMinimap={false}
      bookId={bookId}
    />
  );
}

function renderTextFile(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  const isNarrativeMemory = node.metadata?.isNarrativeMemoryEntry === true;
  return (
    <ViewerShell node={node} label={isNarrativeMemory ? "叙事记忆" : "Markdown 文件"}>
      <MarkdownResourceBody node={node} onContentChange={options.onContentChange} bookId={options.bookId} />
    </ViewerShell>
  );
}

const MEMORY_EVENT_CATEGORY: Record<string, string> = {
  character_state_changed: "character_state",
  relationship_changed: "relationship",
  hook_planted: "hook",
  hook_triggered: "hook",
  hook_paid_off: "hook",
  timeline_advanced: "timeline",
  location_changed: "location",
  world_fact_changed: "world_fact",
  conflict_changed: "conflict",
};

function metadataText(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function renderNarrativeMemoryEntry(node: WorkbenchResourceNode) {
  const metadata = node.metadata ?? {};
  const eventType = metadataText(metadata, "eventType");
  const category = metadataText(metadata, "category")
    ?? metadataText(metadata, "displayCategory")
    ?? (eventType ? MEMORY_EVENT_CATEGORY[eventType] : undefined);
  const categoryLabel = category ? memoryFactLabel(category) : "叙事记忆";
  const entryKind = metadataText(metadata, "entryKind") ?? "memory";
  const detailError = metadataText(metadata, "detailError");
  const subject = metadataText(metadata, "subject");
  const predicate = metadataText(metadata, "predicate");
  const object = metadataText(metadata, "object");
  const evidence = metadataText(metadata, "evidenceText") ?? metadataText(metadata, "evidence");
  const summary = metadataText(metadata, "summary") ?? node.content;
  const fields = [
    ["分类", categoryLabel],
    ["类型", eventType ?? entryKind],
    ["状态", metadataText(metadata, "status")],
    ["章节", metadataNumber(metadata, "chapterNumber") ?? metadataNumber(metadata, "sourceChapter")],
    ["主体", subject],
    ["谓词", predicate],
    ["客体", object],
    ["层级", metadataText(metadata, "layer")],
    ["来源", metadataText(metadata, "sourceType") ?? metadataText(metadata, "source")],
    ["置信度", typeof metadata.confidence === "number" ? String(metadata.confidence) : undefined],
    ["风险", metadataText(metadata, "riskLevel")],
    ["有效起章", metadataNumber(metadata, "validFromChapter")],
    ["有效止章", metadataNumber(metadata, "validUntilChapter")],
    ["创建时间", metadataText(metadata, "createdAt")],
    ["应用时间", metadataText(metadata, "appliedAt")],
  ].filter(([, value]) => value !== undefined && value !== "");

  return (
    <ViewerShell node={node} label="叙事记忆详情">
      <div className="space-y-3 p-4">
        {detailError ? (
          <div role="alert" className="rounded border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-700 dark:text-yellow-300">
            详情补充失败，当前显示列表摘要：{detailError}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">{categoryLabel}</Badge>
          {metadataText(metadata, "status") ? <Badge variant="secondary" className="text-[10px]">{metadataText(metadata, "status")}</Badge> : null}
        </div>
        {fields.length > 0 ? (
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {fields.map(([label, value]) => (
              <div key={label} className="flex gap-3 px-3 py-2 text-xs">
                <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
                <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{String(value)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {summary ? (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-1 text-[10px] text-muted-foreground">摘要</div>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{summary}</div>
          </div>
        ) : null}
        {evidence ? (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-1 text-[10px] text-muted-foreground">正文证据</div>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{evidence}</div>
          </div>
        ) : null}
        {!summary && !evidence && fields.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">暂无详情数据</div> : null}
      </div>
    </ViewerShell>
  );
}

// ---------------------------------------------------------------------------
// Narrative Line structured viewer
// ---------------------------------------------------------------------------

interface NarrativeNodeData {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly chapterNumber?: number;
  readonly status?: string;
}

interface NarrativeEdgeData {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly type: string;
  readonly label?: string;
  readonly confidence: string;
}

interface NarrativeWarningData {
  readonly type: string;
  readonly severity: string;
  readonly summary: string;
}

interface NarrativeSnapshotData {
  readonly nodes?: readonly NarrativeNodeData[];
  readonly edges?: readonly NarrativeEdgeData[];
  readonly warnings?: readonly NarrativeWarningData[];
  readonly lines?: readonly { readonly id: string; readonly title: string; readonly summary?: string; readonly nodeIds?: readonly string[] }[];
  readonly beats?: readonly { readonly id: string; readonly title: string; readonly summary?: string; readonly chapterNumber?: number }[];
  readonly conflictThreads?: readonly { readonly id: string; readonly title: string; readonly status: string }[];
  readonly foreshadowThreads?: readonly { readonly id: string; readonly title: string; readonly status: string; readonly dueChapter?: number }[];
}

const NODE_TYPE_LABELS: Record<string, string> = {
  chapter: "章节",
  event: "事件",
  conflict: "冲突",
  foreshadow: "伏笔",
  payoff: "回收",
  "character-arc": "角色弧",
  setting: "场景",
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-red-500/50 bg-red-50 dark:bg-red-950/20",
  warning: "border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20",
  info: "border-blue-500/50 bg-blue-50 dark:bg-blue-950/20",
};

function NarrativeLineView({ node, bookId }: { node: WorkbenchResourceNode; bookId?: string }) {
  const snapshot: NarrativeSnapshotData | null = node.metadata?.snapshot ?? null;

  // If we have plain string content but no structured snapshot, show as readable text
  if (!snapshot && typeof node.content === "string" && node.content.trim()) {
    // Try to parse as JSON snapshot
    let parsed: NarrativeSnapshotData | null = null;
    try {
      const obj = JSON.parse(node.content);
      if (obj && typeof obj === "object" && (obj.nodes || obj.edges || obj.lines)) {
        parsed = obj as NarrativeSnapshotData;
      }
    } catch { /* not JSON, show as text */ }

    if (parsed) {
      return <NarrativeLineStructuredView snapshot={parsed} bookId={bookId} />;
    }

    // Plain text content — show in a readable textarea
    return (
      <Textarea aria-label="叙事线内容" readOnly value={node.content} rows={12} onChange={() => undefined} />
    );
  }

  if (!snapshot) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
        <p className="text-sm">暂无叙事线数据</p>
        <p className="text-xs mt-1">通过 Agent 对话生成叙事线</p>
      </div>
    );
  }

  return <NarrativeLineStructuredView snapshot={snapshot} bookId={bookId} />;
}

function NarrativeLineStructuredView({ snapshot, bookId }: { snapshot: NarrativeSnapshotData; bookId?: string }) {
  const nodes = snapshot.nodes ?? [];
  const edges = snapshot.edges ?? [];
  const warnings = snapshot.warnings ?? [];
  const lines = snapshot.lines ?? [];
  const conflicts = snapshot.conflictThreads ?? [];
  const foreshadows = snapshot.foreshadowThreads ?? [];

  const [showAddForm, setShowAddForm] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addType, setAddType] = useState("event");
  const [addSummary, setAddSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleAddNode = async () => {
    if (!bookId || !addTitle.trim()) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const outcome = await submitNarrativeLineChange(bookId, {
        summary: `添加节点：${addTitle}`,
        nodes: [{ id: `node-${Date.now()}`, type: addType, title: addTitle, summary: addSummary || undefined }],
        reason: "用户手动添加",
      });
      setStatusMsg(outcome.applied ? `节点已添加${outcome.notice}` : outcome.message);
      if (outcome.applied) {
        setAddTitle("");
        setAddSummary("");
        setShowAddForm(false);
      }
    } catch (error) {
      setStatusMsg(error instanceof Error ? error.message : "网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteNode = async (nodeId: string, nodeTitle: string) => {
    if (!bookId) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      // 删除是独立意图：走 removeNodeIds，而不是提交一个 `_delete` 占位节点。
      const outcome = await submitNarrativeLineChange(bookId, {
        summary: `删除节点：${nodeTitle}`,
        removeNodeIds: [nodeId],
        reason: "用户手动删除",
      });
      setStatusMsg(outcome.applied ? `已删除「${nodeTitle}」${outcome.notice}` : outcome.message);
    } catch (error) {
      setStatusMsg(error instanceof Error ? error.message : "网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 p-4 overflow-y-auto max-h-[600px]">
      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">警告</h4>
          {warnings.map((w, i) => (
            <div key={i} className={`rounded border p-2 text-xs ${SEVERITY_STYLES[w.severity] ?? SEVERITY_STYLES.info}`}>
              <span className="font-medium">[{w.type}]</span> {w.summary}
            </div>
          ))}
        </div>
      )}

      {/* Narrative Lines */}
      {lines.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">叙事线 ({lines.length})</h4>
          {lines.map((line) => (
            <div key={line.id} className="rounded-lg border border-border bg-card p-3">
              <div className="text-sm font-medium">{line.title}</div>
              {line.summary && <div className="text-xs text-muted-foreground mt-0.5">{line.summary}</div>}
              {line.nodeIds && <div className="text-[10px] text-muted-foreground mt-1">包含 {line.nodeIds.length} 个节点</div>}
            </div>
          ))}
        </div>
      )}

      {/* Conflict Threads */}
      {conflicts.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">冲突线 ({conflicts.length})</h4>
          {conflicts.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded border border-border p-2 text-xs">
              <span className={`inline-block size-2 rounded-full ${c.status === "resolved" ? "bg-green-500" : c.status === "escalating" ? "bg-red-500" : "bg-yellow-500"}`} />
              <span className="font-medium">{c.title}</span>
              <span className="text-muted-foreground ml-auto">{c.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Foreshadow Threads */}
      {foreshadows.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">伏笔线 ({foreshadows.length})</h4>
          {foreshadows.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded border border-border p-2 text-xs">
              <span className={`inline-block size-2 rounded-full ${f.status === "paid-off" ? "bg-green-500" : f.status === "due" ? "bg-orange-500" : f.status === "abandoned" ? "bg-gray-400" : "bg-blue-500"}`} />
              <span className="font-medium">{f.title}</span>
              {f.dueChapter && <span className="text-muted-foreground">预计第{f.dueChapter}章</span>}
              <span className="text-muted-foreground ml-auto">{f.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Nodes */}
      {nodes.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">节点 ({nodes.length})</h4>
          <div className="grid gap-1.5">
            {nodes.slice(0, 50).map((n) => (
              <div key={n.id} className="rounded border border-border p-2 text-xs group">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">{NODE_TYPE_LABELS[n.type] ?? n.type}</span>
                  <span className="font-medium">{n.title}</span>
                  {n.chapterNumber != null && <span className="text-muted-foreground ml-auto mr-1">第{n.chapterNumber}章</span>}
                  {bookId && (
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive ml-auto"
                      onClick={() => void handleDeleteNode(n.id, n.title)}
                      disabled={submitting}
                      title={`删除节点 ${n.title}`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
                {n.summary && <div className="text-muted-foreground mt-0.5 line-clamp-2">{n.summary}</div>}
              </div>
            ))}
            {nodes.length > 50 && <div className="text-[10px] text-muted-foreground text-center">…还有 {nodes.length - 50} 个节点</div>}
          </div>
        </div>
      )}

      {/* Edges summary */}
      {edges.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">关系 ({edges.length})</h4>
          <p className="text-[10px] text-muted-foreground">
            {edges.length} 条关系连接（{[...new Set(edges.map(e => e.type))].join("、")}）
          </p>
        </div>
      )}

      {/* Add node form / action buttons */}
      {bookId && !showAddForm && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => setShowAddForm(true)} disabled={submitting}>
            <Plus className="size-3" />
            添加节点
          </Button>
        </div>
      )}

      {bookId && showAddForm && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              className="text-xs rounded border border-border bg-background px-2 py-1"
              aria-label="节点类型"
            >
              {Object.entries(NODE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Input
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="节点标题"
              className="text-xs h-7 flex-1"
            />
          </div>
          <Input
            value={addSummary}
            onChange={(e) => setAddSummary(e.target.value)}
            placeholder="摘要（可选）"
            className="text-xs h-7"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void handleAddNode()} disabled={submitting || !addTitle.trim()}>
              {submitting ? "提交中…" : "确认添加"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)} disabled={submitting}>
              取消
            </Button>
          </div>
        </div>
      )}

      {/* Status message */}
      {statusMsg && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{statusMsg}</p>
      )}

      {/* Agent hint */}
      <div className="rounded border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground">
        叙事线由写作管线自动维护，也可手动添加节点
      </div>
    </div>
  );
}

function renderNarrativeLine(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  return (
    <ViewerShell node={node} label="叙事线">
      <NarrativeLineView node={node} bookId={options.bookId} />
    </ViewerShell>
  );
}

// ---------------------------------------------------------------------------
// JingweiCardViewer — structured card rendering for jingwei-section/entry
// ---------------------------------------------------------------------------

const CATEGORY_COLOR_MAP: Record<string, string> = {
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  cyan: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  slate: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  stone: "bg-stone-100 text-stone-800 dark:bg-stone-900/30 dark:text-stone-300",
};

const VISIBILITY_LABELS: Record<string, string> = {
  global: "全局",
  tracked: "追踪",
  nested: "嵌套",
};

function JingweiCardViewer({ node }: { node: WorkbenchResourceNode }) {
  const [showRaw, setShowRaw] = useState(false);
  const meta = node.metadata ?? {};
  const fieldsJson = meta.fields_json as Record<string, unknown> | undefined;
  const categoryId = (meta.category as string) ?? (meta.categoryId as string) ?? "";
  const visibility = (meta.visibility as string) ?? "";
  const relatedEntries = (meta.relatedEntries as Array<{ id: string; title: string }>) ?? [];

  const schema: CategorySchema | undefined = CATEGORY_SCHEMAS.find(s => s.id === categoryId);
  const colorClass = schema ? (CATEGORY_COLOR_MAP[schema.color] ?? CATEGORY_COLOR_MAP.slate) : CATEGORY_COLOR_MAP.slate;

  // If no structured fields, fall back to markdown/text rendering
  if (!fieldsJson && !schema) {
    const content = node.content ?? JSON.stringify(meta.section ?? meta.entry ?? meta, null, 2);
    return (
      <div className="p-4">
        <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{content}</div>
      </div>
    );
  }

  // Render fields as key-value pairs
  const fields = fieldsJson ?? {};
  const fieldEntries = schema
    ? schema.fields.map(f => ({ key: f.key, label: f.label, value: fields[f.key] })).filter(f => f.value != null && f.value !== "")
    : Object.entries(fields).map(([key, value]) => ({ key, label: key, value }));

  if (showRaw) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground">原始数据</span>
          <Button size="sm" variant="outline" onClick={() => setShowRaw(false)}>返回卡片</Button>
        </div>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-96 whitespace-pre-wrap">
          {JSON.stringify({ category: categoryId, visibility, fields: fieldsJson ?? {}, relatedEntries }, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {/* Header: category badge + title + visibility */}
      <div className="flex items-center gap-2 flex-wrap">
        {schema && (
          <Badge variant="outline" className={`text-[10px] ${colorClass}`}>
            {schema.name}
          </Badge>
        )}
        <h3 className="text-sm font-semibold text-foreground flex-1">{node.title}</h3>
        {visibility && (
          <Badge variant="secondary" className="text-[10px]">
            {VISIBILITY_LABELS[visibility] ?? visibility}
          </Badge>
        )}
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setShowRaw(true)}>
          查看原始
        </Button>
      </div>

      {/* Fields as labeled key-value pairs */}
      {fieldEntries.length > 0 ? (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {fieldEntries.map((f) => (
            <div key={f.key} className="flex gap-3 px-3 py-2">
              <span className="text-xs text-muted-foreground shrink-0 w-20 pt-0.5">{f.label}</span>
              <span className="text-sm text-foreground flex-1 whitespace-pre-wrap break-words">
                {Array.isArray(f.value) ? (f.value as string[]).join("、") : String(f.value)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground py-4 text-center">暂无结构化字段数据</div>
      )}

      {/* Related entries */}
      {relatedEntries.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">关联条目</span>
          <div className="flex flex-wrap gap-1">
            {relatedEntries.map((entry) => (
              <Badge key={entry.id} variant="outline" className="text-[10px]">{entry.title}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Fallback: show content if available and no fields */}
      {fieldEntries.length === 0 && node.content && (
        <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed rounded-lg border border-border bg-card p-3">
          {node.content}
        </div>
      )}
    </div>
  );
}

function renderJingweiCard(node: WorkbenchResourceNode) {
  const label = node.kind === "jingwei-section" ? "经纬分区" : "经纬条目";
  return (
    <ViewerShell node={node} label={label}>
      <JingweiCardViewer node={node} />
    </ViewerShell>
  );
}

function renderReadonlySummary(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  if (node.kind === "narrative-line" || node.kind === "storyline") {
    return renderNarrativeLine(node, options);
  }
  const label = "经纬资料";
  const content = node.content ?? JSON.stringify(node.metadata?.snapshot ?? node.metadata?.section ?? node.metadata?.entry ?? node.metadata ?? {}, null, 2);
  return (
    <ViewerShell node={node} label={label}>
      <Textarea aria-label="只读内容" readOnly value={content} rows={12} onChange={() => undefined} />
    </ViewerShell>
  );
}

function renderImageFile(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  const rawUrl = options.bookId ? getImageRawUrl(options.bookId, node) : null;
  return (
    <ViewerShell node={node} label="图片预览">
      <div className="flex min-h-[420px] items-center justify-center bg-muted/30 p-4">
        {rawUrl ? (
          <img src={rawUrl} alt={node.title} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="text-sm text-muted-foreground">缺少书籍 ID，无法预览图片</div>
        )}
      </div>
    </ViewerShell>
  );
}

function renderGeneric(node: WorkbenchResourceNode) {
  const unsupportedReason = typeof node.metadata?.unsupportedReason === "string"
    ? node.metadata.unsupportedReason
    : "当前查看器没有为这个资源类型提供安全的读取与编辑能力。";
  return (
    <ViewerShell node={node} label="通用资源">
      <div className="flex flex-col gap-3 p-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">当前文件不能在工作台内直接打开</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{unsupportedReason}</p>
          <p className="mt-2 text-xs text-muted-foreground/70">类型：{node.kind}</p>
          {node.path ? <p className="mt-1 break-all text-xs text-muted-foreground/70">路径：{node.path}</p> : null}
        </div>
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">查看原始资源信息</summary>
          <pre data-testid="raw-resource-node" className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {JSON.stringify(node, null, 2)}
          </pre>
        </details>
      </div>
    </ViewerShell>
  );
}

function renderToolResult(node: WorkbenchResourceNode) {
  return (
    <ViewerShell node={node} label="工具结果">
      <pre data-testid="raw-resource-node">{node.content ?? JSON.stringify(node.metadata ?? {}, null, 2)}</pre>
    </ViewerShell>
  );
}

export const resourceViewerRegistry: Record<ResourceViewerKind, ResourceViewerDefinition> = {
  chapter: { kind: "chapter", label: "章节", render: renderChapterEditor },
  story: { kind: "story", label: "Story 文件", render: renderTextFile },
  jingwei: { kind: "jingwei", label: "经纬资料", render: renderJingweiFile },
  storyline: { kind: "storyline", label: "叙事线", render: renderReadonlySummary },
  "jingwei-section": { kind: "jingwei-section", label: "经纬分区", render: renderJingweiCard },
  "jingwei-entry": { kind: "jingwei-entry", label: "经纬条目", render: renderJingweiCard },
  "narrative-line": { kind: "narrative-line", label: "叙事线", render: renderReadonlySummary },
  "narrative-memory-entry": { kind: "narrative-memory-entry", label: "叙事记忆详情", render: renderNarrativeMemoryEntry },
  "tool-result": { kind: "tool-result", label: "工具结果", render: renderToolResult },
  file: { kind: "file", label: "文本文件", render: renderTextFile },
  image: { kind: "image", label: "图片预览", render: renderImageFile },
  generic: { kind: "generic", label: "通用资源", render: renderGeneric },
};

const viewerKinds = new Set<WorkbenchResourceKind | ResourceViewerKind>([
  "chapter",
  "story",
  "jingwei",
  "storyline",
  "jingwei-section",
  "jingwei-entry",
  "narrative-line",
  "tool-result",
  "file",
]);

export function getResourceViewer(node: WorkbenchResourceNode): ResourceViewerDefinition {
  if (node.metadata?.isNarrativeMemoryEntry === true) {
    return resourceViewerRegistry["narrative-memory-entry"];
  }
  if (node.capabilities.unsupported) {
    return resourceViewerRegistry.generic;
  }
  if (isImageResourceNode(node)) {
    return resourceViewerRegistry.image;
  }
  if (!viewerKinds.has(node.kind)) {
    return resourceViewerRegistry.generic;
  }

  return resourceViewerRegistry[node.kind as ResourceViewerKind] ?? resourceViewerRegistry.generic;
}

export function ResourceViewer({ node, onContentChange, onTabComplete, bookId }: { node: WorkbenchResourceNode; onContentChange?: (content: string) => void; onTabComplete?: ResourceViewerRenderOptions["onTabComplete"]; bookId?: string }) {
  return <>{getResourceViewer(node).render(node, { onContentChange, onTabComplete, bookId })}</>;
}
