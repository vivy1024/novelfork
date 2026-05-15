/**
 * JingweiProgressions — 演变记录面板
 * 显示条目字段随章节变化的历史记录
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, ArrowRight } from "lucide-react";
import { useJingweiProgressions } from "./hooks/useJingweiProgressions";
import { getCategorySchema } from "./category-schemas";

interface JingweiProgressionsProps {
  bookId: string;
  entryId: string;
  category: string;
}

export function JingweiProgressions({ bookId, entryId, category }: JingweiProgressionsProps) {
  const { progressions, loading, addProgression } = useJingweiProgressions(bookId, entryId);
  const [showForm, setShowForm] = useState(false);
  const [fieldKey, setFieldKey] = useState("");
  const [oldValue, setOldValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const schema = getCategorySchema(category);
  const fieldOptions = schema?.fields ?? [];

  async function handleSubmit() {
    if (!fieldKey.trim() || !newValue.trim()) return;
    setSubmitting(true);
    const ok = await addProgression({
      fieldKey: fieldKey.trim(),
      oldValue: oldValue.trim() || undefined,
      newValue: newValue.trim(),
      chapterNumber: chapterNumber ? Number(chapterNumber) : undefined,
      description: description.trim() || undefined,
    });
    if (ok) {
      setFieldKey("");
      setOldValue("");
      setNewValue("");
      setChapterNumber("");
      setDescription("");
      setShowForm(false);
    }
    setSubmitting(false);
  }

  function getFieldLabel(key: string): string {
    return fieldOptions.find((f) => f.key === key)?.label ?? key;
  }

  return (
    <div className="border-t border-border pt-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-muted-foreground">演变记录</h4>
        <Button size="xs" variant="ghost" onClick={() => setShowForm(!showForm)}>
          <Plus className="size-3 mr-0.5" />
          添加演变
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="space-y-2 mb-3 p-2 rounded-md border border-border bg-muted/30">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">字段</label>
              <select
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value)}
                className="w-full h-7 text-xs rounded-md border border-input bg-background px-2"
              >
                <option value="">选择字段</option>
                {fieldOptions.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">章节号</label>
              <Input
                type="number"
                value={chapterNumber}
                onChange={(e) => setChapterNumber(e.target.value)}
                className="h-7 text-xs"
                placeholder="可选"
                min={1}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">旧值</label>
              <Input value={oldValue} onChange={(e) => setOldValue(e.target.value)} className="h-7 text-xs" placeholder="可选" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">新值</label>
              <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} className="h-7 text-xs" placeholder="必填" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">描述</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-7 text-xs" placeholder="变化原因（可选）" />
          </div>
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={() => setShowForm(false)}>取消</Button>
            <Button size="xs" disabled={!fieldKey || !newValue || submitting} onClick={handleSubmit}>
              {submitting ? <Loader2 className="size-3 animate-spin" /> : "保存"}
            </Button>
          </div>
        </div>
      )}

      {/* Progressions list */}
      {loading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        </div>
      ) : progressions.length === 0 ? (
        <p className="text-[10px] text-muted-foreground text-center py-2">暂无演变记录</p>
      ) : (
        <ul className="space-y-1.5 max-h-40 overflow-y-auto">
          {progressions.map((p) => (
            <li key={p.id} className="flex items-start gap-1.5 text-[10px] p-1.5 rounded bg-muted/30">
              {p.chapterNumber != null && (
                <Badge variant="secondary" className="text-[9px] px-1 shrink-0">
                  第{p.chapterNumber}章
                </Badge>
              )}
              <div className="flex-1 min-w-0">
                <span className="font-medium">{getFieldLabel(p.fieldKey)}</span>
                <span className="text-muted-foreground mx-1">
                  {p.oldValue && <span className="line-through">{p.oldValue}</span>}
                  {p.oldValue && <ArrowRight className="inline size-2.5 mx-0.5" />}
                  <span className="text-foreground">{p.newValue}</span>
                </span>
                {p.description && (
                  <p className="text-muted-foreground mt-0.5">{p.description}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
