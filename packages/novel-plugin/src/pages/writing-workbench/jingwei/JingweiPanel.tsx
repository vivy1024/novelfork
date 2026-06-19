import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Network, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; title: string; category: string; preview: string }> | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    if (!value.trim()) {
      setSearchResults(null);
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/search?q=${encodeURIComponent(value)}`)
        .then(r => r.json())
        .then(d => setSearchResults(d.results ?? []))
        .catch(() => setSearchResults([]));
    }, 300);
  }

  async function handleFetchPreview() {
    setShowPreview(!showPreview);
    if (!showPreview) {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/injection-preview?chapterNumber=1`);
        if (res.ok) {
          const data = await res.json();
          setPreviewContent(data.preview ?? data.context ?? JSON.stringify(data, null, 2));
        } else {
          setPreviewContent("加载预览失败");
        }
      } catch {
        setPreviewContent("加载预览失败");
      }
    }
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
        {/* Toolbar: Graph toggle + injection preview */}
        <div className="shrink-0 flex items-center gap-2 border-b border-border px-3 py-1.5">
          {hasRelations && (
            <Button
              variant={showGraph ? "secondary" : "ghost"}
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={() => setShowGraph(!showGraph)}
            >
              <Network className="size-3" />
              {showGraph ? "返回列表" : "关系图谱"}
            </Button>
          )}
          {showGraph && hasRelations && <span className="text-[9px] text-muted-foreground">实验性</span>}
          <Button size="xs" variant="outline" onClick={handleFetchPreview} className="h-6 text-xs gap-1">
            <Eye className="size-3" />AI 视角
          </Button>
          <span className="flex-1" />
          <Input
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="搜索经纬..."
            className="text-xs h-6 w-40"
          />
          {searchQuery && (
            <Button size="xs" variant="ghost" onClick={() => { setSearchQuery(""); setSearchResults(null); }}>
              <X className="size-3" />
            </Button>
          )}
        </div>

        {/* Injection preview panel */}
        {showPreview && (
          <div className="shrink-0 border-b border-border px-3 py-2 max-h-48 overflow-y-auto bg-muted/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground">AI 注入预览（第1章视角）</span>
              <Button size="xs" variant="ghost" onClick={() => setShowPreview(false)}><X className="size-3" /></Button>
            </div>
            <pre className="text-[10px] whitespace-pre-wrap font-mono text-muted-foreground">{previewContent ?? "加载中..."}</pre>
          </div>
        )}

        {/* Search results */}
        {searchResults !== null ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            <p className="text-[10px] text-muted-foreground mb-1">搜索结果 ({searchResults.length})</p>
            {searchResults.length === 0 && <p className="text-xs text-muted-foreground">无匹配条目</p>}
            {searchResults.map(r => (
              <button
                key={r.id}
                onClick={() => { setSelectedEntryId(r.id); setSearchResults(null); setSearchQuery(""); }}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-accent text-xs flex flex-col gap-0.5"
              >
                <span className="font-medium">{r.title}</span>
                <span className="text-[10px] text-muted-foreground">{r.category} · {r.preview}</span>
              </button>
            ))}
          </div>
        ) : selectedCategory === "rules" ? (
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
