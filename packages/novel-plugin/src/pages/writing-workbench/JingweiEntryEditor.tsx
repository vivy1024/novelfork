import { useState, useEffect, useRef } from "react";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Save, Trash2, Loader2, FileText, Link2, History, Eye, Pencil, RotateCcw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────

export type JingweiPriorityTier = "auto" | "core" | "relevant" | "reference";

export interface JingweiEntryData {
  id: string;
  title: string;
  contentMd: string;
  sectionId?: string;
  updatedAt?: string;
  priorityTier?: JingweiPriorityTier;
  category?: string;
  fields?: Record<string, unknown>;
  status?: string;
  layer?: string;
  version?: number;
  relatedEntryIds?: string[];
  /** @deprecated 历史 Tab 只读取 jingwei_revision API。 */
  revisionHistory?: JingweiRevision[];
  conflictStatus?: "none" | "pending" | "resolved";
  conflictDetail?: string;
}

export interface JingweiRevision {
  timestamp: string;
  source: string;
  changedFields: string[];
  previousSnapshot?: string;
}

export interface RelatedEntryItem {
  id: string;
  title: string;
}

interface RevisionRecord {
  id: string;
  content_md: string;
  category?: string | null;
  layer?: string | null;
  snapshot?: {
    title?: string;
    contentMd?: string;
    priorityTier?: JingweiPriorityTier;
    fields?: Record<string, unknown>;
    status?: string;
    layer?: string;
    version?: number;
  } | null;
  reason?: string | null;
  changed_by: string;
  created_at: number;
}

export interface JingweiEntryEditorProps {
  entry: JingweiEntryData;
  bookId?: string;
  sectionLabel?: string;
  sourceLabel?: string;
  onSave: (entryId: string, payload: { title: string; contentMd: string; priorityTier?: JingweiPriorityTier }) => Promise<void>;
  onDelete?: (entryId: string) => Promise<void>;
  /** 关联条目列表（由父组件解析 ID → 标题后传入） */
  relatedEntries?: RelatedEntryItem[];
  /** 点击关联条目时跳转到目标条目 */
  onNavigateToEntry?: (entryId: string) => void;
}

// ─── Source label helper ──────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  user: "手动编辑",
  "agent-write": "AI 写作",
  "auto-settle": "自动整理",
  "system-init": "系统初始化",
  "ai-enrich": "AI 丰富",
};

