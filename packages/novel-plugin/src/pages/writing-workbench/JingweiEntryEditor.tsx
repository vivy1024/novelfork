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
  Save, Trash2, Loader2, FileText, Link2, History, Eye, Pencil, RotateCcw, X, GitBranch, Network, Plus,
} from "lucide-react";
import { CATEGORY_SCHEMAS, getCategorySchema, type CategoryFieldSchema } from "./jingwei/category-schemas";
import { WorldCardPage, isWorldCardCategory } from "./WorldCardPage";
import { Textarea } from "@/components/ui/textarea";
import { parseChapterWindowInput } from "./JingweiCanonPanel";

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

/** 条目字段演变台账的一行（GET /jingwei/entries/:entryId/progressions）。 */
export interface ProgressionRecord {
  id: string;
  entry_id: string;
  field_key: string;
  old_value?: string | null;
  new_value: string;
  chapter_number?: number | null;
  description?: string | null;
  created_at: number;
}

/** 结构化依赖的一端（依赖谁 / 被谁依赖）。 */
export interface DependencyItem {
  depId: string;
  relationType?: string | null;
  targetEntryId?: string;
  sourceEntryId?: string;
  title: string;
  category?: string | null;
}

/** 静态关系（带关系类型，如师徒 / 敌对 / 隶属）。 */
export interface RelationRecord {
  id: string;
  source_entry_id: string;
  target_entry_id: string;
  relation_type: string;
  label?: string | null;
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
  /** 乐观并发（T-24）：编辑器持有的条目版本。服务端发现库中版本已变（后台结算等先写入）时拒绝保存（409），不覆盖。 */
  expectedVersion?: number;
}

export interface JingweiEntryEditorProps {
  entry: JingweiEntryData;
  bookId?: string;
  sectionLabel?: string;
  sourceLabel?: string;
  /**
   * 保存条目。可返回 notice：保存已成功、但附带动作没做完（如确认人物后实体图谱没同步），
   * 编辑器把它作为提示显示，不当作保存失败。
   */
  onSave: (entryId: string, payload: JingweiEntrySavePayload) => Promise<void | { readonly notice?: string }>;
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

/**
 * 打开即编辑的条目状态判定。needs-review 与 draft 同为「未确认」：两者都不进 Lore 召回
 * （见 jingwei-read-model 的 includeUnconfirmed 语义），打开时给作者编辑态先改再确认。
 */
export function opensInEditMode(status: string | undefined): boolean {
  return status === "needs-review" || status === "draft";
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

/** 章节窗口输入框的显示值：空 = 不限。 */
function chapterInputText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/** 阅读态显示：select 字段按 optionLabels 显示中文名。 */
function fieldValueToDisplay(value: unknown, field: CategoryFieldSchema): string {
  const raw = fieldValueToInput(value, field);
  return field.optionLabels?.[raw] ?? raw;
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
          {/* 库里存的值不在选项里时（老数据、手写值）也显示出来，不被当成「未选择」悄悄覆盖 */}
          {display && !(field.options ?? []).includes(display) ? <option value={display}>{display}</option> : null}
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{field.optionLabels?.[option] ?? option}</option>
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
      {field.helpText ? <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p> : null}
    </div>
  );
}

// ─── 依赖 / 关系的轻量选择器 ──────────────────────────────────────────────

/** 搜索条目并选定：依赖与关系两处共用同一套交互。 */
function StructurePicker({
  label,
  query,
  results,
  onQueryChange,
  onPick,
  disabled,
}: {
  label: string;
  query: string;
  results: readonly RelatedEntryItem[];
  onQueryChange: (query: string) => void;
  onPick: (item: RelatedEntryItem) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1 rounded-md border border-border p-2">
      <Input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="h-7 text-xs"
        autoFocus
      />
      {query.trim() && results.length === 0 ? (
        <p className="px-1 text-2xs text-muted-foreground">没有匹配的条目</p>
      ) : null}
      {results.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item)}
          disabled={disabled}
          className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
        >
          {item.title}
        </button>
      ))}
    </div>
  );
}

