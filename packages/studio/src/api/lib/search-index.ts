/**
 * Search Index — SQLite FTS5 full-text search for chapters, settings, messages, files
 * Persisted in SQLite; survives server restarts.
 */

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

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

interface FtsMatchRow {
  doc_id: string;
  doc_type: string;
  title: string;
  content: string;
  book_id: string;
  timestamp: number;
  metadata: string | null;
  rank: number;
  title_snippet: string;
  content_snippet: string;
}

interface DocRow {
  doc_id: string;
  doc_type: string;
  title: string;
  content: string;
  book_id: string;
  timestamp: number;
  metadata: string | null;
}

interface CountRow {
  cnt: number;
}

interface RowidRow {
  rowid: number;
}

/**
 * SQLite FTS5-backed search index.
 *
 * Uses a regular table (search_docs) as the source of truth, with an
 * external-content FTS5 table (search_fts) kept in sync via manual
 * insert/delete operations (not triggers, for maximum compatibility
 * across SQLite runtimes).
 */
export class SearchIndex {
  private storage: StorageDatabase;

  constructor(databasePath?: string) {
    this.storage = createStorageDatabase({ databasePath: databasePath ?? ":memory:" });
    this.initSchema();
  }

  private get db() {
    return this.storage.sqlite;
  }

