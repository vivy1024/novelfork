import { useCallback } from "react";
import { fetchJson, invalidateApiPaths, useApi } from "@/hooks/use-api";

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
  const listPath = bookId && entryId
    ? `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}/progressions`
    : null;

  const { data, loading, refetch } = useApi<{ progressions?: JingweiProgression[] }>(listPath);

  const progressions = Array.isArray(data?.progressions) ? data.progressions : [];

  const addProgression = useCallback(
    async (data: { fieldKey: string; oldValue?: string; newValue: string; chapterNumber?: number; description?: string }) => {
      if (!bookId || !entryId) return false;
      try {
        await fetchJson(
          `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}/progressions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
        );
        invalidateApiPaths([
          `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}/progressions`,
        ]);
        return true;
      } catch {
        return false;
      }
    },
    [bookId, entryId],
  );

  return { progressions, loading, addProgression, refresh: () => void refetch() };
}
