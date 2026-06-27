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
  Save, Trash2, Loader2, FileText, Link2, History, Eye, Pencil,
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
  relatedEntryIds?: string[];
  revisionHistory?: JingweiRevision[];
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

export interface JingweiEntryEditorProps {
  entry: JingweiEntryData;
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

// ─── Component ────────────────────────────────────────────────────────────

export function JingweiEntryEditor({
  entry,
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "relations" | "history">("details");
  const [previewMode, setPreviewMode] = useState(false);

  const dirty = title !== entry.title || content !== entry.contentMd || priorityTier !== (entry.priorityTier ?? "auto");

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
    setPreviewMode(false);
    setConfirmDelete(false);
    setError(null);
    setActiveTab("details");
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(entry.id, { title: title.trim(), contentMd: content, priorityTier });
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

      {/* Tab 切换 */}
      <div className="flex gap-1 mb-3 border-b border-border pb-2">
        <Button variant={activeTab === "details" ? "default" : "ghost"} size="xs" onClick={() => setActiveTab("details")}>
          <FileText className="size-3 mr-1" />详情
        </Button>
        <Button variant={activeTab === "relations" ? "default" : "ghost"} size="xs" onClick={() => setActiveTab("relations")}>
          <Link2 className="size-3 mr-1" />关联
          {entry.relatedEntryIds && entry.relatedEntryIds.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0">{entry.relatedEntryIds.length}</Badge>
          )}
        </Button>
        <Button variant={activeTab === "history" ? "default" : "ghost"} size="xs" onClick={() => setActiveTab("history")}>
          <History className="size-3 mr-1" />历史
          {entry.revisionHistory && entry.revisionHistory.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0">{entry.revisionHistory.length}</Badge>
          )}
        </Button>
      </div>

      {/* ─── Tab: 关联 ──────────────────────────────────────────────── */}
      {activeTab === "relations" && (
        <div className="py-4 px-1">
          {relatedEntries && relatedEntries.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {relatedEntries.map((re) => (
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
          {entry.revisionHistory && entry.revisionHistory.length > 0 ? (
            <div className="relative pl-4">
              {/* 时间线竖线 */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
              <div className="space-y-3">
                {[...entry.revisionHistory].reverse().map((rev, i) => (
                  <div key={`${rev.timestamp}-${i}`} className="relative flex items-start gap-3">
                    {/* 时间线圆点 */}
                    <div className="absolute -left-4 top-1.5 w-[7px] h-[7px] rounded-full bg-primary ring-2 ring-background" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {new Date(rev.timestamp).toLocaleString("zh-CN", {
                            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                        <Badge
                          variant={sourceBadgeVariant(rev.source)}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {SOURCE_LABELS[rev.source] ?? rev.source}
                        </Badge>
                      </div>
                      <p className="text-xs text-foreground mt-0.5">
                        修改了 {rev.changedFields.map((f) => `「${f}」`).join("、")}
                      </p>
                    </div>
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
