/**
 * Lorebook routes — world info CRUD for the IDE.
 *
 * Endpoints:
 *   GET    /api/books/:id/lorebook/dimensions  — list dimensions with entry counts
 *   GET    /api/books/:id/lorebook/entries      — list entries (optional ?dimension=)
 *   POST   /api/books/:id/lorebook/entries      — create entry
 *   PUT    /api/books/:id/lorebook/entries/:eid — update entry
 *   DELETE /api/books/:id/lorebook/entries/:eid — delete entry
 *   POST   /api/books/:id/lorebook/import       — heuristic import from markdown text
 *   POST   /api/books/:id/lorebook/dimensions   — add custom dimension
 *   DELETE /api/books/:id/lorebook/dimensions/:key — remove custom dimension
 */

import { Hono } from "hono";
import { join } from "node:path";
import { MemoryDB, importMarkdownFile, inferDimension } from "@actalk/inkos-core";
import { ApiError } from "../errors.js";

function openDB(root: string, bookId: string): MemoryDB {
  return new MemoryDB(join(root, "books", bookId));
}

export function createLorebookRouter(root: string): Hono {
  const app = new Hono();

  // GET /api/books/:id/lorebook/dimensions
  app.get("/api/books/:id/lorebook/dimensions", (c) => {
    const db = openDB(root, c.req.param("id"));
    try {
      const dimensions = db.getDimensions();
      const counts = db.getEntryCountByDimension();
      const countMap = new Map(counts.map((r) => [r.dimension, r.count]));
      return c.json({
        dimensions: dimensions.map((d) => ({
          ...d,
          entryCount: countMap.get(d.key) ?? 0,
        })),
      });
    } finally {
      db.close();
    }
  });

  // POST /api/books/:id/lorebook/dimensions
  app.post("/api/books/:id/lorebook/dimensions", async (c) => {
    const body = await c.req.json<{ key: string; label: string; description?: string }>();
    if (!body.key || !body.label) {
      throw new ApiError(400, "INVALID_BODY", "'key' and 'label' are required");
    }
    const db = openDB(root, c.req.param("id"));
    try {
      db.addDimension({ key: body.key, label: body.label, description: body.description ?? "" });
      return c.json({ ok: true });
    } finally {
      db.close();
    }
  });

  // DELETE /api/books/:id/lorebook/dimensions/:key
  app.delete("/api/books/:id/lorebook/dimensions/:key", (c) => {
    const db = openDB(root, c.req.param("id"));
    try {
      db.removeDimension(c.req.param("key"));
      return c.json({ ok: true });
    } finally {
      db.close();
    }
  });

  // GET /api/books/:id/lorebook/entries
  app.get("/api/books/:id/lorebook/entries", (c) => {
    const dimension = c.req.query("dimension");
    const db = openDB(root, c.req.param("id"));
    try {
      const entries = dimension
        ? db.getEntriesByDimension(dimension)
        : db.getAllEntriesUnfiltered();
      return c.json({ entries, total: entries.length });
    } finally {
      db.close();
    }
  });

  // POST /api/books/:id/lorebook/entries
  app.post("/api/books/:id/lorebook/entries", async (c) => {
    const body = await c.req.json<{
      dimension: string;
      name: string;
      keywords?: string;
      content: string;
      priority?: number;
      enabled?: boolean;
    }>();
    if (!body.dimension || !body.name || !body.content) {
      throw new ApiError(400, "INVALID_BODY", "'dimension', 'name', and 'content' are required");
    }
    const db = openDB(root, c.req.param("id"));
    try {
      const id = db.addWorldEntry({
        dimension: body.dimension,
        name: body.name,
        keywords: body.keywords ?? body.name,
        content: body.content,
        priority: body.priority ?? 100,
        enabled: body.enabled ?? true,
        sourceChapter: null,
      });
      return c.json({ ok: true, id });
    } finally {
      db.close();
    }
  });

  // PUT /api/books/:id/lorebook/entries/:eid
  app.put("/api/books/:id/lorebook/entries/:eid", async (c) => {
    const eid = parseInt(c.req.param("eid"), 10);
    if (!Number.isFinite(eid)) {
      throw new ApiError(400, "INVALID_ID", "Entry ID must be a number");
    }
    const body = await c.req.json<Partial<{
      dimension: string;
      name: string;
      keywords: string;
      content: string;
      priority: number;
      enabled: boolean;
    }>>();
    const db = openDB(root, c.req.param("id"));
    try {
      db.updateWorldEntry(eid, body);
      return c.json({ ok: true });
    } finally {
      db.close();
    }
  });

  // DELETE /api/books/:id/lorebook/entries/:eid
  app.delete("/api/books/:id/lorebook/entries/:eid", (c) => {
    const eid = parseInt(c.req.param("eid"), 10);
    if (!Number.isFinite(eid)) {
      throw new ApiError(400, "INVALID_ID", "Entry ID must be a number");
    }
    const db = openDB(root, c.req.param("id"));
    try {
      db.deleteWorldEntry(eid);
      return c.json({ ok: true });
    } finally {
      db.close();
    }
  });

  // POST /api/books/:id/lorebook/import — heuristic import from markdown text
  app.post("/api/books/:id/lorebook/import", async (c) => {
    const body = await c.req.json<{
      content: string;
      dimension?: string;
      fileName?: string;
    }>();
    if (!body.content) {
      throw new ApiError(400, "INVALID_BODY", "'content' is required");
    }
    const dimension = body.dimension ?? inferDimension(body.fileName ?? "unknown.md");
    const db = openDB(root, c.req.param("id"));
    try {
      const result = importMarkdownFile(db, body.content, dimension, body.fileName ?? "import.md");
      return c.json(result);
    } finally {
      db.close();
    }
  });

  return app;
}
