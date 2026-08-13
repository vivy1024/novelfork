import { useCallback } from "react";
import { fetchJson, invalidateApiPaths, useApi } from "@/hooks/use-api";

export interface JingweiEntry {
  id: string;
  category: string;
  title: string;
  contentMd?: string;
  fields: Record<string, unknown>;
  visibility: "global" | "tracked" | "nested";
  priorityTier?: "auto" | "core" | "relevant" | "reference";
  participatesInAi?: boolean;
  aliases?: string[];
  relatedEntryIds?: string[];
  visibleAfterChapter?: number | null;
  visibleUntilChapter?: number | null;
  createdAt?: string;
  updatedAt?: string;
  status?: "draft" | "confirmed" | "needs-review";
  version?: number;
  layer?: "canon" | "dynamic" | "reference";
}

interface UseJingweiEntriesResult {
  entries: JingweiEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  createEntry: (title: string, fields?: Record<string, unknown>, parentId?: string) => Promise<JingweiEntry | null>;
  updateEntry: (entryId: string, payload: Partial<Pick<JingweiEntry, "title" | "contentMd" | "fields" | "visibility" | "aliases" | "relatedEntryIds" | "visibleAfterChapter" | "visibleUntilChapter">>) => Promise<boolean>;
  deleteEntry: (entryId: string) => Promise<boolean>;
}

export function useJingweiEntries(bookId: string, category: string): UseJingweiEntriesResult {
  const listPath = bookId && category
    ? `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=${encodeURIComponent(category)}`
    : null;

  const { data, loading, error, refetch } = useApi<{ entries?: JingweiEntry[] } | JingweiEntry[]>(listPath);

  const entries = Array.isArray(data)
    ? data
    : Array.isArray(data?.entries)
      ? data.entries
      : [];

  const createEntry = useCallback(async (title: string, fields?: Record<string, unknown>, parentId?: string): Promise<JingweiEntry | null> => {
    try {
      const entry = await fetchJson<JingweiEntry>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category, title, contentMd: "", fields: fields ?? {}, parentId: parentId ?? null }),
        },
      );
      invalidateApiPaths([`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`]);
      return entry;
    } catch {
      return null;
    }
  }, [bookId, category]);

  const updateEntry = useCallback(async (entryId: string, payload: Partial<Pick<JingweiEntry, "title" | "contentMd" | "fields" | "visibility" | "aliases" | "relatedEntryIds" | "visibleAfterChapter" | "visibleUntilChapter">>): Promise<boolean> => {
    try {
      // Transform frontend fields to backend format
      const body: Record<string, unknown> = {};
      if (payload.title !== undefined) body.title = payload.title;
      if (payload.contentMd !== undefined) body.contentMd = payload.contentMd;
      if (payload.fields !== undefined) body.customFields = payload.fields;
      if (payload.aliases !== undefined) body.aliases = payload.aliases;
      if (payload.relatedEntryIds !== undefined) body.relatedEntryIds = payload.relatedEntryIds;
      if (payload.visibility !== undefined || payload.visibleAfterChapter !== undefined || payload.visibleUntilChapter !== undefined) {
        body.visibilityRule = {
          type: payload.visibility ?? "tracked",
          ...(payload.visibleAfterChapter != null ? { visibleAfterChapter: payload.visibleAfterChapter } : {}),
          ...(payload.visibleUntilChapter != null ? { visibleUntilChapter: payload.visibleUntilChapter } : {}),
        };
      }

      await fetchJson(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      invalidateApiPaths([`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`]);
      return true;
    } catch {
      return false;
    }
  }, [bookId]);

  const deleteEntry = useCallback(async (entryId: string): Promise<boolean> => {
    try {
      await fetchJson(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`,
        { method: "DELETE" },
      );
      invalidateApiPaths([`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`]);
      return true;
    } catch {
      return false;
    }
  }, [bookId]);

  return { entries, loading, error, refresh: () => void refetch(), createEntry, updateEntry, deleteEntry };
}
