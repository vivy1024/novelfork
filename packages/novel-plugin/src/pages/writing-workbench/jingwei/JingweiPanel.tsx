import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Eye, X, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { JingweiCategorySidebar } from "./JingweiCategorySidebar";
import { JingweiEntryList } from "./JingweiEntryList";
import { JingweiEntryTree } from "./JingweiEntryTree";
import { JingweiEntryForm } from "./JingweiEntryForm";

import { useJingweiEntries } from "./hooks/useJingweiEntries";
import type { CategoryVisibility } from "./category-schemas";

interface JingweiPanelProps {
  bookId: string;
}

export function JingweiPanel({ bookId }: JingweiPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState("characters");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; title: string; category: string; preview: string }> | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
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

  const [previewChapterNumber, setPreviewChapterNumber] = useState(1);

  const handleFetchPreview = useCallback(async (chapterNum = previewChapterNumber) => {
    setShowPreview(true);
    setPreviewContent(null);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/injection-preview?chapterNumber=${chapterNum}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewContent(data.preview ?? data.context ?? JSON.stringify(data, null, 2));
      } else {
        setPreviewContent("加载预览失败");
      }
    } catch {
      setPreviewContent("加载预览失败");
    }
  }, [bookId, previewChapterNumber]);

  return (
    <div className="flex h-full min-h-0 relative" data-testid="jingwei-panel">
      {/* Import panel overlay */}
      {showImport && (
        <ImportPanel
          bookId={bookId}
          onClose={() => setShowImport(false)}
          onImported={() => { refresh(); fetchEntryCounts(); setShowImport(false); }}
        />
      )}

      {/* Left: Category sidebar */}
      <JingweiCategorySidebar
        selectedCategory={selectedCategory}
        onSelectCategory={handleSelectCategory}
        entryCounts={entryCounts}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Toolbar: injection preview */}
        <div className="shrink-0 flex items-center gap-2 border-b border-border px-3 py-1.5">
          <Button size="xs" variant="outline" onClick={() => { if (showPreview) setShowPreview(false); else void handleFetchPreview(); }} className="h-6 text-xs gap-1">
            <Eye className="size-3" />AI 视角
          </Button>
          <Button size="xs" variant="outline" onClick={() => setShowImport(true)} className="h-6 text-xs gap-1">
            <Upload className="size-3" />导入
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
          <div className="shrink-0 border-b border-border px-3 py-2 max-h-48 overflow-y-auto bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-muted-foreground">AI 注入预览</span>
                <span className="text-[10px] text-muted-foreground">第</span>
                <input
                  type="number"
                  min={1}
                  value={previewChapterNumber}
                  onChange={(e) => {
                    const num = Math.max(1, parseInt(e.target.value, 10) || 1);
                    setPreviewChapterNumber(num);
                    void handleFetchPreview(num);
                  }}
                  className="w-10 rounded border border-input bg-transparent px-1 text-center text-[10px] font-mono outline-none"
                />
                <span className="text-[10px] text-muted-foreground">章视角</span>
              </div>
              <Button size="xs" variant="ghost" onClick={() => setShowPreview(false)} className="h-5 w-5 p-0"><X className="size-3" /></Button>
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

function ImportPanel({ bookId, onClose, onImported }: { bookId: string; onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("world-model");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleImport = async () => {
    if (!text.trim()) return;
    setImporting(true);

    const entries: Array<{ title: string; contentMd: string; category: string }> = [];
    const sections = text.split(/^## /m).filter(Boolean);
    for (const section of sections) {
      const lines = section.split("\n");
      const title = lines[0]?.trim() ?? "未命名";
      const contentMd = lines.slice(1).join("\n").trim();
      if (contentMd) {
        entries.push({ title, contentMd, category });
      }
    }

    if (entries.length === 0) {
      entries.push({ title: "导入内容", contentMd: text.trim(), category });
    }

    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      setResult(`成功导入 ${data.imported} 条经纬条目`);
      setTimeout(onImported, 800);
    } catch {
      setResult("导入失败");
    }
    setImporting(false);
  };

  return (
    <div className="absolute inset-0 bg-background/95 z-50 flex flex-col p-4 gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">导入经纬</h3>
        <Button size="xs" variant="ghost" onClick={onClose}><X className="size-3" /></Button>
      </div>
      <p className="text-[10px] text-muted-foreground">粘贴 Markdown 内容，按 ## 标题自动拆分为多条经纬条目。</p>
      <div className="flex gap-2 items-center">
        <span className="text-xs text-muted-foreground">分类:</span>
        <select className="h-7 text-xs border rounded px-2 bg-background" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="world-model">世界模型</option>
          <option value="characters">角色</option>
          <option value="power-system">力量体系</option>
          <option value="rules">规则</option>
          <option value="factions">势力</option>
          <option value="locations">地点</option>
          <option value="props">物品</option>
          <option value="timeline">时间线</option>
        </select>
      </div>
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        className="flex-1 font-mono text-xs"
        placeholder={"粘贴 Markdown 内容...\n\n## 条目标题1\n内容...\n\n## 条目标题2\n内容..."}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleImport} disabled={importing || !text.trim()}>
          {importing ? "导入中..." : "导入"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>取消</Button>
        {result && <span className="text-xs text-green-600">{result}</span>}
      </div>
    </div>
  );
}
