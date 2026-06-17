import { useState, useMemo, useEffect, useCallback } from "react";
import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JingweiCategorySidebar } from "./JingweiCategorySidebar";
import { JingweiEntryList } from "./JingweiEntryList";
import { JingweiEntryTree } from "./JingweiEntryTree";
import { JingweiEntryForm } from "./JingweiEntryForm";
import { JingweiGraphView } from "./JingweiGraphView";
import { useJingweiEntries } from "./hooks/useJingweiEntries";
import { CATEGORY_SCHEMAS, type CategoryVisibility } from "./category-schemas";
import { PresetsPanel } from "../PresetsPanel";

/** Check if a category has relation-type fields (eligible for graph view) */
function categoryHasRelations(categoryId: string): boolean {
  const schema = CATEGORY_SCHEMAS.find((s) => s.id === categoryId);
  if (!schema) return false;
  return schema.fields.some((f) => f.type === "relation");
}

interface JingweiPanelProps {
  bookId: string;
}

export function JingweiPanel({ bookId }: JingweiPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState("characters");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(false);

  const { entries, loading, refresh, createEntry, updateEntry, deleteEntry } = useJingweiEntries(bookId, selectedCategory);

  // Fetch entry counts for ALL categories (for sidebar display)
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({});
  const fetchEntryCounts = useCallback(async () => {
    if (!bookId) return;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`);
      if (!res.ok) return;
      const data = await res.json();
      const allEntries: Array<{ category?: string }> = Array.isArray(data.entries) ? data.entries : [];
      const counts: Record<string, number> = {};
      for (const entry of allEntries) {
        if (entry.category) {
          counts[entry.category] = (counts[entry.category] ?? 0) + 1;
        }
      }
      setEntryCounts(counts);
    } catch { /* non-fatal */ }
  }, [bookId]);

  useEffect(() => { void fetchEntryCounts(); }, [fetchEntryCounts]);

  const selectedEntry = useMemo(() => {
    if (!selectedEntryId) return null;
    return entries.find((e) => e.id === selectedEntryId) ?? null;
  }, [entries, selectedEntryId]);

  // Check if entries have parent-child relationships
  const hasHierarchy = useMemo(() => {
    return entries.some((e) => (e as { parentId?: string | null }).parentId);
  }, [entries]);

  const hasRelations = categoryHasRelations(selectedCategory);

  function handleSelectCategory(categoryId: string) {
    setSelectedCategory(categoryId);
    setSelectedEntryId(null);
    setShowGraph(false);
  }

  async function handleCreateEntry(title: string, parentId?: string) {
    const entry = await createEntry(title, { name: title }, parentId);
    if (entry) setSelectedEntryId(entry.id);
  }

  async function handleMoveEntry(entryId: string, newParentId: string | null) {
    try {
      const res = await fetch(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}/move`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId: newParentId }),
        },
      );
      if (res.ok) {
        await updateEntry(entryId, {});
      }
    } catch { /* ignore */ }
  }

  async function handleSave(entryId: string, payload: { title: string; contentMd?: string; fields: Record<string, unknown>; visibility: CategoryVisibility; aliases?: string[]; relatedEntryIds?: string[]; visibleAfterChapter?: number | null; visibleUntilChapter?: number | null }) {
    return updateEntry(entryId, payload);
  }

  async function handleDelete(entryId: string) {
    const ok = await deleteEntry(entryId);
    if (ok && selectedEntryId === entryId) {
      setSelectedEntryId(null);
    }
    return ok;
  }

  return (
    <div className="flex h-full min-h-0" data-testid="jingwei-panel">
      {/* Left: Category sidebar */}
      <JingweiCategorySidebar
        selectedCategory={selectedCategory}
        onSelectCategory={handleSelectCategory}
        entryCounts={entryCounts}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Graph toggle — only for categories with relation fields */}
        {hasRelations && (
          <div className="shrink-0 flex items-center gap-2 border-b border-border px-3 py-1.5">
            <Button
              variant={showGraph ? "secondary" : "ghost"}
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={() => setShowGraph(!showGraph)}
            >
              <Network className="size-3" />
              {showGraph ? "返回列表" : "关系图谱"}
            </Button>
            {showGraph && <span className="text-[9px] text-muted-foreground">实验性</span>}
          </div>
        )}

        {/* Content: rules 分类显示预设面板 / graph / list */}
        {selectedCategory === "rules" ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <PresetsPanel bookId={bookId} />
          </div>
        ) : showGraph && hasRelations ? (
          <JingweiGraphView
            bookId={bookId}
            entries={entries}
            category={selectedCategory}
            onNodeClick={(entryId) => {
              setSelectedEntryId(entryId);
              setShowGraph(false);
            }}
          />
        ) : (
          <div className="flex-1 flex min-h-0">
            {hasHierarchy ? (
              <JingweiEntryTree
                category={selectedCategory}
                entries={entries}
                loading={loading}
                selectedEntryId={selectedEntryId}
                onSelectEntry={setSelectedEntryId}
                onCreateEntry={handleCreateEntry}
                onMoveEntry={handleMoveEntry}
                bookId={bookId}
              />
            ) : (
              <JingweiEntryList
                category={selectedCategory}
                entries={entries}
                loading={loading}
                selectedEntryId={selectedEntryId}
                onSelectEntry={setSelectedEntryId}
                onCreateEntry={(title) => handleCreateEntry(title)}
                onRefresh={refresh}
                bookId={bookId}
              />
            )}

            {selectedEntry ? (
              <JingweiEntryForm
                entry={selectedEntry}
                bookId={bookId}
                onSave={handleSave}
                onDelete={handleDelete}
                onClose={() => setSelectedEntryId(null)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <p className="text-xs">选择左侧条目进行编辑</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
