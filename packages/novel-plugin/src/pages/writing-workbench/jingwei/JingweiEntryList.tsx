import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Loader2, CheckSquare, Square, CheckCircle2 } from "lucide-react";
import type { JingweiEntry } from "./hooks/useJingweiEntries";
import { getCategorySchema } from "./category-schemas";

interface JingweiEntryListProps {
  category: string;
  entries: JingweiEntry[];
  loading: boolean;
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
  onCreateEntry: (title: string) => void;
  onRefresh?: () => void;
  bookId: string;
}

const VISIBILITY_LABELS: Record<string, string> = {
  global: "全局",
  tracked: "追踪",
  nested: "嵌套",
};

type VisibilityRule = "global" | "tracked" | "nested";

export function JingweiEntryList({ category, entries, loading, selectedEntryId, onSelectEntry, onCreateEntry, onRefresh, bookId }: JingweiEntryListProps) {
  const [search, setSearch] = useState("");
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const schema = getCategorySchema(category);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter((e) => e.title.toLowerCase().includes(q));
  }, [entries, search]);

  function handleCreate() {
    onCreateEntry("新条目");
  }

  function toggleMultiSelect() {
    if (multiSelect) {
      setSelectedIds(new Set());
    }
    setMultiSelect(!multiSelect);
  }

  function toggleSelect(entryId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  const handleBatchVisibility = useCallback(async (rule: VisibilityRule) => {
    if (selectedIds.size === 0) return;
    setBatchLoading(true);
    try {
      const promises = Array.from(selectedIds).map((entryId) =>
        fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: rule }),
        })
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      setMultiSelect(false);
      onRefresh?.();
    } finally {
      setBatchLoading(false);
    }
  }, [selectedIds, bookId]);

  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 p-2 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium truncate">{schema?.name ?? category}</h3>
          <div className="flex items-center gap-0.5">
            <Button
              size="xs"
              variant={multiSelect ? "default" : "ghost"}
              onClick={toggleMultiSelect}
              title={multiSelect ? "退出多选" : "多选模式"}
            >
              <CheckSquare className="size-3" />
            </Button>
            <Button size="xs" variant="ghost" onClick={handleCreate} title="新建条目">
              <Plus className="size-3" />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto p-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-xs text-muted-foreground">
              {search ? "无匹配结果" : "暂无条目"}
            </p>
            {!search && (
              <Button size="xs" variant="ghost" className="mt-2" onClick={handleCreate}>
                <Plus className="size-3 mr-1" />
                创建第一个条目
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((entry) => {
              const active = selectedEntryId === entry.id;
              const checked = selectedIds.has(entry.id);
              const firstField = getFirstDescription(entry);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => multiSelect ? toggleSelect(entry.id) : onSelectEntry(entry.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                      active && !multiSelect
                        ? "bg-primary/10 border border-primary/20"
                        : checked
                          ? "bg-accent/50 border border-accent"
                          : "hover:bg-muted/50 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {multiSelect && (
                        checked
                          ? <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                          : <Square className="size-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-xs font-medium truncate flex-1">{entry.title}</span>
                      <Badge variant="secondary" className="text-[9px] shrink-0">
                        {VISIBILITY_LABELS[entry.visibility] ?? entry.visibility}
                      </Badge>
                    </div>
                    {firstField && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{firstField}</p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Batch action bar */}
      {multiSelect && selectedIds.size > 0 && (
        <div className="shrink-0 border-t border-border p-2 space-y-1.5 bg-muted/30">
          <p className="text-[10px] text-muted-foreground">已选 {selectedIds.size} 项</p>
          <div className="flex items-center gap-1">
            <Button size="xs" variant="outline" disabled={batchLoading} onClick={() => handleBatchVisibility("global")}>
              全局
            </Button>
            <Button size="xs" variant="outline" disabled={batchLoading} onClick={() => handleBatchVisibility("tracked")}>
              追踪
            </Button>
            <Button size="xs" variant="outline" disabled={batchLoading} onClick={() => handleBatchVisibility("nested")}>
              嵌套
            </Button>
            {batchLoading && <Loader2 className="size-3 animate-spin ml-1" />}
          </div>
        </div>
      )}
    </div>
  );
}

/** Extract first meaningful text from entry fields for preview */
function getFirstDescription(entry: JingweiEntry): string {
  const fields = entry.fields;
  if (!fields) return "";
  for (const key of ["description", "summary", "personality", "effect", "goal"]) {
    const val = fields[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return "";
}
