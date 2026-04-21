/**
 * Search routes — Global search across chapters, settings, messages, files
 */

import { Hono } from "hono";
import type { RouterContext } from "./context.js";
import { globalSearchIndex, type SearchType } from "../lib/search-index.js";
import { rebuildSearchIndex } from "../lib/search-index-rebuild.js";

export function createSearchRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state } = ctx;

  /**
   * POST /api/search
   * Body: { query: string, type?: SearchType, bookId?: string, limit?: number }
   */
  app.post("/api/search", async (c) => {
    const body = await c.req.json<{
      query: string;
      type?: SearchType;
      bookId?: string;
      limit?: number;
    }>();

    const { query, type = "all", bookId, limit = 50 } = body;

    if (!query || !query.trim()) {
      return c.json({ results: [] });
    }

    let results = globalSearchIndex.search(query, type, limit);

    if (bookId) {
      results = results.filter((result) => result.bookId === bookId);
    }

    return c.json({ results });
  });

  /**
   * POST /api/search/index/rebuild
   * Rebuild search index from current state
   */
  app.post("/api/search/index/rebuild", async (c) => {
    try {
      const summary = await rebuildSearchIndex(state);
      return c.json({
        success: true,
        indexed: summary.indexedDocuments,
        bookCount: summary.bookCount,
        skippedBooks: summary.skippedBooks,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * GET /api/search/index/stats
   * Get search index statistics
   */
  app.get("/api/search/index/stats", (c) => {
    return c.json({
      totalDocuments: globalSearchIndex.size(),
    });
  });

  return app;
}
