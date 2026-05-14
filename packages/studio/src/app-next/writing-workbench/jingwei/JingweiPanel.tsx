import { useState, useMemo } from "react";
import { JingweiCategorySidebar } from "./JingweiCategorySidebar";
import { JingweiEntryList } from "./JingweiEntryList";
import { JingweiEntryForm } from "./JingweiEntryForm";
import { useJingweiEntries } from "./hooks/useJingweiEntries";
import { CATEGORY_SCHEMAS, type CategoryVisibility } from "./category-schemas";

interface JingweiPanelProps {
  bookId: string;
}

export function JingweiPanel({ bookId }: JingweiPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState("character");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const { entries, loading, createEntry, updateEntry, deleteEntry } = useJingweiEntries(bookId, selectedCategory);

  // Compute entry counts per category (only for current loaded category; others show 0)
  // In a real app you'd fetch all counts in one call; here we show the current category count
  const entryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    counts[selectedCategory] = entries.length;
    return counts;
  }, [selectedCategory, entries.length]);

  const selectedEntry = useMemo(() => {
    if (!selectedEntryId) return null;
    return entries.find((e) => e.id === selectedEntryId) ?? null;
  }, [entries, selectedEntryId]);

  function handleSelectCategory(categoryId: string) {
    setSelectedCategory(categoryId);
    setSelectedEntryId(null);
  }

  async function handleCreateEntry(title: string) {
    const schema = CATEGORY_SCHEMAS.find((s) => s.id === selectedCategory);
    const entry = await createEntry(title, { name: title });
    if (entry) setSelectedEntryId(entry.id);
    else if (schema) {
      // If API didn't return entry, just refresh
    }
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

      {/* Center: Entry list */}
      <JingweiEntryList
        category={selectedCategory}
        entries={entries}
        loading={loading}
        selectedEntryId={selectedEntryId}
        onSelectEntry={setSelectedEntryId}
        onCreateEntry={handleCreateEntry}
      />

      {/* Right: Entry form */}
      {selectedEntry ? (
        <JingweiEntryForm
          entry={selectedEntry}
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
  );
}
