import { useState, useEffect, useCallback } from "react";

export interface JingweiProgression {
  id: string;
  entryId: string;
  fieldKey: string;
  oldValue: string | null;
  newValue: string;
  chapterNumber: number | null;
  description: string | null;
  createdAt: number;
}

interface UseJingweiProgressionsResult {
  progressions: JingweiProgression[];
  loading: boolean;
  addProgression: (data: {
    fieldKey: string;
    oldValue?: string;
    newValue: string;
    chapterNumber?: number;
    description?: string;
  }) => Promise<boolean>;
  refresh: () => void;
}

export function useJingweiProgressions(bookId: string, entryId: string | null): UseJingweiProgressionsResult {
  const [progressions, setProgressions] = useState<JingweiProgression[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProgressions = useCallback(async () => {
    if (!bookId || !entryId) {
      setProgressions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}/progressions`,
      );
      if (res.ok) {
        const data = await res.json();
        setProgressions(Array.isArray(data.progressions) ? data.progressions : []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [bookId, entryId]);

  useEffect(() => {
    void fetchProgressions();
  }, [fetchProgressions]);

  const addProgression = useCallback(
    async (data: { fieldKey: string; oldValue?: string; newValue: string; chapterNumber?: number; description?: string }) => {
      if (!bookId || !entryId) return false;
      try {
        const res = await fetch(
          `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}/progressions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
        );
        if (res.ok) {
          await fetchProgressions();
          return true;
        }
      } catch { /* ignore */ }
      return false;
    },
    [bookId, entryId, fetchProgressions],
  );

  return { progressions, loading, addProgression, refresh: fetchProgressions };
}
