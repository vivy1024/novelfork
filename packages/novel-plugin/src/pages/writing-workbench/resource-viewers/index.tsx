import { useState, useCallback, type ReactNode } from "react";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Pencil } from "lucide-react";
import type { WorkbenchResourceKind, WorkbenchResourceNode } from "../useWorkbenchResources";
import { CATEGORY_SCHEMAS, type CategorySchema } from "../jingwei/category-schemas";
import { ChapterEditor } from "./ChapterEditor";

export type ResourceViewerKind =
  | "chapter"
  | "candidate"
  | "draft"
  | "story"
  | "jingwei"
  | "bible-entry"
  | "storyline"
  | "jingwei-section"
  | "jingwei-entry"
  | "narrative-line"
  | "tool-result"
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
  candidate: "候选稿正文",
  draft: "草稿正文",
};

function CapabilityNotice({ node }: { node: WorkbenchResourceNode }) {
  return (
    <div className="resource-viewer__capabilities" aria-label="资源能力">
      {node.capabilities.readonly ? <span>只读资源</span> : null}
      {node.capabilities.unsupported ? <span>不支持的资源类型</span> : null}
      {node.capabilities.apply ? <span>可应用</span> : null}
    </div>
  );
}

function ViewerShell({ node, label, children }: { node: WorkbenchResourceNode; label: string; children: ReactNode }) {
  return (
    <section className="resource-viewer" data-resource-kind={node.kind}>
      <header className="resource-viewer__header">
        <p>{label}</p>
        <h2>{node.title}</h2>
        <CapabilityNotice node={node} />
      </header>
      {children}
    </section>
  );
}

function TextBody({ node, label, onContentChange, onTabComplete, bookId }: { node: WorkbenchResourceNode; label: string; onContentChange?: (content: string) => void; onTabComplete?: ResourceViewerRenderOptions["onTabComplete"]; bookId?: string }) {
  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;
  const [completing, setCompleting] = useState(false);
  const [selection, setSelection] = useState<{ text: string; start: number; end: number } | null>(null);
  const [inlineWriting, setInlineWriting] = useState(false);

  const handleKeyDown = useCallback(async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.shiftKey || !onTabComplete || readonly || completing) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const cursorPos = textarea.selectionStart;
    const content = textarea.value;

    setCompleting(true);
    try {
      const completion = await onTabComplete(content, cursorPos);
      if (completion) {
        const before = content.slice(0, cursorPos);
        const after = content.slice(cursorPos);
        const newContent = before + completion + after;
        onContentChange?.(newContent);
        // Move cursor to end of completion
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = cursorPos + completion.length;
        });
      }
    } finally {
      setCompleting(false);
    }
  }, [onTabComplete, readonly, completing, onContentChange]);

  const handleSelect = useCallback((event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (end > start) {
      setSelection({ text: textarea.value.slice(start, end), start, end });
    } else {
      setSelection(null);
    }
  }, []);

  const handleInlineWrite = useCallback(async (mode: "continue" | "expand" | "rewrite" | "variants") => {
    if (!selection || !bookId) return;
    setInlineWriting(true);
    // Map frontend mode names to backend API mode names
    const API_MODE_MAP: Record<string, string> = { continue: "continuation", expand: "expansion", rewrite: "expansion", variants: "bridge" };
    const apiMode = API_MODE_MAP[mode] ?? "continuation";
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/inline-write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: apiMode, selectedText: selection.text, context: node.content ?? "", position: selection.start }),
      });
      if (!res.ok) return;
      const data = await res.json() as { result?: string; content?: string };
      const generatedText = data.result ?? data.content;
      if (generatedText && onContentChange) {
        const content = node.content ?? "";
        const newContent = mode === "continue"
          ? content.slice(0, selection.end) + generatedText + content.slice(selection.end)
          : content.slice(0, selection.start) + generatedText + content.slice(selection.end);
        onContentChange(newContent);
      }
    } finally {
      setInlineWriting(false);
      setSelection(null);
    }
  }, [selection, bookId, node.content, onContentChange]);

  return (
    <div className="relative">
      <Textarea aria-label={label} readOnly={readonly} value={node.content ?? ""} rows={18} onChange={(event) => onContentChange?.(event.currentTarget.value)} onKeyDown={(e) => void handleKeyDown(e)} onSelect={handleSelect} onBlur={() => setTimeout(() => setSelection(null), 200)} />
      {completing && (
        <span className="absolute bottom-2 right-2 text-[10px] text-muted-foreground animate-pulse">续写中…</span>
      )}
      {inlineWriting && (
        <span className="absolute bottom-2 right-2 text-[10px] text-muted-foreground animate-pulse">生成中…</span>
      )}
      {/* Selection floating toolbar */}
      {selection && !readonly && bookId && (
        <div className="absolute top-0 right-0 z-10 flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 shadow-md" data-testid="selection-toolbar">
          <button type="button" className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted" onClick={() => void handleInlineWrite("continue")} disabled={inlineWriting}>续写</button>
          <button type="button" className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted" onClick={() => void handleInlineWrite("expand")} disabled={inlineWriting}>扩写</button>
          <button type="button" className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted" onClick={() => void handleInlineWrite("rewrite")} disabled={inlineWriting}>改写</button>
          <button type="button" className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted" onClick={() => void handleInlineWrite("variants")} disabled={inlineWriting}>多版本</button>
        </div>
      )}
    </div>
  );
}

