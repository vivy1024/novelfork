import { useEffect, useState } from "react";

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
      const response = await fetch('/api/search/index/rebuild', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setIndexed(data.indexed || 0);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to rebuild index');
      }
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