  private initSchema(): void {
    // Source-of-truth table with all document fields
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_docs (
        doc_id TEXT PRIMARY KEY,
        doc_type TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        book_id TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL DEFAULT 0,
        metadata TEXT
      )
    `);

    // FTS5 external-content table pointing at search_docs
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        title,
        content,
        book_id,
        content=search_docs,
        content_rowid=rowid,
        tokenize='unicode61'
      )
    `);
  }

  /**
   * Sync FTS5 index for a given rowid after insert/update in search_docs.
   */
  private syncFtsInsert(rowid: number): void {
    const row = this.db.prepare<{ title: string; content: string; book_id: string }>(
      "SELECT title, content, book_id FROM search_docs WHERE rowid = ?",
    ).get(rowid);
    if (row) {
      this.db.prepare(
        "INSERT INTO search_fts(rowid, title, content, book_id) VALUES (?, ?, ?, ?)",
      ).run(rowid, row.title, row.content, row.book_id);
    }
  }

  /**
   * Remove a rowid from the FTS5 index (must supply old values for external-content delete).
   */
  private syncFtsDelete(rowid: number, title: string, content: string, bookId: string): void {
    this.db.prepare(
      "INSERT INTO search_fts(search_fts, rowid, title, content, book_id) VALUES ('delete', ?, ?, ?, ?)",
    ).run(rowid, title, content, bookId);
  }

  /**
   * Add or update a document in the index
   */
  index(doc: SearchDocument): void {
    const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null;

    const existing = this.db.prepare<{ rowid: number; title: string; content: string; book_id: string }>(
      "SELECT rowid, title, content, book_id FROM search_docs WHERE doc_id = ?",
    ).get(doc.id);

    if (existing) {
      // Remove old FTS entry
      this.syncFtsDelete(existing.rowid, existing.title, existing.content, existing.book_id);
      // Update the content table
      this.db.prepare(
        "UPDATE search_docs SET doc_type = ?, title = ?, content = ?, book_id = ?, timestamp = ?, metadata = ? WHERE doc_id = ?",
      ).run(doc.type, doc.title, doc.content, doc.bookId, doc.timestamp, metadataJson, doc.id);
      // Re-insert into FTS
      this.syncFtsInsert(existing.rowid);
    } else {
      this.db.prepare(
        "INSERT INTO search_docs (doc_id, doc_type, title, content, book_id, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(doc.id, doc.type, doc.title, doc.content, doc.bookId, doc.timestamp, metadataJson);
      // Get the rowid of the just-inserted row
      const inserted = this.db.prepare<RowidRow>(
        "SELECT rowid FROM search_docs WHERE doc_id = ?",
      ).get(doc.id);
      if (inserted) {
        this.syncFtsInsert(inserted.rowid);
      }
    }
  }

  /**
   * Remove a document from the index
   */
  remove(id: string): void {
    const existing = this.db.prepare<{ rowid: number; title: string; content: string; book_id: string }>(
      "SELECT rowid, title, content, book_id FROM search_docs WHERE doc_id = ?",
    ).get(id);
    if (existing) {
      this.syncFtsDelete(existing.rowid, existing.title, existing.content, existing.book_id);
      this.db.prepare("DELETE FROM search_docs WHERE doc_id = ?").run(id);
    }
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.db.exec("DELETE FROM search_docs");
    // Rebuild FTS to clear all entries
    this.db.exec("INSERT INTO search_fts(search_fts) VALUES ('rebuild')");
  }

  /**
   * Search documents with query and optional type filter.
   * Uses FTS5 MATCH with BM25 ranking and snippet() for highlights.
   */
  search(query: string, type?: SearchType, limit = 50): SearchResult[] {
    if (!query.trim()) return [];

    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    // Build FTS5 match expression — quote each term and use prefix matching
    const ftsTerms = terms.map((t) => `"${t.replace(/"/g, '""')}"*`);
    const matchExpr = ftsTerms.join(" AND ");

    const typeFilter = type && type !== "all" ? type : null;

    let sql: string;
    const params: unknown[] = [matchExpr];

    if (typeFilter) {
      sql = `
        SELECT
          s.doc_id, s.doc_type, s.title, s.content, s.book_id, s.timestamp, s.metadata,
          f.rank,
          snippet(search_fts, 0, '<mark>', '</mark>', '...', 32) AS title_snippet,
          snippet(search_fts, 1, '<mark>', '</mark>', '...', 64) AS content_snippet
        FROM search_fts f
        JOIN search_docs s ON s.rowid = f.rowid
        WHERE search_fts MATCH ? AND s.doc_type = ?
        ORDER BY f.rank
        LIMIT ?
      `;
      params.push(typeFilter, limit);
    } else {
      sql = `
        SELECT
          s.doc_id, s.doc_type, s.title, s.content, s.book_id, s.timestamp, s.metadata,
          f.rank,
          snippet(search_fts, 0, '<mark>', '</mark>', '...', 32) AS title_snippet,
          snippet(search_fts, 1, '<mark>', '</mark>', '...', 64) AS content_snippet
        FROM search_fts f
        JOIN search_docs s ON s.rowid = f.rowid
        WHERE search_fts MATCH ?
        ORDER BY f.rank
        LIMIT ?
      `;
      params.push(limit);
    }

    const rows = this.db.prepare<FtsMatchRow>(sql).all(...params);

    return rows.map((row) => {
      const highlights: string[] = [];
      if (row.title_snippet && row.title_snippet !== row.title) {
        highlights.push(row.title_snippet);
      }
      if (row.content_snippet) {
        highlights.push(row.content_snippet);
      }
      // Fallback: if FTS5 snippet didn't produce highlights, do simple extraction
      if (highlights.length === 0) {
        for (const term of terms) {
          const h = this.extractHighlight(row.title, term);
          if (h) highlights.push(h);
          const ch = this.extractHighlight(row.content, term);
          if (ch) highlights.push(ch);
        }
      }

      return {
        id: row.doc_id,
        type: row.doc_type as Exclude<SearchType, 'all'>,
        title: row.title,
        content: row.content,
        bookId: row.book_id,
        timestamp: row.timestamp,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        score: -row.rank, // FTS5 rank is negative (lower = better), invert for score
        highlights: [...new Set(highlights)],
      };
    });
  }

  /**
   * Extract a snippet around the matched term (fallback for when FTS5 snippet is empty)
   */
  private extractHighlight(text: string, term: string, contextLength = 60): string {
    const lowerText = text.toLowerCase();
    const idx = lowerText.indexOf(term.toLowerCase());
    if (idx === -1) return '';

    const start = Math.max(0, idx - contextLength);
    const end = Math.min(text.length, idx + term.length + contextLength);
    let snippet = text.slice(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return snippet;
  }

  /**
   * Get total document count
   */
  size(): number {
    const row = this.db.prepare<CountRow>("SELECT COUNT(*) AS cnt FROM search_docs").get();
    return row?.cnt ?? 0;
  }

  /**
   * Get document by ID
   */
  get(id: string): SearchDocument | undefined {
    const row = this.db.prepare<DocRow>(
      "SELECT doc_id, doc_type, title, content, book_id, timestamp, metadata FROM search_docs WHERE doc_id = ?",
    ).get(id);
    if (!row) return undefined;
    return {
      id: row.doc_id,
      type: row.doc_type as Exclude<SearchType, 'all'>,
      title: row.title,
      content: row.content,
      bookId: row.book_id,
      timestamp: row.timestamp,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Close the underlying database connection.
   */
  close(): void {
    this.storage.close();
  }
}

// Global singleton instance — lazily initialized on first access.
// server.ts replaces this with a persistent instance after the storage
// directory is resolved via setGlobalSearchIndex().
let _globalSearchIndex: SearchIndex | null = null;

export function getGlobalSearchIndex(): SearchIndex {
  if (!_globalSearchIndex) {
    _globalSearchIndex = new SearchIndex();
  }
  return _globalSearchIndex;
}

/**
 * Convenience accessor kept for backward compatibility with existing
 * call-sites that reference `globalSearchIndex` directly.
 */
export const globalSearchIndex: SearchIndex = new Proxy({} as SearchIndex, {
  get(_target, prop, receiver) {
    return Reflect.get(getGlobalSearchIndex(), prop, receiver);
  },
});

/**
 * Replace the global search index singleton with a new instance.
 * Used by the server to switch from the default in-memory index to a
 * persistent SQLite-backed index after the storage database is ready.
 */
export function setGlobalSearchIndex(index: SearchIndex): void {
  _globalSearchIndex = index;
}