function renderEditableText(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  const label = editableLabels[node.kind] ?? "资源正文";
  return (
    <ViewerShell node={node} label={resourceViewerRegistry[node.kind as ResourceViewerKind]?.label ?? "资源"}>
      <TextBody node={node} label={label} onContentChange={options.onContentChange} onTabComplete={options.onTabComplete} bookId={options.bookId} />
    </ViewerShell>
  );
}

function renderChapterEditor(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;
  const bookId = options.bookId;

  const handleInlineWrite = bookId
    ? async (mode: "continue" | "expand" | "rewrite" | "variants", selectedText: string, start: number, end: number) => {
        const API_MODE_MAP: Record<string, string> = { continue: "continuation", expand: "expansion", rewrite: "expansion", variants: "bridge" };
        const apiMode = API_MODE_MAP[mode] ?? "continuation";
        try {
          const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/inline-write`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: apiMode, selectedText, context: node.content ?? "", position: start }),
          });
          if (!res.ok) return;
          const data = await res.json() as { result?: string; content?: string };
          const generatedText = data.result ?? data.content;
          if (generatedText && options.onContentChange) {
            const content = node.content ?? "";
            const newContent = mode === "continue"
              ? content.slice(0, end) + generatedText + content.slice(end)
              : content.slice(0, start) + generatedText + content.slice(end);
            options.onContentChange(newContent);
          }
        } catch { /* non-fatal */ }
      }
    : undefined;

  return (
    <ViewerShell node={node} label={resourceViewerRegistry[node.kind as ResourceViewerKind]?.label ?? "资源"}>
      <ChapterEditor
        content={node.content ?? ""}
        readonly={readonly}
        onContentChange={options.onContentChange}
        onInlineWrite={handleInlineWrite}
        placeholder={`在此编辑${editableLabels[node.kind] ?? "内容"}…`}
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
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/ai-relay/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt: `请为小说的"${section.title}"部分生成详细内容。要求具体、生动、可直接用于写作。输出纯文本，不要解释。`, maxTokens: 1000 }),
                      });
                      if (res.ok) {
                        const data = await res.json() as { content?: string };
                        if (data.content) {
                          // Replace placeholder with generated content
                          const updated = node.content?.replace(
                            new RegExp(`## ${section.title}\\n[\\s\\S]*?(?=\\n## |$)`),
                            `## ${section.title}\n${data.content}\n`,
                          );
                          if (updated && onContentChange) onContentChange(updated);
                        }
                      }
                    } catch { /* non-fatal */ }
                  }}
                >
                  <Sparkles className="size-3" />
                  让 AI 生成
                </button>
              </div>
            ) : (
              <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{section.body}</div>
            )}
          </div>
        ))
      )}
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

