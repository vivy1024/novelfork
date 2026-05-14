import { useState, useEffect, useCallback } from "react";

export interface JingweiEntry {
  id: string;
  category: string;
  title: string;
  fields: Record<string, unknown>;
  visibility: "global" | "tracked" | "nested";
  createdAt?: string;
  updatedAt?: string;
}

interface UseJingweiEntriesResult {
  entries: JingweiEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  createEntry: (title: string, fields?: Record<string, unknown>) => Promise<JingweiEntry | null>;
  updateEntry: (entryId: string, payload: Partial<Pick<JingweiEntry, "title" | "fields" | "visibility">>) => Promise<boolean>;
  deleteEntry: (entryId: string) => Promise<boolean>;
}

export function useJingweiEntries(bookId: string, category: string): UseJingweiEntriesResult {
  const [entries, setEntries] = useState<JingweiEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!bookId || !category) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=${encodeURIComponent(category)}`
      );
      if (!res.ok) throw new Error(`加载失败: ${res.status}`);
      const data = await res.json();
      setEntries(Array.isArray(data.entries) ? data.entries : Array.isArray(data) ? data : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载经纬条目失败");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [bookId, category]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const createEntry = useCallback(async (title: string, fields?: Record<string, unknown>): Promise<JingweiEntry | null> => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, title, fields: fields ?? {} }),
      });
      if (!res.ok) throw new Error(`创建失败: ${res.status}`);
      const entry = await res.json();
      await fetchEntries();
      return entry;
    } catch {
      return null;
    }
  }, [bookId, category, fetchEntries]);

  const updateEntry = useCallback(async (entryId: string, payload: Partial<Pick<JingweiEntry, "title" | "fields" | "visibility">>): Promise<boolean> => {
    try {
      const res = await fetch(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error(`更新失败: ${res.status}`);
      await fetchEntries();
      return true;
    } catch {
      return false;
    }
  }, [bookId, fetchEntries]);

  const deleteEntry = useCallback(async (entryId: string): Promise<boolean> => {
    try {
      const res = await fetch(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`删除失败: ${res.status}`);
      await fetchEntries();
      return true;
    } catch {
      return false;
    }
  }, [bookId, fetchEntries]);

  return { entries, loading, error, refresh: fetchEntries, createEntry, updateEntry, deleteEntry };
}
