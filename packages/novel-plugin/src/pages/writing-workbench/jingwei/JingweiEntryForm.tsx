import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Save, Trash2, Loader2, X, Plus } from "lucide-react";
import { getCategorySchema, type CategoryFieldSchema, type CategoryVisibility } from "./category-schemas";
import type { JingweiEntry } from "./hooks/useJingweiEntries";
import { JingweiProgressions } from "./JingweiProgressions";

interface JingweiEntryFormProps {
  entry: JingweiEntry;
  bookId?: string;
  onSave: (entryId: string, payload: {
    title: string;
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

export function JingweiEntryForm({ entry, bookId, onSave, onDelete, onClose }: JingweiEntryFormProps) {
  const schema = getCategorySchema(entry.category);
  const fields = schema?.fields ?? [];

  const [title, setTitle] = useState(entry.title);
  const [formData, setFormData] = useState<Record<string, unknown>>(entry.fields ?? {});
  const [visibility, setVisibility] = useState<CategoryVisibility>(entry.visibility);
  const [aliases, setAliases] = useState<string[]>(entry.aliases ?? []);
  const [aliasInput, setAliasInput] = useState("");
  const [visibleAfterChapter, setVisibleAfterChapter] = useState<number | null>(entry.visibleAfterChapter ?? null);
  const [visibleUntilChapter, setVisibleUntilChapter] = useState<number | null>(entry.visibleUntilChapter ?? null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when entry changes
  useEffect(() => {
    setTitle(entry.title);
    setFormData(entry.fields ?? {});
    setVisibility(entry.visibility);
    setAliases(entry.aliases ?? []);
    setAliasInput("");
    setVisibleAfterChapter(entry.visibleAfterChapter ?? null);
    setVisibleUntilChapter(entry.visibleUntilChapter ?? null);
    setError(null);
    setConfirmDelete(false);
  }, [entry.id, entry.title, entry.fields, entry.visibility, entry.aliases, entry.visibleAfterChapter, entry.visibleUntilChapter]);

  const dirty = useMemo(() => {
    if (title !== entry.title) return true;
    if (visibility !== entry.visibility) return true;
    if (JSON.stringify(aliases) !== JSON.stringify(entry.aliases ?? [])) return true;
    if (visibleAfterChapter !== (entry.visibleAfterChapter ?? null)) return true;
    if (visibleUntilChapter !== (entry.visibleUntilChapter ?? null)) return true;
    return JSON.stringify(formData) !== JSON.stringify(entry.fields ?? {});
  }, [title, formData, visibility, aliases, visibleAfterChapter, visibleUntilChapter, entry]);

  function setField(key: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const ok = await onSave(entry.id, {
      title: title.trim(),
      fields: formData,
      visibility,
      aliases,
      visibleAfterChapter,
      visibleUntilChapter,
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
        <h3 className="text-sm font-medium truncate flex-1">{entry.title}</h3>
        <Button size="xs" variant="ghost" onClick={onClose} title="关闭">
          <X className="size-3" />
        </Button>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Title */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">标题</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-sm h-8" />
        </div>

        {/* Visibility */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">可见性</label>
          <SimpleSelect
            value={visibility}
            onValueChange={(v) => setVisibility(v as CategoryVisibility)}
            options={VISIBILITY_OPTIONS}
            className="w-full"
            aria-label="可见性"
          />
        </div>

        {/* Chapter visibility range */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">可见起始章节</label>
            <Input
              type="number"
              min={0}
              placeholder="留空=始终"
              value={visibleAfterChapter ?? ""}
              onChange={(e) => setVisibleAfterChapter(e.target.value ? Number(e.target.value) : null)}
              className="text-sm h-8"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">可见截止章节</label>
            <Input
              type="number"
              min={0}
              placeholder="留空=永不过期"
              value={visibleUntilChapter ?? ""}
              onChange={(e) => setVisibleUntilChapter(e.target.value ? Number(e.target.value) : null)}
              className="text-sm h-8"
            />
          </div>
        </div>

        {/* Aliases */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">别名（用于 AI 上下文匹配）</label>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {aliases.map((alias, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] gap-0.5 pr-1">
                {alias}
                <button
                  type="button"
                  onClick={() => setAliases(aliases.filter((_, j) => j !== i))}
                  className="ml-0.5 hover:text-destructive"
                >
                  <X className="size-2.5" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-1">
            <Input
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && aliasInput.trim()) {
                  e.preventDefault();
                  setAliases([...aliases, aliasInput.trim()]);
                  setAliasInput("");
                }
              }}
              placeholder="输入别名后回车"
              className="text-sm h-7 flex-1"
            />
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!aliasInput.trim()}
              onClick={() => { setAliases([...aliases, aliasInput.trim()]); setAliasInput(""); }}
            >
              <Plus className="size-3" />
            </Button>
          </div>
        </div>

        {/* Dynamic fields */}
        {fields.map((field) => (
          <FieldRenderer
            key={field.key}
            field={field}
            value={formData[field.key]}
            onChange={(val) => setField(field.key, val)}
          />
        ))}

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

/** Render a single field based on its schema type */
function FieldRenderer({ field, value, onChange }: { field: CategoryFieldSchema; value: unknown; onChange: (val: unknown) => void }) {
  const strVal = typeof value === "string" ? value : (value == null ? "" : String(value));
  const numVal = typeof value === "number" ? value : (value ? Number(value) : undefined);

  switch (field.type) {
    case "text":
    case "relation":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <Input value={strVal} onChange={(e) => onChange(e.target.value)} className="text-sm h-8" placeholder={field.helpText} />
        </div>
      );

    case "textarea":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <Textarea value={strVal} onChange={(e) => onChange(e.target.value)} rows={3} className="text-sm" placeholder={field.helpText} />
        </div>
      );

    case "number":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <Input type="number" value={numVal ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)} className="text-sm h-8" />
        </div>
      );

    case "chapter":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <div className="flex items-center gap-1">
            <Input type="number" value={numVal ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)} className="text-sm h-8 w-24" min={1} />
            <span className="text-xs text-muted-foreground">章</span>
          </div>
        </div>
      );

    case "select":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <SimpleSelect
            value={strVal}
            onValueChange={(v) => onChange(v)}
            options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
            placeholder="请选择"
            className="w-full"
            aria-label={field.label}
          />
        </div>
      );

    case "multi-select":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <Input value={strVal} onChange={(e) => onChange(e.target.value)} className="text-sm h-8" placeholder="逗号分隔多个选项" />
        </div>
      );

    case "tags":
      return <TagsField field={field} value={value} onChange={onChange} />;

    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="rounded" />
          <label className="text-xs text-muted-foreground">{field.label}</label>
        </div>
      );

    default:
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{field.label}</label>
          <Input value={strVal} onChange={(e) => onChange(e.target.value)} className="text-sm h-8" />
        </div>
      );
  }
}

/** Tags field with badge display */
function TagsField({ field, value, onChange }: { field: CategoryFieldSchema; value: unknown; onChange: (val: unknown) => void }) {
  const tags: string[] = Array.isArray(value) ? value : (typeof value === "string" && value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const [input, setInput] = useState("");

  function addTag() {
    const tag = input.trim();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1 block">
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] gap-0.5">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 hover:text-destructive">
                <X className="size-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
        placeholder={field.helpText ?? "输入后回车添加"}
        className="text-sm h-7"
      />
    </div>
  );
}
