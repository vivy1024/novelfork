/**
 * Search routes — Global search across chapters, settings, messages, files
 */

import { Hono } from "hono";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RouterContext } from "./context.js";
import { globalSearchIndex, type SearchType } from "../lib/search-index.js";

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

    const { query, type = 'all', bookId, limit = 50 } = body;

    if (!query || !query.trim()) {
      return c.json({ results: [] });
    }

    let results = globalSearchIndex.search(query, type, limit);

    // Filter by bookId if provided
    if (bookId) {
      results = results.filter(r => r.bookId === bookId);
    }

    return c.json({ results });
  });

  /**
   * POST /api/search/index/rebuild
   * Rebuild search index from current state
   */
  app.post("/api/search/index/rebuild", async (c) => {
    try {
      globalSearchIndex.clear();

      const bookIds = await state.listBooks();
      let indexed = 0;

      for (const bookId of bookIds) {
        const bookDir = state.bookDir(bookId);
        const chaptersDir = join(bookDir, "chapters");

        // Index chapters
        try {
          const chapters = await state.loadChapterIndex(bookId);
          const files = await readdir(chaptersDir).catch(() => []);

          for (const chapter of chapters) {
            const match = files.find(f => f.startsWith(`${chapter.number.toString().padStart(4, '0')}-`));
            if (match) {
              try {
                const content = await readFile(join(chaptersDir, match), "utf-8");
                globalSearchIndex.index({
                  id: `chapter:${bookId}:${chapter.number}`,
                  type: 'chapter',
                  title: chapter.title || `Chapter ${chapter.number}`,
                  content: content || '',
                  bookId,
                  timestamp: Date.now(),
                  metadata: { chapterNumber: chapter.number },
                });
                indexed++;
              } catch {
                // Skip if file can't be read
              }
            }
          }
        } catch (e) {
          console.error(`Failed to index chapters for book ${bookId}:`, e);
        }

        // Index truth files (settings)
        try {
          const storyDir = join(bookDir, "story");
          const truthFiles = [
            'story_bible.md',
            'volume_outline.md',
            'current_state.md',
            'character_matrix.md',
            'style_guide.md',
          ];

          for (const file of truthFiles) {
            try {
              const content = await readFile(join(storyDir, file), "utf-8");
              globalSearchIndex.index({
                id: `setting:${bookId}:${file}`,
                type: 'setting',
                title: file.replace('.md', '').replace(/_/g, ' '),
                content: content || '',
                bookId,
                timestamp: Date.now(),
                metadata: { fileName: file },
              });
              indexed++;
            } catch {
              // File doesn't exist, skip
            }
          }
        } catch (e) {
          console.error(`Failed to index truth files for book ${bookId}:`, e);
        }
      }

      return c.json({ success: true, indexed });
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