function sourceBadgeVariant(src: string): "default" | "secondary" | "outline" {
  if (src === "user") return "default";
  if (src.startsWith("agent") || src.startsWith("ai")) return "secondary";
  return "outline";
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export function JingweiEntryEditor({
  entry,
  bookId,
  sectionLabel,
  sourceLabel = "经纬资料",
  onSave,
  onDelete,
  relatedEntries,
  onNavigateToEntry,
}: JingweiEntryEditorProps) {
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.contentMd);
  const [priorityTier, setPriorityTier] = useState<JingweiPriorityTier>(entry.priorityTier ?? "auto");
  const [savedTitle, setSavedTitle] = useState(entry.title);
  const [savedContent, setSavedContent] = useState(entry.contentMd);
  const [savedPriorityTier, setSavedPriorityTier] = useState<JingweiPriorityTier>(entry.priorityTier ?? "auto");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "relations" | "history">("details");
  const [previewMode, setPreviewMode] = useState(false);
  const [revisionRecords, setRevisionRecords] = useState<RevisionRecord[]>([]);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [resolvedRelatedEntries, setResolvedRelatedEntries] = useState<RelatedEntryItem[]>([]);
  const [conflictStatus, setConflictStatus] = useState(entry.conflictStatus ?? "none");
  const [conflictDetail, setConflictDetail] = useState(entry.conflictDetail);
  const [revertingRevisionId, setRevertingRevisionId] = useState<string | null>(null);

  const dirty = title !== savedTitle || content !== savedContent || priorityTier !== savedPriorityTier;
  const relationItems = relatedEntries && relatedEntries.length > 0 ? relatedEntries : resolvedRelatedEntries;
  const historyCount = revisionRecords.length;
  const relatedEntryIdsKey = (entry.relatedEntryIds ?? []).join("\u0000");
  const relatedEntriesKey = (relatedEntries ?? []).map((item) => `${item.id}\u0000${item.title}`).join("\u0001");

  // ── TipTap editor ─────────────────────────────────────────────────────

  const isExternalUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: { depth: 100 },
      }),
      Placeholder.configure({
        placeholder: "在此编辑经纬资料内容…",
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: content || "",
    editable: !previewMode,
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return;
      const md = ed.storage.markdown.getMarkdown() as string;
      setContent(md);
    },
  });

  // Sync preview mode → editable
  useEffect(() => {
    if (editor) {
      editor.setEditable(!previewMode);
    }
  }, [editor, previewMode]);

  // Sync external content changes (e.g. entry prop change)
  useEffect(() => {
    if (!editor) return;
    const currentMd = editor.storage.markdown.getMarkdown() as string;
    if (content !== currentMd) {
      isExternalUpdate.current = true;
      editor.commands.setContent(content || "");
      isExternalUpdate.current = false;
    }
  }, [editor, content]);

  // Sync entry prop changes (switching to a different entry)
  useEffect(() => {
    setTitle(entry.title);
    setContent(entry.contentMd);
    setPriorityTier(entry.priorityTier ?? "auto");
    setSavedTitle(entry.title);
    setSavedContent(entry.contentMd);
    setSavedPriorityTier(entry.priorityTier ?? "auto");
    setPreviewMode(false);
    setConfirmDelete(false);
    setError(null);
    setActiveTab("details");
    setConflictStatus(entry.conflictStatus ?? "none");
    setConflictDetail(entry.conflictDetail);
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRevisions(): Promise<void> {
    if (!bookId) {
      setRevisionRecords([]);
      return;
    }
    setRevisionLoading(true);
    setRevisionError(null);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/revisions`);
      if (!response.ok) throw new Error(`历史加载失败（${response.status}）`);
      const data = await response.json() as { revisions?: RevisionRecord[] };
      setRevisionRecords(Array.isArray(data.revisions) ? data.revisions : []);
    } catch (cause) {
      setRevisionRecords([]);
      setRevisionError(cause instanceof Error ? cause.message : "历史加载失败");
    } finally {
      setRevisionLoading(false);
    }
  }

  useEffect(() => {
    if (!bookId) {
      setRevisionRecords([]);
      setRevisionError(null);
      setResolvedRelatedEntries(relatedEntries ?? []);
      return;
    }
    let cancelled = false;
    void loadRevisions();
    const base = `/api/books/${encodeURIComponent(bookId)}/jingwei`;
    void fetch(`${base}/entries`)
      .then((response) => response.ok ? response.json() : { entries: [] })
      .catch(() => ({ entries: [] }))
      .then((entriesData) => {
        if (cancelled) return;
        const allEntries = Array.isArray(entriesData?.entries) ? entriesData.entries as Array<Record<string, unknown>> : [];
        const current = allEntries.find((candidate) => String(candidate.id ?? "") === entry.id);
        const relatedIds = entry.relatedEntryIds ?? parseStringArray(current?.relatedEntryIds ?? current?.related_entry_ids_json);
        const byId = new Map(allEntries.map((candidate) => [String(candidate.id ?? ""), String(candidate.title ?? "未命名条目")]));
        setResolvedRelatedEntries(
          relatedIds
            .filter((id) => id !== entry.id)
            .map((id) => ({ id, title: byId.get(id) ?? id })),
        );
        setConflictStatus((current?.conflictStatus ?? current?.conflict_status ?? entry.conflictStatus ?? "none") as "none" | "pending" | "resolved");
        const nextConflictDetail = current?.conflictDetail ?? current?.conflict_detail ?? entry.conflictDetail;
        setConflictDetail(typeof nextConflictDetail === "string" ? nextConflictDetail : undefined);
      });
    return () => { cancelled = true; };
    // loadRevisions is intentionally scoped to the active entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, entry.id, relatedEntryIdsKey, entry.conflictStatus, entry.conflictDetail, relatedEntriesKey]);

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(entry.id, { title: title.trim(), contentMd: content, priorityTier });
      setSavedTitle(title.trim());
      setSavedContent(content);
      setSavedPriorityTier(priorityTier);
      await loadRevisions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(entry.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleRevert(revision: RevisionRecord) {
    if (!bookId || revertingRevisionId) return;
    setRevertingRevisionId(revision.id);
    setError(null);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: revision.id }),
      });
      if (!response.ok) throw new Error("回滚失败");
      const data = await response.json() as { entry?: JingweiEntryData };
      const restored = data.entry;
      const restoredTitle = restored?.title ?? revision.snapshot?.title ?? title;
      const restoredContent = restored?.contentMd ?? revision.snapshot?.contentMd ?? revision.content_md;
      const restoredPriority = restored?.priorityTier ?? revision.snapshot?.priorityTier ?? priorityTier;
      setTitle(restoredTitle);
      setContent(restoredContent);
      setPriorityTier(restoredPriority);
      setSavedTitle(restoredTitle);
      setSavedContent(restoredContent);
      setSavedPriorityTier(restoredPriority);
      setConflictStatus(restored?.conflictStatus ?? "none");
      setConflictDetail(restored?.conflictDetail);
      await loadRevisions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回滚失败");
    } finally {
      setRevertingRevisionId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <section className="resource-viewer" data-resource-kind="jingwei-entry" data-testid="jingwei-entry-editor">
      <header className="resource-viewer__header flex items-center gap-2 mb-3">
        <p className="text-xs text-muted-foreground">{sourceLabel}</p>
        {sectionLabel && <Badge variant="secondary" className="text-[10px]">{sectionLabel}</Badge>}
        {entry.updatedAt && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            更新于 {new Date(entry.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </header>
      {conflictStatus === "pending" && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" role="alert">
          <strong>存在协同修改冲突。</strong>{conflictDetail ? ` ${conflictDetail}` : " 请确认当前内容是否应保留。"}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-1 mb-3 border-b border-border pb-2">
        <Button variant={activeTab === "details" ? "default" : "ghost"} size="xs" onClick={() => setActiveTab("details")}>
          <FileText className="size-3 mr-1" />详情
        </Button>
        <Button variant={activeTab === "relations" ? "default" : "ghost"} size="xs" onClick={() => setActiveTab("relations")}>
          <Link2 className="size-3 mr-1" />关联
          {relationItems.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0">{relationItems.length}</Badge>
          )}
        </Button>
        <Button variant={activeTab === "history" ? "default" : "ghost"} size="xs" onClick={() => setActiveTab("history")}>
          <History className="size-3 mr-1" />历史
          {historyCount > 0 && (
            <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0">{historyCount}</Badge>
          )}
        </Button>
      </div>

      {/* ─── Tab: 关联 ──────────────────────────────────────────────── */}
      {activeTab === "relations" && (
        <div className="py-4 px-1">
          {relationItems.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {relationItems.map((re) => (
                <button
                  key={re.id}
                  type="button"
                  onClick={() => onNavigateToEntry?.(re.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                             bg-secondary text-secondary-foreground hover:bg-secondary/80
                             transition-colors cursor-pointer border border-border"
                  title={`跳转到「${re.title}」`}
                >
                  <Link2 className="size-3 opacity-60" />
                  {re.title}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Link2 className="size-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">暂无关联条目</p>
              <p className="text-xs mt-1">用于静态设定条目之间的引用跳转；剧情关系变化请在叙事记忆中查看</p>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: 历史 ──────────────────────────────────────────────── */}
      {activeTab === "history" && (
        <div className="py-4 px-1">
          {revisionLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />正在加载修改历史…
            </div>
          ) : revisionError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
              {revisionError}
            </div>
          ) : revisionRecords.length > 0 ? (
            <div className="relative pl-4">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
              <div className="space-y-3">
                {revisionRecords.map((revision) => (
                  <div key={revision.id} className="relative flex items-start gap-3">
                    <div className="absolute -left-4 top-1.5 w-[7px] h-[7px] rounded-full bg-primary ring-2 ring-background" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {new Date(revision.created_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <Badge variant={sourceBadgeVariant(revision.changed_by)} className="text-[10px] px-1.5 py-0">
                          {SOURCE_LABELS[revision.changed_by] ?? revision.changed_by}
                        </Badge>
                        {revision.reason && <span className="text-[11px] text-muted-foreground truncate">{revision.reason}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">可恢复正文版本{revision.category ? ` · 分类 ${revision.category}` : ""}{revision.layer ? ` · ${revision.layer}` : ""}</p>
                    </div>
                    <Button size="xs" variant="ghost" disabled={revertingRevisionId !== null} onClick={() => void handleRevert(revision)} title="回滚到此版本">
                      {revertingRevisionId === revision.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <History className="size-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">暂无修改记录</p>
              <p className="text-xs mt-1">条目被修改后，修改历史将在此展示</p>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: 详情 ──────────────────────────────────────────────── */}
      {activeTab === "details" && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">标题</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="条目标题（如：角色名、地点名）"
              className="text-sm"
            />
          </div>

          {/* 内容编辑 — TipTap 富文本 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted-foreground">内容</label>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setPreviewMode((v) => !v)}
                title={previewMode ? "切换到编辑模式" : "切换到预览模式"}
              >
                {previewMode
                  ? <><Pencil className="size-3 mr-1" />编辑</>
                  : <><Eye className="size-3 mr-1" />预览</>
                }
              </Button>
            </div>

            <div
              className={`rounded-md border border-input bg-background text-sm
                ${previewMode ? "prose prose-sm dark:prose-invert max-w-none p-3 min-h-[200px]" : ""}`}
            >
              <EditorContent
                editor={editor}
                className="jingwei-entry-editor__tiptap"
              />
            </div>
          </div>

          {/* 优先级层级 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">上下文优先级</label>
            <Select value={priorityTier} onValueChange={(value) => setPriorityTier(value as JingweiPriorityTier)}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="选择优先级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动（按规则推断）</SelectItem>
                <SelectItem value="core">核心（始终注入）</SelectItem>
                <SelectItem value="relevant">相关（按匹配注入）</SelectItem>
                <SelectItem value="reference">参考（仅 full 模式）</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-muted-foreground">核心条目始终被 Agent 看到；参考条目仅在 full 模式下注入。</p>
          </div>

          {/* 操作栏 */}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Save className="size-3.5 mr-1" />}
              保存
            </Button>

            {dirty && <Badge className="text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/20">未保存</Badge>}

            <span className="flex-1" />

            {error && <span className="text-xs text-destructive">{error}</span>}

            {onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-destructive">确认删除？</span>
                  <Button size="xs" variant="destructive" disabled={deleting} onClick={handleDelete}>
                    {deleting ? <Loader2 className="size-3 animate-spin" /> : "确认"}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button>
                </div>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(true)} title="删除此条目">
                  <Trash2 className="size-3.5" />
                </Button>
              )
            )}
          </div>
        </div>
      )}
    </section>
  );
}
