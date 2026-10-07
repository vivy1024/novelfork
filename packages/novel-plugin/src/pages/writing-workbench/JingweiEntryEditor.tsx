import { useState, useEffect, useRef } from "react";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Save, Trash2, Loader2, FileText, Link2, History, Eye, Pencil, RotateCcw, X,
} from "lucide-react";
import { CATEGORY_SCHEMAS, getCategorySchema, type CategoryFieldSchema } from "./jingwei/category-schemas";
import { WorldCardPage, isWorldCardCategory } from "./WorldCardPage";
import { Textarea } from "@/components/ui/textarea";

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
  aliases?: string[];
  visibility?: "global" | "tracked" | "nested";
  visibleAfterChapter?: number | null;
  visibleUntilChapter?: number | null;
  parentId?: string | null;
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

export interface JingweiEntrySavePayload {
  title: string;
  contentMd: string;
  priorityTier?: JingweiPriorityTier;
  layer?: string;
  status?: string;
  category?: string;
  aliases?: string[];
  relatedEntryIds?: string[];
  visibility?: "global" | "tracked" | "nested";
  visibleAfterChapter?: number | null;
  visibleUntilChapter?: number | null;
  fields?: Record<string, unknown>;
}

export interface JingweiEntryEditorProps {
  entry: JingweiEntryData;
  bookId?: string;
  sectionLabel?: string;
  sourceLabel?: string;
  onSave: (entryId: string, payload: JingweiEntrySavePayload) => Promise<void>;
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

// 档案式阅读模式的属性徽标文案（状态术语统一用「待确认」）。
const ENTRY_STATUS_LABELS: Record<string, string> = {
  confirmed: "已确认",
  draft: "未确认",
  "needs-review": "待确认",
};

const ENTRY_LAYER_LABELS: Record<string, string> = {
  canon: "权威设定",
  dynamic: "随剧情推进",
  reference: "参考",
};

const ENTRY_PRIORITY_LABELS: Record<JingweiPriorityTier, string> = {
  auto: "自动",
  core: "核心",
  relevant: "相关",
  reference: "参考",
};

const ENTRY_VISIBILITY_LABELS: Record<string, string> = {
  global: "全局",
  tracked: "章节窗口",
  nested: "随父条目",
};

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

function fieldValueToInput(value: unknown, field: CategoryFieldSchema): string {
  if (value == null) return "";
  if (field.type === "tags" || field.type === "multi-select") {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("，") : String(value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function parseFieldInput(field: CategoryFieldSchema, raw: string): unknown {
  if (field.type === "number" || field.type === "chapter") {
    if (raw.trim() === "") return "";
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (field.type === "boolean") return raw === "true";
  if (field.type === "tags" || field.type === "multi-select") {
    return raw.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return raw;
}

function JingweiSchemaField({
  field,
  value,
  onChange,
}: {
  field: CategoryFieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const inputId = `jingwei-field-${field.key}`;
  const display = fieldValueToInput(value, field);
  const controlClass = "w-full h-8 text-xs rounded-md border border-input bg-background px-2";
  return (
    <div>
      <label htmlFor={inputId} className="text-xs text-muted-foreground mb-1 block">{field.label}{field.required ? " *" : ""}</label>
      {field.type === "textarea" ? (
        <Textarea
          id={inputId}
          value={display}
          onChange={(event) => onChange(parseFieldInput(field, event.target.value))}
          className="min-h-16 text-xs"
        />
      ) : field.type === "select" ? (
        <select
          id={inputId}
          value={display}
          onChange={(event) => onChange(parseFieldInput(field, event.target.value))}
          className={controlClass}
        >
          <option value="">未选择</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : field.type === "boolean" ? (
        <select
          id={inputId}
          value={display === "true" ? "true" : "false"}
          onChange={(event) => onChange(parseFieldInput(field, event.target.value))}
          className={controlClass}
        >
          <option value="false">否</option>
          <option value="true">是</option>
        </select>
      ) : (
        <Input
          id={inputId}
          type={field.type === "number" || field.type === "chapter" ? "number" : "text"}
          value={display}
          onChange={(event) => onChange(parseFieldInput(field, event.target.value))}
          className="h-8 text-xs"
        />
      )}
      {field.helpText ? <p className="mt-1 text-2xs text-muted-foreground">{field.helpText}</p> : null}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

/**
 * 世界设定类分类（world-model/locations/factions/power-system/props）路由到世界卡。
 * 用无 hooks 的薄包装做分流，而不是在本组件 hooks 之后条件 return——
 * 同一实例内 category 变化时，提前 return 会改变 hook 调用数直接崩溃。
 */
export function JingweiEntryEditor(props: JingweiEntryEditorProps) {
  if (isWorldCardCategory(props.entry.category)) {
    return <WorldCardPage {...props} />;
  }
  return <JingweiEntryEditorForm {...props} />;
}

function JingweiEntryEditorForm({
  entry,
  bookId,
  sectionLabel,
  sourceLabel = "设定资料",
  onSave,
  onDelete,
  relatedEntries,
  onNavigateToEntry,
}: JingweiEntryEditorProps) {
  // 不能用 sourceLabel 判断：父组件（WorkbenchCanvas）只会传「故事推进」/「作品基础资料」，
  // sourceLabel === "经纬资料" 恒为 false，分类/关联/可见性编辑面板曾是死 UI。
  // 经纬条目一定挂在某个分区下（sectionId），叙事记忆条目没有 sectionId —— 用它做判别。
  const isJingweiEntry = entry.sectionId != null;
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.contentMd);
  const [priorityTier, setPriorityTier] = useState<JingweiPriorityTier>(entry.priorityTier ?? "auto");
  const [layer, setLayer] = useState<string>(entry.layer ?? "dynamic");
  const [visibility, setVisibility] = useState<"global" | "tracked" | "nested">(entry.visibility ?? "tracked");
  const [status, setStatus] = useState<string>(entry.status ?? "confirmed");
  const [category, setCategory] = useState<string>(entry.category ?? "unclassified");
  const [aliases, setAliases] = useState<string[]>(entry.aliases ?? []);
  const [aliasInput, setAliasInput] = useState("");
  const [savedTitle, setSavedTitle] = useState(entry.title);
  const [savedContent, setSavedContent] = useState(entry.contentMd);
  const [savedPriorityTier, setSavedPriorityTier] = useState<JingweiPriorityTier>(entry.priorityTier ?? "auto");
  const [savedLayer, setSavedLayer] = useState<string>(entry.layer ?? "dynamic");
  const [savedVisibility, setSavedVisibility] = useState<"global" | "tracked" | "nested">(entry.visibility ?? "tracked");
  const [savedStatus, setSavedStatus] = useState<string>(entry.status ?? "confirmed");
  const [savedCategory, setSavedCategory] = useState<string>(entry.category ?? "unclassified");
  const [savedAliases, setSavedAliases] = useState<string[]>(entry.aliases ?? []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "relations" | "history">("details");
  const [previewMode, setPreviewMode] = useState(false);
  // 档案式阅读为默认形态；needs-review 草案打开即编辑，便于作者先改再确认。
  const [isEditing, setIsEditing] = useState(entry.status === "needs-review");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [revisionRecords, setRevisionRecords] = useState<RevisionRecord[]>([]);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [resolvedRelatedEntries, setResolvedRelatedEntries] = useState<RelatedEntryItem[]>([]);
  const [relatedEntryIds, setRelatedEntryIds] = useState<string[]>(entry.relatedEntryIds ?? []);
  const [savedRelatedEntryIds, setSavedRelatedEntryIds] = useState<string[]>(entry.relatedEntryIds ?? []);
  const [fields, setFields] = useState<Record<string, unknown>>(entry.fields ?? {});
  const [savedFields, setSavedFields] = useState<Record<string, unknown>>(entry.fields ?? {});
  const [relationSearch, setRelationSearch] = useState("");
  const [relationSearchResults, setRelationSearchResults] = useState<RelatedEntryItem[]>([]);
  const [relationAdding, setRelationAdding] = useState(false);
  const [conflictStatus, setConflictStatus] = useState(entry.conflictStatus ?? "none");
  const [conflictDetail, setConflictDetail] = useState(entry.conflictDetail);
  const [revertingRevisionId, setRevertingRevisionId] = useState<string | null>(null);

  const schemaFields = (getCategorySchema(category)?.fields ?? []).filter((field) => field.key !== "name");
  // 阅读模式只列出有值的字段，空字段整行隐藏。
  const filledSchemaFields = isJingweiEntry
    ? schemaFields.filter((field) => fieldValueToInput(fields[field.key], field).trim() !== "")
    : [];
  const categoryLabel = getCategorySchema(category)?.name;
  const dirty = title !== savedTitle || content !== savedContent || priorityTier !== savedPriorityTier
    || layer !== savedLayer || visibility !== savedVisibility || status !== savedStatus
    || category !== savedCategory || aliases.join("\u0000") !== savedAliases.join("\u0000")
    || relatedEntryIds.join("\u0000") !== savedRelatedEntryIds.join("\u0000")
    || JSON.stringify(fields) !== JSON.stringify(savedFields);
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
        placeholder: "在此编辑条目内容…",
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: content || "",
    editable: isEditing && !previewMode,
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return;
      const md = ed.storage.markdown.getMarkdown() as string;
      setContent(md);
    },
  });

  // Sync edit/preview mode → editable
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditing && !previewMode);
    }
  }, [editor, previewMode, isEditing]);

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
    setLayer(entry.layer ?? "dynamic");
    setVisibility(entry.visibility ?? "tracked");
    setStatus(entry.status ?? "confirmed");
    setCategory(entry.category ?? "unclassified");
    setAliases(entry.aliases ?? []);
    setRelatedEntryIds(entry.relatedEntryIds ?? []);
    setFields(entry.fields ?? {});
    setSavedFields(entry.fields ?? {});
    setSavedTitle(entry.title);
    setSavedContent(entry.contentMd);
    setSavedPriorityTier(entry.priorityTier ?? "auto");
    setSavedLayer(entry.layer ?? "dynamic");
    setSavedVisibility(entry.visibility ?? "tracked");
    setSavedStatus(entry.status ?? "confirmed");
    setSavedCategory(entry.category ?? "unclassified");
    setSavedAliases(entry.aliases ?? []);
    setSavedRelatedEntryIds(entry.relatedEntryIds ?? []);
    setAliasInput("");
    setRelationSearch("");
    setRelationAdding(false);
    setRelationSearchResults([]);
    setPreviewMode(false);
    setIsEditing(entry.status === "needs-review");
    setConfirmDiscard(false);
    setConfirmDelete(false);
    setError(null);
    setActiveTab("details");
    setConflictStatus(entry.conflictStatus ?? "none");
    setConflictDetail(entry.conflictDetail);
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRevisions(isStale: () => boolean = () => false): Promise<void> {
    if (!bookId) {
      setRevisionRecords([]);
      return;
    }
    setRevisionLoading(true);
    setRevisionError(null);
    try {
      const data = await fetchJson<{ revisions?: RevisionRecord[] }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/revisions`,
      );
      if (isStale()) return;
      setRevisionRecords(Array.isArray(data.revisions) ? data.revisions : []);
    } catch (cause) {
      if (isStale()) return;
      setRevisionRecords([]);
      const status = cause instanceof ApiRequestError ? cause.status : undefined;
      setRevisionError(status ? `历史加载失败（${status}）` : cause instanceof Error ? cause.message : "历史加载失败");
    } finally {
      if (!isStale()) setRevisionLoading(false);
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
    void loadRevisions(() => cancelled);
    const base = `/api/books/${encodeURIComponent(bookId)}/jingwei`;
    void fetchJson<{ entries?: Array<Record<string, unknown>> }>(`${base}/entries`)
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
      const nextFields: Record<string, unknown> = { ...fields };
      if ((getCategorySchema(category)?.fields ?? []).some((field) => field.key === "name") && !String(nextFields.name ?? "").trim()) {
        nextFields.name = title.trim();
      }
      await onSave(entry.id, {
        title: title.trim(),
        contentMd: content,
        priorityTier,
        layer,
        status,
        category,
        aliases,
        relatedEntryIds,
        visibility,
        fields: nextFields,
        // 章节窗口不在编辑器里修改，但保存时必须带上原值：
        // 服务端会把 visibilityRule 整体重写，漏传就会把已有的窗口字段清掉。
        visibleAfterChapter: entry.visibleAfterChapter ?? null,
        visibleUntilChapter: entry.visibleUntilChapter ?? null,
      });
      setSavedTitle(title.trim());
      setSavedContent(content);
      setSavedPriorityTier(priorityTier);
      setSavedLayer(layer);
      setSavedStatus(status);
      setSavedCategory(category);
      setSavedAliases(aliases);
      setSavedRelatedEntryIds(relatedEntryIds);
      setFields(nextFields);
      setSavedFields(nextFields);
      // 保存成功回到档案式阅读态。
      setIsEditing(false);
      setConfirmDiscard(false);
      setPreviewMode(false);
      setRelationAdding(false);
      setRelationSearch("");
      setRelationSearchResults([]);
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

  function resetToSaved() {
    setTitle(savedTitle);
    setContent(savedContent);
    setPriorityTier(savedPriorityTier);
    setLayer(savedLayer);
    setVisibility(savedVisibility);
    setStatus(savedStatus);
    setCategory(savedCategory);
    setAliases(savedAliases);
    setRelatedEntryIds(savedRelatedEntryIds);
    setFields(savedFields);
    setAliasInput("");
    setRelationAdding(false);
    setRelationSearch("");
    setRelationSearchResults([]);
  }

  function handleStartEdit() {
    setConfirmDiscard(false);
    setConfirmDelete(false);
    setError(null);
    setIsEditing(true);
  }

  // 取消编辑：无改动直接回到阅读态；有未保存改动时先走一次内联确认（与删除的两段确认同例）。
  function handleCancelEdit() {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    resetToSaved();
    setConfirmDiscard(false);
    setPreviewMode(false);
    setIsEditing(false);
  }

  async function handleRevert(revision: RevisionRecord) {
    if (!bookId || revertingRevisionId) return;
    setRevertingRevisionId(revision.id);
    setError(null);
    try {
      const data = await fetchJson<{ entry?: JingweiEntryData }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/revert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revisionId: revision.id }),
        },
      );
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
      if (restored?.layer) { setLayer(restored.layer); setSavedLayer(restored.layer); }
      if (restored?.status) { setStatus(restored.status); setSavedStatus(restored.status); }
      if (restored?.category) { setCategory(restored.category); setSavedCategory(restored.category); }
      if (Array.isArray(restored?.aliases)) { setAliases(restored.aliases); setSavedAliases(restored.aliases); }
      if (Array.isArray(restored?.relatedEntryIds)) { setRelatedEntryIds(restored.relatedEntryIds); setSavedRelatedEntryIds(restored.relatedEntryIds); }
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
        {sectionLabel && <Badge variant="secondary" className="text-2xs">{sectionLabel}</Badge>}
        {isEditing && <Badge className="text-2xs">编辑中</Badge>}
        <div className="ml-auto flex items-center gap-1.5">
          {entry.updatedAt && (
            <span className="text-2xs text-muted-foreground whitespace-nowrap">
              更新于 {new Date(entry.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {!isEditing && (
            <Button size="xs" variant="outline" onClick={handleStartEdit} title="编辑此条目">
              <Pencil className="size-3 mr-1" />编辑
            </Button>
          )}
          {!isEditing && onDelete && (
            confirmDelete ? (
              <span className="flex items-center gap-1">
                <span className="text-xs text-destructive">确认删除？</span>
                <Button size="xs" variant="destructive" disabled={deleting} onClick={handleDelete}>
                  {deleting ? <Loader2 className="size-3 animate-spin" /> : "确认"}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button>
              </span>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(true)} title="删除此条目">
                <Trash2 className="size-3.5" />
              </Button>
            )
          )}
        </div>
      </header>
      {error && !isEditing && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
          {error}
        </div>
      )}
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
            <Badge variant="secondary" className="ml-1 text-2xs px-1 py-0">{relationItems.length}</Badge>
          )}
        </Button>
        <Button variant={activeTab === "history" ? "default" : "ghost"} size="xs" onClick={() => setActiveTab("history")}>
          <History className="size-3 mr-1" />历史
          {historyCount > 0 && (
            <Badge variant="secondary" className="ml-1 text-2xs px-1 py-0">{historyCount}</Badge>
          )}
        </Button>
      </div>

      {/* ─── Tab: 关联 ──────────────────────────────────────────────── */}
      {activeTab === "relations" && (
        <div className="py-4 px-1 space-y-3">
          {isJingweiEntry && isEditing && (
            <div className="flex items-center gap-2">
              <Button size="xs" variant="outline" onClick={() => setRelationAdding((v) => !v)}>
                <Link2 className="size-3 mr-1" />{relationAdding ? "取消" : "添加关联"}
              </Button>
              <span className="text-2xs text-muted-foreground">关联写回条目字段，AI 注入上下文时会一并带上关联条目</span>
            </div>
          )}
          {isJingweiEntry && isEditing && relationAdding && (
            <div className="space-y-1 rounded-md border border-border p-2">
              <Input
                value={relationSearch}
                onChange={(e) => {
                  const q = e.target.value;
                  setRelationSearch(q);
                  if (!q.trim() || !bookId) { setRelationSearchResults([]); return; }
                  fetchJson<{ results?: RelatedEntryItem[] }>(`/api/books/${encodeURIComponent(bookId)}/jingwei/search?q=${encodeURIComponent(q)}`)
                    .then((d) => setRelationSearchResults((Array.isArray(d.results) ? d.results : []).filter((item) => item.id !== entry.id).slice(0, 8)))
                    .catch(() => setRelationSearchResults([]));
                }}
                placeholder="搜索要关联的条目…"
                className="h-7 text-xs"
                autoFocus
              />
              {relationSearchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (!relatedEntryIds.includes(item.id)) setRelatedEntryIds((prev) => [...prev, item.id]);
                    setRelationSearch("");
                    setRelationSearchResults([]);
                    setRelationAdding(false);
                  }}
                  className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-muted"
                >
                  {item.title}
                </button>
              ))}
            </div>
          )}
          {relationItems.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {relationItems.map((re) => (
                <span
                  key={re.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                             bg-secondary text-secondary-foreground border border-border"
                >
                  <button type="button" onClick={() => onNavigateToEntry?.(re.id)} className="inline-flex items-center gap-1 hover:underline" title={`跳转到「${re.title}」`}>
                    <Link2 className="size-3 opacity-60" />
                    {re.title}
                  </button>
                  {isJingweiEntry && isEditing && (
                    <button
                      type="button"
                      onClick={() => setRelatedEntryIds((prev) => prev.filter((id) => id !== re.id))}
                      className="text-muted-foreground hover:text-destructive"
                      title="移除关联"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
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
                        <span className="text-2xs text-muted-foreground whitespace-nowrap">
                          {new Date(revision.created_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <Badge variant={sourceBadgeVariant(revision.changed_by)} className="text-2xs px-1.5 py-0">
                          {SOURCE_LABELS[revision.changed_by] ?? revision.changed_by}
                        </Badge>
                        {revision.reason && <span className="text-2xs text-muted-foreground truncate">{revision.reason}</span>}
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

      {/* ─── Tab: 详情（档案式阅读） ────────────────────────────────── */}
      {activeTab === "details" && !isEditing && (
        <div className="space-y-4 py-1" data-testid="jingwei-entry-reading">
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold leading-snug">{title.trim() || "未命名条目"}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {categoryLabel && <Badge variant="secondary" className="text-2xs">{categoryLabel}</Badge>}
              {status === "needs-review" ? (
                <Badge variant="outline" className="text-2xs border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">待确认</Badge>
              ) : (
                <Badge variant="outline" className="text-2xs">{ENTRY_STATUS_LABELS[status] ?? status}</Badge>
              )}
              {ENTRY_LAYER_LABELS[layer] && (
                <Badge variant="outline" className="text-2xs text-muted-foreground">层级·{ENTRY_LAYER_LABELS[layer]}</Badge>
              )}
              <Badge variant="outline" className="text-2xs text-muted-foreground">优先级·{ENTRY_PRIORITY_LABELS[priorityTier]}</Badge>
              {isJingweiEntry && ENTRY_VISIBILITY_LABELS[visibility] ? (
                <Badge variant="outline" className="text-2xs text-muted-foreground">可见性·{ENTRY_VISIBILITY_LABELS[visibility]}</Badge>
              ) : null}
            </div>
            {aliases.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-2xs text-muted-foreground">别名：</span>
                {aliases.map((alias, index) => (
                  <Badge key={`${alias}-${index}`} variant="secondary" className="text-2xs">{alias}</Badge>
                ))}
              </div>
            )}
          </div>

          {filledSchemaFields.length > 0 && (
            <dl className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5" data-testid="jingwei-entry-fields-reading">
              {filledSchemaFields.map((field) => (
                <div key={field.key} className="flex gap-3">
                  <dt className="w-20 shrink-0 pt-0.5 text-xs text-muted-foreground">{field.label}</dt>
                  <dd className="min-w-0 flex-1 whitespace-pre-line text-sm">{fieldValueToInput(fields[field.key], field)}</dd>
                </div>
              ))}
            </dl>
          )}

          {content.trim() ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none rounded-md border border-border/60 bg-background/60 px-3 py-2.5"
              data-testid="jingwei-entry-content-reading"
            >
              <EditorContent editor={editor} className="jingwei-entry-editor__tiptap" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无正文内容</p>
          )}
        </div>
      )}

      {/* ─── Tab: 详情（编辑表单） ──────────────────────────────────── */}
      {activeTab === "details" && isEditing && (
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

          {isJingweiEntry && schemaFields.length > 0 ? (
            <div className="grid grid-cols-2 gap-3" data-testid="jingwei-entry-fields">
              {schemaFields.map((field) => (
                <div key={field.key} className={field.type === "textarea" ? "col-span-2" : undefined}>
                  <JingweiSchemaField
                    field={field}
                    value={fields[field.key]}
                    onChange={(value) => setFields((current) => ({ ...current, [field.key]: value }))}
                  />
                </div>
              ))}
            </div>
          ) : null}

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
            <p className="mt-1 text-2xs text-muted-foreground">核心条目始终被 Agent 看到；参考条目仅在 full 模式下注入。</p>
          </div>

          {isJingweiEntry && (
            <>
              {/* 分类 / 层级 / 可见性 / 状态 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">分类</label>
                  <Select value={category} onValueChange={(value) => setCategory(value)}>
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue placeholder="选择分类" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_SCHEMAS.map((schema) => (
                        <SelectItem key={schema.id} value={schema.id}>{schema.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">层级</label>
                  <Select value={layer} onValueChange={(value) => setLayer(value)}>
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue placeholder="选择层级" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="canon">Canon（权威设定）</SelectItem>
                      <SelectItem value="dynamic">Dynamic（随剧情推进）</SelectItem>
                      <SelectItem value="reference">Reference（参考）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">可见性</label>
                  <Select value={visibility} onValueChange={(value) => setVisibility(value as "global" | "tracked" | "nested")}>
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue placeholder="选择可见性" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">全局（始终可见）</SelectItem>
                      <SelectItem value="tracked">追踪（按章节窗口）</SelectItem>
                      <SelectItem value="nested">嵌套（随父条目）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">状态</label>
                  <Select value={status} onValueChange={(value) => setStatus(value)}>
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue placeholder="选择状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="confirmed">已确认</SelectItem>
                      <SelectItem value="draft">未确认</SelectItem>
                      <SelectItem value="needs-review">待确认</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 别名 */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">别名</label>
                <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5">
                  {aliases.map((alias, index) => (
                    <Badge key={`${alias}-${index}`} variant="secondary" className="text-2xs gap-0.5 pr-1">
                      {alias}
                      <button type="button" onClick={() => setAliases((prev) => prev.filter((_, i) => i !== index))} className="ml-0.5 hover:text-destructive">
                        <X className="size-2.5" />
                      </button>
                    </Badge>
                  ))}
                  <Input
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && aliasInput.trim()) {
                        setAliases((prev) => [...prev, aliasInput.trim()]);
                        setAliasInput("");
                        e.preventDefault();
                      }
                    }}
                    placeholder={aliases.length === 0 ? "回车添加别名" : "添加…"}
                    className="h-6 w-28 text-2xs border-none bg-transparent px-1 focus-visible:ring-0"
                  />
                </div>
                <p className="mt-1 text-2xs text-muted-foreground">别名用于经纬检索召回，多个别名回车分隔。</p>
              </div>
            </>
          )}

          {/* 操作栏 */}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Save className="size-3.5 mr-1" />}
              保存
            </Button>

            {dirty && <Badge className="text-2xs bg-yellow-500/10 text-yellow-600 border-yellow-500/20">未保存</Badge>}

            {confirmDiscard ? (
              <span className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">放弃未保存的修改？</span>
                <Button size="xs" variant="destructive" onClick={handleCancelEdit}>放弃</Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirmDiscard(false)}>继续编辑</Button>
              </span>
            ) : (
              <Button size="xs" variant="ghost" onClick={handleCancelEdit}>取消</Button>
            )}

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
