import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Save, Trash2, Loader2, X } from "lucide-react";
import { getCategorySchema, type CategoryFieldSchema, type CategoryVisibility } from "./category-schemas";
import type { JingweiEntry } from "./hooks/useJingweiEntries";
import { JingweiProgressions } from "./JingweiProgressions";

interface JingweiEntryFormProps {
  entry: JingweiEntry;
  bookId?: string;
  onSave: (entryId: string, payload: {
    title: string;
    contentMd?: string;
    fields: Record<string, unknown>;
    visibility: CategoryVisibility;
    aliases?: string[];
    relatedEntryIds?: string[];
    visibleAfterChapter?: number | null;
    visibleUntilChapter?: number | null;
  }) => Promise<boolean>;
  onDelete: (entryId: string) => Promise<boolean>;
  onClose: () => void;
}

const VISIBILITY_OPTIONS = [
  { value: "global", label: "全局可见" },
  { value: "tracked", label: "追踪可见" },
  { value: "nested", label: "嵌套可见" },
];

const PRIORITY_TIER_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "core", label: "核心" },
  { value: "relevant", label: "相关" },
  { value: "reference", label: "参考" },
];

export function JingweiEntryForm({ entry, bookId, onSave, onDelete, onClose }: JingweiEntryFormProps) {
  const schema = getCategorySchema(entry.category);
  const fields = schema?.fields ?? [];

  // Only render select/multi-select/tags fields in metadata row
  const metadataFields = useMemo(
    () => fields.filter((f) => f.type === "select" || f.type === "multi-select" || f.type === "tags"),
    [fields]
  );

  const [title, setTitle] = useState(entry.title);
  const [contentMd, setContentMd] = useState(entry.contentMd ?? "");
  const [formData, setFormData] = useState<Record<string, unknown>>(entry.fields ?? {});
  const [visibility, setVisibility] = useState<CategoryVisibility>(entry.visibility);
  const [priorityTier, setPriorityTier] = useState<"auto" | "core" | "relevant" | "reference">(entry.priorityTier ?? "auto");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when entry changes
  useEffect(() => {
    setTitle(entry.title);
    setContentMd(entry.contentMd ?? "");
    setFormData(entry.fields ?? {});
    setVisibility(entry.visibility);
    setPriorityTier(entry.priorityTier ?? "auto");
    setError(null);
    setConfirmDelete(false);
  }, [entry.id, entry.title, entry.contentMd, entry.fields, entry.visibility]);

  const dirty = useMemo(() => {
    if (title !== entry.title) return true;
    if (contentMd !== (entry.contentMd ?? "")) return true;
    if (visibility !== entry.visibility) return true;
    if (priorityTier !== (entry.priorityTier ?? "auto")) return true;
    return JSON.stringify(formData) !== JSON.stringify(entry.fields ?? {});
  }, [title, contentMd, formData, visibility, priorityTier, entry]);

  function setField(key: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const ok = await onSave(entry.id, {
      title: title.trim(),
      contentMd,
      fields: formData,
      visibility,
    });
    if (!ok) setError("保存失败");
    setSaving(false);
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    const ok = await onDelete(entry.id);
    if (!ok) setError("删除失败");
    setDeleting(false);
    setConfirmDelete(false);
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0 border-l border-border">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-sm h-8 font-medium flex-1"
          placeholder="条目标题"
        />
        <Button size="xs" variant="ghost" onClick={onClose} title="关闭">
          <X className="size-3" />
        </Button>
      </div>

      {/* Metadata tag row */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border flex-wrap">
        <SimpleSelect
          value={visibility}
          onValueChange={(v) => setVisibility(v as CategoryVisibility)}
          options={VISIBILITY_OPTIONS}
          className="w-28"
          aria-label="可见性"
        />
        <SimpleSelect
          value={priorityTier}
          onValueChange={(v) => setPriorityTier(v as "auto" | "core" | "relevant" | "reference")}
          options={PRIORITY_TIER_OPTIONS}
          className="w-24"
          aria-label="优先级"
        />
        {metadataFields.map((field) => (
          <InlineFieldRenderer
            key={field.key}
            field={field}
            value={formData[field.key]}
            onChange={(val) => setField(field.key, val)}
          />
        ))}
      </div>

      {/* Markdown editor — always visible, flex-1 */}
      <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
        <Textarea
          value={contentMd}
          onChange={(e) => setContentMd(e.target.value)}
          className="font-mono text-sm flex-1 min-h-[300px] resize-none"
          placeholder="在此编写条目内容（支持 Markdown 格式）..."
        />

        {/* Progressions section */}
        {bookId && (
          <JingweiProgressions bookId={bookId} entryId={entry.id} category={entry.category} />
        )}
      </div>

      {/* Footer actions */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-border">
        <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Save className="size-3.5 mr-1" />}
          保存
        </Button>
        {dirty && <Badge className="text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/20">未保存</Badge>}
        <span className="flex-1" />
        {error && <span className="text-xs text-destructive">{error}</span>}
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-destructive">确认删除？</span>
            <Button size="xs" variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? <Loader2 className="size-3 animate-spin" /> : "确认"}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button>
          </div>
        ) : (
          <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(true)} title="删除条目">
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Inline renderer for select/multi-select/tags fields in the metadata row */
function InlineFieldRenderer({ field, value, onChange }: { field: CategoryFieldSchema; value: unknown; onChange: (val: unknown) => void }) {
  const strVal = typeof value === "string" ? value : (value == null ? "" : String(value));

  switch (field.type) {
    case "select":
      return (
        <SimpleSelect
          value={strVal}
          onValueChange={(v) => onChange(v)}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          placeholder={field.label}
          className="w-28"
          aria-label={field.label}
        />
      );

    case "multi-select":
      return (
        <Input
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          className="text-xs h-7 w-36"
          placeholder={field.label}
          title={field.helpText ?? "逗号分隔多个选项"}
        />
      );

    case "tags":
      return <InlineTagsField field={field} value={value} onChange={onChange} />;

    default:
      return null;
  }
}

/** Inline tags field for metadata row */
function InlineTagsField({ field, value, onChange }: { field: CategoryFieldSchema; value: unknown; onChange: (val: unknown) => void }) {
  const tags: string[] = Array.isArray(value) ? value : (typeof value === "string" && value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const [input, setInput] = useState("");

  function addTag() {
    const tag = input.trim();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  }

  return (
    <div className="inline-flex items-center gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="text-[10px] gap-0.5">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter((t) => t !== tag))} className="ml-0.5 hover:text-destructive">
            <X className="size-2.5" />
          </button>
        </Badge>
      ))}
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
        placeholder={field.label}
        className="text-xs h-7 w-24"
      />
    </div>
  );
}