function renderTextFile(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  return (
    <ViewerShell node={node} label="Story 文本文件">
      <TextBody node={node} label="文本文件正文" onContentChange={options.onContentChange} onTabComplete={options.onTabComplete} bookId={options.bookId} />
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

function NarrativeLineView({ node }: { node: WorkbenchResourceNode }) {
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
      return <NarrativeLineStructuredView snapshot={parsed} />;
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

  return <NarrativeLineStructuredView snapshot={snapshot} />;
}

function NarrativeLineStructuredView({ snapshot }: { snapshot: NarrativeSnapshotData }) {
  const nodes = snapshot.nodes ?? [];
  const edges = snapshot.edges ?? [];
  const warnings = snapshot.warnings ?? [];
  const lines = snapshot.lines ?? [];
  const conflicts = snapshot.conflictThreads ?? [];
  const foreshadows = snapshot.foreshadowThreads ?? [];

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
              <div key={n.id} className="rounded border border-border p-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">{NODE_TYPE_LABELS[n.type] ?? n.type}</span>
                  <span className="font-medium">{n.title}</span>
                  {n.chapterNumber != null && <span className="text-muted-foreground ml-auto">第{n.chapterNumber}章</span>}
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

      {/* Agent hint */}
      <div className="rounded border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground">
        通过 Agent 对话编辑叙事线 · 叙事线由写作管线自动维护
      </div>
    </div>
  );
}

function renderNarrativeLine(node: WorkbenchResourceNode) {
  return (
    <ViewerShell node={node} label="叙事线">
      <NarrativeLineView node={node} />
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

function renderReadonlySummary(node: WorkbenchResourceNode) {
  if (node.kind === "narrative-line" || node.kind === "storyline") {
    return renderNarrativeLine(node);
  }
  const label = "经纬资料";
  const content = node.content ?? JSON.stringify(node.metadata?.snapshot ?? node.metadata?.section ?? node.metadata?.entry ?? node.metadata ?? {}, null, 2);
  return (
    <ViewerShell node={node} label={label}>
      <Textarea aria-label="只读内容" readOnly value={content} rows={12} onChange={() => undefined} />
    </ViewerShell>
  );
}

function renderGeneric(node: WorkbenchResourceNode) {
  return (
    <ViewerShell node={node} label="资源">
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-muted-foreground">此资源类型暂不支持直接编辑</p>
        <p className="text-xs text-muted-foreground/60 mt-1">类型：{node.kind}</p>
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

function renderCandidateText(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  // 候选稿默认只读展示，操作通过 CandidateActionsBar 完成
  const readonly = true;
  return (
    <ViewerShell node={node} label="候选稿">
      <Textarea
        aria-label="候选稿正文"
        readOnly={readonly}
        value={node.content ?? ""}
        rows={18}
        onChange={(event) => options.onContentChange?.(event.currentTarget.value)}
      />
    </ViewerShell>
  );
}

export const resourceViewerRegistry: Record<ResourceViewerKind, ResourceViewerDefinition> = {
  chapter: { kind: "chapter", label: "章节", render: renderChapterEditor },
  candidate: { kind: "candidate", label: "候选稿", render: renderCandidateText },
  draft: { kind: "draft", label: "草稿", render: renderChapterEditor },
  story: { kind: "story", label: "Story 文件", render: renderTextFile },
  jingwei: { kind: "jingwei", label: "经纬资料", render: renderJingweiFile },
  "bible-entry": { kind: "bible-entry", label: "经纬资料", render: renderReadonlySummary },
  storyline: { kind: "storyline", label: "叙事线", render: renderReadonlySummary },
  "jingwei-section": { kind: "jingwei-section", label: "经纬分区", render: renderJingweiCard },
  "jingwei-entry": { kind: "jingwei-entry", label: "经纬条目", render: renderJingweiCard },
  "narrative-line": { kind: "narrative-line", label: "叙事线", render: renderReadonlySummary },
  "tool-result": { kind: "tool-result", label: "工具结果", render: renderToolResult },
  generic: { kind: "generic", label: "通用资源", render: renderGeneric },
};

const viewerKinds = new Set<WorkbenchResourceKind | ResourceViewerKind>([
  "chapter",
  "candidate",
  "draft",
  "story",
  "jingwei",
  "bible-entry",
  "storyline",
  "jingwei-section",
  "jingwei-entry",
  "narrative-line",
  "tool-result",
]);

export function getResourceViewer(node: WorkbenchResourceNode): ResourceViewerDefinition {
  if (!viewerKinds.has(node.kind) || node.capabilities.unsupported) {
    return resourceViewerRegistry.generic;
  }

  return resourceViewerRegistry[node.kind as ResourceViewerKind] ?? resourceViewerRegistry.generic;
}

export function ResourceViewer({ node, onContentChange, onTabComplete, bookId }: { node: WorkbenchResourceNode; onContentChange?: (content: string) => void; onTabComplete?: ResourceViewerRenderOptions["onTabComplete"]; bookId?: string }) {
  return <>{getResourceViewer(node).render(node, { onContentChange, onTabComplete, bookId })}</>;
}
