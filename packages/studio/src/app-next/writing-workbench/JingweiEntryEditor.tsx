import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Save, Trash2, Loader2 } from "lucide-react";

export interface JingweiEntryData {
  id: string;
  title: string;
  contentMd: string;
  sectionId?: string;
  updatedAt?: string;
}

export interface JingweiEntryEditorProps {
  entry: JingweiEntryData;
  sectionLabel?: string;
  onSave: (entryId: string, payload: { title: string; contentMd: string }) => Promise<void>;
  onDelete?: (entryId: string) => Promise<void>;
}

export function JingweiEntryEditor({ entry, sectionLabel, onSave, onDelete }: JingweiEntryEditorProps) {
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.contentMd);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = title !== entry.title || content !== entry.contentMd;

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(entry.id, { title: title.trim(), contentMd: content });
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

  return (
    <section className="resource-viewer" data-resource-kind="jingwei-entry" data-testid="jingwei-entry-editor">
      <header className="resource-viewer__header flex items-center gap-2 mb-3">
        <p className="text-xs text-muted-foreground">经纬资料</p>
        {sectionLabel && <Badge variant="secondary" className="text-[10px]">{sectionLabel}</Badge>}
        {entry.updatedAt && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            更新于 {new Date(entry.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </header>

      {/* 标题编辑 */}
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

        {/* 内容编辑 */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">内容（Markdown）</label>
          <Textarea
            aria-label="经纬条目内容"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder="在此编辑经纬资料内容..."
            className="text-sm font-mono"
          />
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
    </section>
  );
}
