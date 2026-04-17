/**
 * Search Index — In-memory FTS for chapters, settings, messages, files
 * Uses simple string matching (no SQLite dependency for browser compatibility)
 */

export type SearchType = 'chapter' | 'setting' | 'message' | 'file' | 'all';

export interface SearchDocument {
  id: string;
  type: Exclude<SearchType, 'all'>;
  title: string;
  content: string;
  bookId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResult extends SearchDocument {
  score: number;
  highlights: string[];
}

export class SearchIndex {
  private documents = new Map<string, SearchDocument>();

  /**
   * Add or update a document in the index
   */
  index(doc: SearchDocument): void {
    this.documents.set(doc.id, doc);
  }

  /**
   * Remove a document from the index
   */
  remove(id: string): void {
    this.documents.delete(id);
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.documents.clear();
  }

  /**
   * Search documents with query and optional type filter
   */
  search(query: string, type?: SearchType, limit = 50): SearchResult[] {
    if (!query.trim()) return [];

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: SearchResult[] = [];

    for (const doc of this.documents.values()) {
      // Type filter
      if (type && type !== 'all' && doc.type !== type) continue;

      // Score calculation
      const titleLower = doc.title.toLowerCase();
      const contentLower = doc.content.toLowerCase();
      let score = 0;
      const highlights: string[] = [];

      for (const term of terms) {
        // Title match (higher weight)
        if (titleLower.includes(term)) {
          score += 10;
          highlights.push(this.extractHighlight(doc.title, term));
        }

        // Content match
        if (contentLower.includes(term)) {
          score += 1;
          highlights.push(this.extractHighlight(doc.content, term));
        }
      }

      if (score > 0) {
        results.push({ ...doc, score, highlights: [...new Set(highlights)] });
      }
    }

    // Sort by score (descending) and limit
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Extract a snippet around the matched term
   */
  private extractHighlight(text: string, term: string, contextLength = 60): string {
    const lowerText = text.toLowerCase();
    const index = lowerText.indexOf(term.toLowerCase());
    if (index === -1) return '';

    const start = Math.max(0, index - contextLength);
    const end = Math.min(text.length, index + term.length + contextLength);
    let snippet = text.slice(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return snippet;
  }

  /**
   * Get total document count
   */
  size(): number {
    return this.documents.size;
  }

  /**
   * Get document by ID
   */
  get(id: string): SearchDocument | undefined {
    return this.documents.get(id);
  }
}

// Global singleton instance
export const globalSearchIndex = new SearchIndex();