interface DependencyColumnItem {
  readonly key: string;
  readonly title: string;
  readonly entryId?: string;
  readonly relationType?: string | null;
  readonly canRemove: boolean;
}

/** 依赖的一列（依赖谁 / 被谁依赖）：标题 + 可跳转 + 可移除。 */
function DependencyColumn({
  title,
  emptyText,
  items,
  onNavigate,
  onRemove,
  removeLabel,
  disabled,
}: {
  title: string;
  emptyText: string;
  items: readonly DependencyColumnItem[];
  onNavigate?: (entryId: string) => void;
  onRemove: (key: string) => void;
  removeLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-2xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-2xs text-muted-foreground/70">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.key} className="nf-surface-sub flex items-center gap-1.5 px-2 py-1 text-2xs" data-testid="jingwei-dependency-row">
              <button
                type="button"
                onClick={() => item.entryId && onNavigate?.(item.entryId)}
                className="min-w-0 flex-1 truncate text-left hover:underline"
                title={`跳转到「${item.title}」`}
              >
                {item.title}
              </button>
              {item.relationType ? (
                <Badge variant="secondary" className="text-2xs px-1 py-0">{item.relationType}</Badge>
              ) : null}
              {item.canRemove ? (
                <button
                  type="button"
                  onClick={() => onRemove(item.key)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`${removeLabel} ${item.title}`}
                  disabled={disabled}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
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
  // 章节窗口：之前只是把原值透传回服务端，作者改不了；现在可编辑并计入 dirty。
  const [visibleAfterChapter, setVisibleAfterChapter] = useState<number | null>(entry.visibleAfterChapter ?? null);
  const [visibleUntilChapter, setVisibleUntilChapter] = useState<number | null>(entry.visibleUntilChapter ?? null);
  const [afterChapterInput, setAfterChapterInput] = useState(() => chapterInputText(entry.visibleAfterChapter));
  const [untilChapterInput, setUntilChapterInput] = useState(() => chapterInputText(entry.visibleUntilChapter));
  const [status, setStatus] = useState<string>(entry.status ?? "confirmed");
  const [category, setCategory] = useState<string>(entry.category ?? "unclassified");
  const [aliases, setAliases] = useState<string[]>(entry.aliases ?? []);
  const [aliasInput, setAliasInput] = useState("");
  const [savedTitle, setSavedTitle] = useState(entry.title);
  const [savedContent, setSavedContent] = useState(entry.contentMd);
  const [savedPriorityTier, setSavedPriorityTier] = useState<JingweiPriorityTier>(entry.priorityTier ?? "auto");
  const [savedLayer, setSavedLayer] = useState<string>(entry.layer ?? "dynamic");
  const [savedVisibility, setSavedVisibility] = useState<"global" | "tracked" | "nested">(entry.visibility ?? "tracked");
  const [savedVisibleAfterChapter, setSavedVisibleAfterChapter] = useState<number | null>(entry.visibleAfterChapter ?? null);
  const [savedVisibleUntilChapter, setSavedVisibleUntilChapter] = useState<number | null>(entry.visibleUntilChapter ?? null);
  const [savedStatus, setSavedStatus] = useState<string>(entry.status ?? "confirmed");
  const [savedCategory, setSavedCategory] = useState<string>(entry.category ?? "unclassified");
  const [savedAliases, setSavedAliases] = useState<string[]>(entry.aliases ?? []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 保存成功但附带动作没做完时的提示（如确认人物后实体图谱没同步）；下次保存或换条目时清掉。
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "relations" | "progressions" | "history">("details");
  const [previewMode, setPreviewMode] = useState(false);
  // 档案式阅读为默认形态；未确认条目（needs-review / draft）打开即编辑，便于作者先改再确认。
  const [isEditing, setIsEditing] = useState(opensInEditMode(entry.status));
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

  // ── 演变台账（progressions） / 结构化依赖 / 静态关系 ──────────────────
  // 这三块都按需拉取：只在对应 Tab 打开时请求，避免电影响应默认阅读态的首屏。
  const [progressions, setProgressions] = useState<ProgressionRecord[]>([]);
  const [progressionLoading, setProgressionLoading] = useState(false);
  const [progressionError, setProgressionError] = useState<string | null>(null);
  const [progressionSaving, setProgressionSaving] = useState(false);
  const [progressionForm, setProgressionForm] = useState({
    chapterNumber: "",
    fieldKey: "",
    oldValue: "",
    newValue: "",
    description: "",
  });
  const [dependsOn, setDependsOn] = useState<DependencyItem[]>([]);
  const [dependedBy, setDependedBy] = useState<DependencyItem[]>([]);
  const [relations, setRelations] = useState<RelationRecord[]>([]);
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [structureBusy, setStructureBusy] = useState(false);
  const [structurePicker, setStructurePicker] = useState<null | "dependency" | "relation">(null);
  const [structureSearch, setStructureSearch] = useState("");
  const [structureResults, setStructureResults] = useState<RelatedEntryItem[]>([]);
  const [relationTypeInput, setRelationTypeInput] = useState("references");
  const [relationLabelInput, setRelationLabelInput] = useState("");
  const [entryTitles, setEntryTitles] = useState<Record<string, string>>({});

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
    || (visibleAfterChapter ?? null) !== (savedVisibleAfterChapter ?? null)
    || (visibleUntilChapter ?? null) !== (savedVisibleUntilChapter ?? null)
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
    setVisibleAfterChapter(entry.visibleAfterChapter ?? null);
    setVisibleUntilChapter(entry.visibleUntilChapter ?? null);
    setAfterChapterInput(chapterInputText(entry.visibleAfterChapter));
    setUntilChapterInput(chapterInputText(entry.visibleUntilChapter));
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
    setSavedVisibleAfterChapter(entry.visibleAfterChapter ?? null);
    setSavedVisibleUntilChapter(entry.visibleUntilChapter ?? null);
    setSavedStatus(entry.status ?? "confirmed");
    setSavedCategory(entry.category ?? "unclassified");
    setSavedAliases(entry.aliases ?? []);
    setSavedRelatedEntryIds(entry.relatedEntryIds ?? []);
    setAliasInput("");
    setRelationSearch("");
    setRelationAdding(false);
    setRelationSearchResults([]);
    setPreviewMode(false);
    setIsEditing(opensInEditMode(entry.status));
    setConfirmDiscard(false);
    setConfirmDelete(false);
    setError(null);
    setSaveNotice(null);
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
        // 依赖 / 关系两端只给 id：拿这份标题表补上可读名称（缺的回落成 id）。
        setEntryTitles(Object.fromEntries(byId));
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

  // ── 演变台账：进入「演变」Tab 时按需拉取 ──────────────────────────────
  async function loadProgressions(isStale: () => boolean = () => false): Promise<void> {
    if (!bookId) {
      setProgressions([]);
      return;
    }
    setProgressionLoading(true);
    setProgressionError(null);
    try {
      const data = await fetchJson<{ progressions?: ProgressionRecord[] }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/progressions`,
      );
      if (isStale()) return;
      setProgressions(Array.isArray(data.progressions) ? data.progressions : []);
    } catch (cause) {
      if (isStale()) return;
      setProgressions([]);
      setProgressionError(cause instanceof Error ? cause.message : "演变记录加载失败");
    } finally {
      if (!isStale()) setProgressionLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "progressions" || !bookId) return;
    let cancelled = false;
    void loadProgressions(() => cancelled);
    return () => { cancelled = true; };
    // 只在切到「演变」Tab 或换条目时重拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, bookId, entry.id]);

  // ── 结构化依赖 + 静态关系：进入「关联」Tab 时按需拉取 ─────────────────
  async function loadStructure(isStale: () => boolean = () => false): Promise<void> {
    if (!bookId) {
      setDependsOn([]);
      setDependedBy([]);
      setRelations([]);
      return;
    }
    setStructureLoading(true);
    setStructureError(null);
    const base = `/api/books/${encodeURIComponent(bookId)}/jingwei`;
    try {
      const [dependencyData, relationData] = await Promise.all([
        fetchJson<{ dependsOn?: DependencyItem[]; dependedBy?: DependencyItem[] }>(
          `${base}/entries/${encodeURIComponent(entry.id)}/dependencies`,
        ).catch(() => ({ dependsOn: [], dependedBy: [] })),
        fetchJson<{ relations?: RelationRecord[] }>(
          `${base}/relations?entryId=${encodeURIComponent(entry.id)}`,
        ).catch(() => ({ relations: [] })),
      ]);
      if (isStale()) return;
      setDependsOn(Array.isArray(dependencyData.dependsOn) ? dependencyData.dependsOn : []);
      setDependedBy(Array.isArray(dependencyData.dependedBy) ? dependencyData.dependedBy : []);
      setRelations(Array.isArray(relationData.relations) ? relationData.relations : []);
    } catch (cause) {
      if (isStale()) return;
      setStructureError(cause instanceof Error ? cause.message : "依赖与关系加载失败");
    } finally {
      if (!isStale()) setStructureLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "relations" || !bookId) return;
    let cancelled = false;
    void loadStructure(() => cancelled);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, bookId, entry.id]);

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    setSaveNotice(null);
    try {
      const nextFields: Record<string, unknown> = { ...fields };
      if ((getCategorySchema(category)?.fields ?? []).some((field) => field.key === "name") && !String(nextFields.name ?? "").trim()) {
        nextFields.name = title.trim();
      }
      const saved = await onSave(entry.id, {
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
        // 章节窗口由作者直接编辑；空值显式传 null，服务端整体重写 visibilityRule 时不会留下旧窗口。
        visibleAfterChapter: visibleAfterChapter ?? null,
        visibleUntilChapter: visibleUntilChapter ?? null,
        // 乐观并发：只有拿到有效版本时才带上；缺失则走原有无版本路径，不传非法值。
        ...(Number.isInteger(entry.version) && (entry.version as number) >= 1 ? { expectedVersion: entry.version } : {}),
      });
      setSavedTitle(title.trim());
      setSavedContent(content);
      setSavedPriorityTier(priorityTier);
      setSavedLayer(layer);
      setSavedVisibility(visibility);
      setSavedVisibleAfterChapter(visibleAfterChapter ?? null);
      setSavedVisibleUntilChapter(visibleUntilChapter ?? null);
      setSavedStatus(status);
      setSavedCategory(category);
      setSavedAliases(aliases);
      setSavedRelatedEntryIds(relatedEntryIds);
      setFields(nextFields);
      setSavedFields(nextFields);
      // B1：作者保存即裁决——服务端会清掉机器写入冲突记录并复位 pending 标记，
      // 本地状态同步跟上，警示条与「待确认」里的这一项立刻消失，不用等重新拉取。
      setConflictStatus("none");
      setConflictDetail(undefined);
      setSaveNotice(saved && typeof saved === "object" && saved.notice ? saved.notice : null);
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
    setVisibleAfterChapter(savedVisibleAfterChapter);
    setVisibleUntilChapter(savedVisibleUntilChapter);
    setAfterChapterInput(chapterInputText(savedVisibleAfterChapter));
    setUntilChapterInput(chapterInputText(savedVisibleUntilChapter));
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
      if (restored && "visibleAfterChapter" in restored) {
        setVisibleAfterChapter(restored.visibleAfterChapter ?? null);
        setSavedVisibleAfterChapter(restored.visibleAfterChapter ?? null);
        setAfterChapterInput(chapterInputText(restored.visibleAfterChapter));
      }
      if (restored && "visibleUntilChapter" in restored) {
        setVisibleUntilChapter(restored.visibleUntilChapter ?? null);
        setSavedVisibleUntilChapter(restored.visibleUntilChapter ?? null);
        setUntilChapterInput(chapterInputText(restored.visibleUntilChapter));
      }
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

  // ── 演变台账 / 依赖 / 关系的写入动作 ──────────────────────────────────

  async function handleAddProgression() {
    if (!bookId || progressionSaving) return;
    const fieldKey = progressionForm.fieldKey.trim();
    const newValue = progressionForm.newValue.trim();
    if (!fieldKey || !newValue) {
      setProgressionError("字段名和新值都要填。");
      return;
    }
    const chapter = progressionForm.chapterNumber.trim() === "" ? null : Number(progressionForm.chapterNumber);
    if (chapter !== null && (!Number.isInteger(chapter) || chapter < 1)) {
      setProgressionError("章号必须是正整数，或留空。");
      return;
    }
    setProgressionSaving(true);
    setProgressionError(null);
    try {
      await fetchJson<{ progression?: ProgressionRecord }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/progressions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fieldKey,
            newValue,
            oldValue: progressionForm.oldValue.trim() || null,
            chapterNumber: chapter,
            description: progressionForm.description.trim() || null,
          }),
        },
      );
      setProgressionForm({ chapterNumber: "", fieldKey: "", oldValue: "", newValue: "", description: "" });
      await loadProgressions();
    } catch (cause) {
      setProgressionError(cause instanceof Error ? cause.message : "新增演变记录失败");
    } finally {
      setProgressionSaving(false);
    }
  }

  async function handleAddDependency(targetEntryId: string) {
    if (!bookId || structureBusy) return;
    setStructureBusy(true);
    setStructureError(null);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceEntryId: entry.id, targetEntryId, relationType: "references" }),
      });
      setStructurePicker(null);
      setStructureSearch("");
      setStructureResults([]);
      await loadStructure();
    } catch (cause) {
      setStructureError(cause instanceof Error ? cause.message : "添加依赖失败");
    } finally {
      setStructureBusy(false);
    }
  }

  async function handleRemoveDependency(depId: string) {
    if (!bookId || structureBusy) return;
    setStructureBusy(true);
    setStructureError(null);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/dependencies/${encodeURIComponent(depId)}`, { method: "DELETE" });
      await loadStructure();
    } catch (cause) {
      setStructureError(cause instanceof Error ? cause.message : "移除依赖失败");
    } finally {
      setStructureBusy(false);
    }
  }

  async function handleAddRelation(targetEntryId: string) {
    if (!bookId || structureBusy) return;
    const relationType = relationTypeInput.trim();
    if (!relationType) {
      setStructureError("关系类型要填（如：师徒 / 敌对 / 隶属）。");
      return;
    }
    setStructureBusy(true);
    setStructureError(null);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEntryId: entry.id,
          targetEntryId,
          relationType,
          ...(relationLabelInput.trim() ? { label: relationLabelInput.trim() } : {}),
        }),
      });
      setStructurePicker(null);
      setStructureSearch("");
      setStructureResults([]);
      setRelationLabelInput("");
      await loadStructure();
    } catch (cause) {
      setStructureError(cause instanceof Error ? cause.message : "添加关系失败");
    } finally {
      setStructureBusy(false);
    }
  }

  async function handleRemoveRelation(relationId: string) {
    if (!bookId || structureBusy) return;
    setStructureBusy(true);
    setStructureError(null);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/relations/${encodeURIComponent(relationId)}`, { method: "DELETE" });
      await loadStructure();
    } catch (cause) {
      setStructureError(cause instanceof Error ? cause.message : "移除关系失败");
    } finally {
      setStructureBusy(false);
    }
  }

  function searchEntriesForStructure(query: string) {
    setStructureSearch(query);
    if (!query.trim() || !bookId) {
      setStructureResults([]);
      return;
    }
    fetchJson<{ results?: RelatedEntryItem[] }>(`/api/books/${encodeURIComponent(bookId)}/jingwei/search?q=${encodeURIComponent(query)}`)
      .then((data) => setStructureResults((Array.isArray(data.results) ? data.results : []).filter((item) => item.id !== entry.id).slice(0, 8)))
      .catch(() => setStructureResults([]));
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
      {saveNotice && !isEditing && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="status" data-testid="jingwei-save-notice">
          {saveNotice}
        </div>
      )}
      {conflictStatus === "pending" && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="alert">
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
        <Button variant={activeTab === "progressions" ? "default" : "ghost"} size="xs" onClick={() => setActiveTab("progressions")}>
          <GitBranch className="size-3 mr-1" />演变
          {progressions.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-2xs px-1 py-0">{progressions.length}</Badge>
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
              <p className="text-xs mt-1">设定条目之间的引用；剧情里的关系变化在章后事实里看</p>
            </div>
          )}

          {/* 结构化依赖：依赖谁 / 被谁依赖。与上面的 relatedEntryIds 简单引用并存。 */}
          {isJingweiEntry && (
            <section className="space-y-2 rounded-md border border-border/60 px-3 py-2.5" data-testid="jingwei-dependencies">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">结构化依赖</span>
                <span className="text-2xs text-muted-foreground">「依赖谁」的方向写入数据库，供上下文装配与影响面分析使用</span>
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => { setStructurePicker((current) => (current === "dependency" ? null : "dependency")); setStructureSearch(""); setStructureResults([]); }}
                  disabled={structureBusy}
                >
                  <Plus className="size-3 mr-1" />添加依赖
                </Button>
              </div>
              {structureError ? (
                <p className="text-2xs text-destructive" role="alert">{structureError}</p>
              ) : null}
              {structurePicker === "dependency" ? (
                <StructurePicker
                  label="搜索被依赖的条目"
                  query={structureSearch}
                  results={structureResults}
                  onQueryChange={searchEntriesForStructure}
                  onPick={(item) => void handleAddDependency(item.id)}
                  disabled={structureBusy}
                />
              ) : null}
              {structureLoading ? (
                <p className="flex items-center gap-1 text-2xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />正在加载依赖…</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <DependencyColumn
                    title="依赖谁"
                    emptyText="还没有依赖任何条目"
                    items={dependsOn.map((item) => ({
                      key: item.depId,
                      title: item.title,
                      entryId: item.targetEntryId,
                      relationType: item.relationType,
                      canRemove: true,
                    }))}
                    onNavigate={onNavigateToEntry}
                    onRemove={(key) => void handleRemoveDependency(key)}
                    removeLabel="移除依赖"
                    disabled={structureBusy}
                  />
                  <DependencyColumn
                    title="被谁依赖"
                    emptyText="还没有条目依赖它"
                    items={dependedBy.map((item) => ({
                      key: item.depId,
                      title: item.title,
                      entryId: item.sourceEntryId,
                      relationType: item.relationType,
                      canRemove: true,
                    }))}
                    onNavigate={onNavigateToEntry}
                    onRemove={(key) => void handleRemoveDependency(key)}
                    removeLabel="移除依赖"
                    disabled={structureBusy}
                  />
                </div>
              )}
            </section>
          )}

          {/* 静态关系：带关系类型（师徒 / 敌对 / 隶属）的双向档案。 */}
          {isJingweiEntry && (
            <section className="space-y-2 rounded-md border border-border/60 px-3 py-2.5" data-testid="jingwei-relations">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">静态关系</span>
                <Input
                  value={relationTypeInput}
                  onChange={(event) => setRelationTypeInput(event.target.value)}
                  aria-label="关系类型"
                  placeholder="关系类型（师徒 / 敌对 / 隶属）"
                  className="h-7 w-48 text-2xs"
                />
                <Input
                  value={relationLabelInput}
                  onChange={(event) => setRelationLabelInput(event.target.value)}
                  aria-label="关系说明"
                  placeholder="补充说明（可选）"
                  className="h-7 w-40 text-2xs"
                />
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => { setStructurePicker((current) => (current === "relation" ? null : "relation")); setStructureSearch(""); setStructureResults([]); }}
                  disabled={structureBusy}
                >
                  <Network className="size-3 mr-1" />添加关系
                </Button>
              </div>
              {structurePicker === "relation" ? (
                <StructurePicker
                  label="搜索关系另一端的条目"
                  query={structureSearch}
                  results={structureResults}
                  onQueryChange={searchEntriesForStructure}
                  onPick={(item) => void handleAddRelation(item.id)}
                  disabled={structureBusy}
                />
              ) : null}
              {relations.length === 0 ? (
                <p className="text-2xs text-muted-foreground">还没有登记静态关系</p>
              ) : (
                <ul className="space-y-1">
                  {relations.map((relation) => {
                    const outgoing = relation.source_entry_id === entry.id;
                    const otherId = outgoing ? relation.target_entry_id : relation.source_entry_id;
                    const otherTitle = entryTitles[otherId] ?? otherId;
                    return (
                      <li
                        key={relation.id}
                        className="nf-surface-sub flex items-center gap-2 px-2 py-1 text-2xs"
                        data-testid="jingwei-relation-row"
                      >
                        <Badge variant="secondary" className="text-2xs px-1.5 py-0">{relation.relation_type}</Badge>
                        <span className="text-muted-foreground">{outgoing ? "指向" : "来自"}</span>
                        <button
                          type="button"
                          onClick={() => onNavigateToEntry?.(otherId)}
                          className="min-w-0 truncate text-left hover:underline"
                          title={`跳转到「${otherTitle}」`}
                        >
                          {otherTitle}
                        </button>
                        {relation.label ? <span className="truncate text-muted-foreground">{relation.label}</span> : null}
                        <button
                          type="button"
                          onClick={() => void handleRemoveRelation(relation.id)}
                          className="ml-auto text-muted-foreground hover:text-destructive"
                          aria-label={`移除关系 ${relation.relation_type}`}
                          disabled={structureBusy}
                        >
                          <X className="size-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {/* ─── Tab: 演变（字段演变台账） ─────────────────────────────────── */}
      {activeTab === "progressions" && (
        <div className="py-4 px-1 space-y-3" data-testid="jingwei-progressions">
          <p className="text-xs text-muted-foreground">
            条目随剧情推进的字段变化：章号、字段名、旧值 → 新值。留空章号表示不绑具体章节。
          </p>
          <div className="grid gap-2 rounded-md border border-border/60 px-3 py-2.5 sm:grid-cols-2">
            <label className="text-2xs text-muted-foreground">
              章号
              <Input
                type="number"
                min={1}
                value={progressionForm.chapterNumber}
                onChange={(event) => setProgressionForm((current) => ({ ...current, chapterNumber: event.target.value }))}
                placeholder="第几章发生"
                className="mt-1 h-7 text-xs"
              />
            </label>
            <label className="text-2xs text-muted-foreground">
              字段名
              <Input
                value={progressionForm.fieldKey}
                onChange={(event) => setProgressionForm((current) => ({ ...current, fieldKey: event.target.value }))}
                placeholder="如：realm / 当前位置"
                className="mt-1 h-7 text-xs"
              />
            </label>
            <label className="text-2xs text-muted-foreground">
              旧值
              <Input
                value={progressionForm.oldValue}
                onChange={(event) => setProgressionForm((current) => ({ ...current, oldValue: event.target.value }))}
                placeholder="变化前（可空）"
                className="mt-1 h-7 text-xs"
              />
            </label>
            <label className="text-2xs text-muted-foreground">
              新值
              <Input
                value={progressionForm.newValue}
                onChange={(event) => setProgressionForm((current) => ({ ...current, newValue: event.target.value }))}
                placeholder="变化后"
                className="mt-1 h-7 text-xs"
              />
            </label>
            <label className="text-2xs text-muted-foreground sm:col-span-2">
              说明
              <Input
                value={progressionForm.description}
                onChange={(event) => setProgressionForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="为什么变（可空）"
                className="mt-1 h-7 text-xs"
              />
            </label>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button size="xs" onClick={() => void handleAddProgression()} disabled={progressionSaving || !progressionForm.fieldKey.trim() || !progressionForm.newValue.trim()}>
                {progressionSaving ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Plus className="size-3 mr-1" />}
                记一条演变
              </Button>
              {progressionError ? <span className="text-2xs text-destructive" role="alert">{progressionError}</span> : null}
            </div>
          </div>

          {progressionLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />正在加载演变记录…
            </div>
          ) : progressions.length > 0 ? (
            <ol className="relative space-y-3 pl-4">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden="true" />
              {progressions.map((progression) => (
                <li key={progression.id} className="relative flex items-start gap-3" data-testid="jingwei-progression-row">
                  <span className="absolute -left-4 top-1.5 size-[7px] rounded-full bg-primary ring-2 ring-background" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-2xs px-1.5 py-0">
                        {typeof progression.chapter_number === "number" ? `第 ${progression.chapter_number} 章` : "未标章号"}
                      </Badge>
                      <span className="text-xs font-medium">{progression.field_key}</span>
                      <span className="text-2xs text-muted-foreground">
                        {progression.old_value ? `${progression.old_value} → ` : "→ "}
                        <span className="text-foreground">{progression.new_value}</span>
                      </span>
                    </div>
                    {progression.description ? (
                      <p className="mt-0.5 text-2xs text-muted-foreground">{progression.description}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="py-6 text-center text-muted-foreground">
              <GitBranch className="mx-auto mb-2 size-8 opacity-30" />
              <p className="text-sm">还没有演变记录</p>
              <p className="mt-1 text-xs">条目随剧情变化时在这里登记，写作时按章号取当时的设定</p>
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
                <Badge variant="outline" className="text-xs border-warning/40 bg-warning/10 text-warning">待确认</Badge>
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
                  <dd className="min-w-0 flex-1 whitespace-pre-line text-sm">{fieldValueToDisplay(fields[field.key], field)}</dd>
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
                <SelectItem value="reference">参考（仅完整上下文）</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">核心条目每次写作都会带上；参考条目只在完整上下文时带上。</p>
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

              {/* 章节可见性窗口：作者直接填「第 N 章起 / 至第 M 章」，留空 = 不限 */}
              <fieldset className="space-y-2 rounded-md border border-border/60 px-3 py-2" data-testid="jingwei-chapter-window">
                <legend className="px-1 text-xs text-muted-foreground">章节可见性窗口</legend>
                <p className="text-2xs text-muted-foreground">留空表示不限；只有「可见性 = 追踪（按章节窗口）」时才影响注入。</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="jingwei-editor-visible-after" className="text-xs text-muted-foreground mb-1 block">生效起始章</label>
                    <Input
                      id="jingwei-editor-visible-after"
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={afterChapterInput}
                      onChange={(event) => {
                        const raw = event.target.value;
                        setAfterChapterInput(raw);
                        const parsed = parseChapterWindowInput(raw);
                        if (parsed === undefined) return;
                        setVisibleAfterChapter(parsed);
                      }}
                      onBlur={() => setAfterChapterInput(chapterInputText(visibleAfterChapter))}
                      placeholder="第 N 章起"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="jingwei-editor-visible-until" className="text-xs text-muted-foreground mb-1 block">退场截止章</label>
                    <Input
                      id="jingwei-editor-visible-until"
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={untilChapterInput}
                      onChange={(event) => {
                        const raw = event.target.value;
                        setUntilChapterInput(raw);
                        const parsed = parseChapterWindowInput(raw);
                        if (parsed === undefined) return;
                        setVisibleUntilChapter(parsed);
                      }}
                      onBlur={() => setUntilChapterInput(chapterInputText(visibleUntilChapter))}
                      placeholder="至第 M 章"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </fieldset>

              {/* 别名 */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">别名</label>
                <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5">
                  {aliases.map((alias, index) => (
                    <Badge key={`${alias}-${index}`} variant="secondary" className="text-2xs gap-0.5 pr-1">
                      {alias}
                      <button type="button" aria-label={`删除别名 ${alias}`} onClick={() => setAliases((prev) => prev.filter((_, i) => i !== index))} className="ml-0.5 hover:text-destructive">
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
                <p className="mt-1 text-xs text-muted-foreground">写作时按别名也能找到这个条目，多个别名回车分隔。</p>
              </div>
            </>
          )}

          {/* 操作栏 */}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Save className="size-3.5 mr-1" />}
              保存
            </Button>

            {dirty && <Badge className="text-2xs bg-warning/10 text-warning border-warning/20">未保存</Badge>}

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
