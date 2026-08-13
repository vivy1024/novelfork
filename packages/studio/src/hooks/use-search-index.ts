import { useEffect, useState } from "react";
import { fetchJson } from "@/hooks/use-api";

/**
 * Hook to initialize and manage search index
 */
export function useSearchIndex() {
  const [indexing, setIndexing] = useState(false);
  const [indexed, setIndexed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auto-rebuild search index on mount
    rebuildIndex();
  }, []);

  async function rebuildIndex() {
    setIndexing(true);
    setError(null);

    try {
      const data = await fetchJson<{ indexed?: number }>('/api/search/index/rebuild', {
        method: 'POST',
      });
      setIndexed(data.indexed || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIndexing(false);
    }
  }

  return {
    indexing,
    indexed,
    error,
    rebuildIndex,
  };
}
