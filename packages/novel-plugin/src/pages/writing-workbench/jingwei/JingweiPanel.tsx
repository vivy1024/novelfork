import { useState, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { JingweiCategorySidebar } from "./JingweiCategorySidebar";
import { JingweiEntryList } from "./JingweiEntryList";
import { JingweiEntryTree } from "./JingweiEntryTree";
import { JingweiEntryForm } from "./JingweiEntryForm";
import { JingweiGraphView } from "./JingweiGraphView";
import { useJingweiEntries } from "./hooks/useJingweiEntries";
import { CATEGORY_SCHEMAS, type CategoryVisibility } from "./category-schemas";

interface JingweiPanelProps {
  bookId: string;
}

export function JingweiPanel({ bookId }: JingweiPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState("character");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");

  const { entries, loading, createEntry, updateEntry, deleteEntry } = useJingweiEntries(bookId, selectedCategory);

  const entryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    counts[selectedCategory] = entries.length;
    return counts;
  }, [selectedCategory, entries.length]);

  const selectedEntry = useMemo(() => {
    if (!selectedEntryId) return null;
    return entries.find((e) => e.id === selectedEntryId) ?? null;
  }, [entries, selectedEntryId]);

  // Check if entries have parent-child relationships
  const hasHierarchy = useMemo(() => {
    return entries.some((e) => (e as { parentId?: string | null }).parentId);
  }, [entries]);

  function handleSelectCategory(categoryId: string) {
    setSelectedCategory(categoryId);
    setSelectedEntryId(null);
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
        // Refresh entries
        await updateEntry(entryId, {});
      }
    } catch { /* ignore */ }
  }

  async function handleSave(entryId: string, payload: { title: string; fields: Record<string, unknown>; visibility: CategoryVisibility }) {
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

      {/* Main content area with tabs */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Tab switcher */}
        <div className="shrink-0 border-b border-border px-3 py-1.5">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "list" | "graph")}>
            <TabsList className="h-7">
              <TabsTrigger value="list" className="text-xs px-3 py-1">列表</TabsTrigger>
              <TabsTrigger value="graph" className="text-xs px-3 py-1">图谱</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Content */}
        {viewMode === "list" ? (
          <div className="flex-1 flex min-h-0">
            {/* Entry list or tree */}
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
              />
            )}

            {/* Right: Entry form */}
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
        ) : (
          <JingweiGraphView
            bookId={bookId}
            entries={entries}
            category={selectedCategory}
            onNodeClick={(entryId) => {
              setSelectedEntryId(entryId);
              setViewMode("list");
            }}
          />
        )}
      </div>
    </div>
  );
}
