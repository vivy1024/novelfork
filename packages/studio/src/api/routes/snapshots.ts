/**
 * Snapshots routes — chapter version control.
 * Provides snapshot creation, listing, restoration, and diff comparison.
 */

import { Hono } from "hono";
import { MemoryDB } from "@actalk/inkos-core";
import type { RouterContext } from "./context.js";

export function createSnapshotsRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state } = ctx;

  // --- Create snapshot ---

  app.post("/api/snapshots", async (c) => {
    try {
      const body = await c.req.json<{
        chapterId: string;
        content: string;
        triggerType: string;
        description?: string;
      }>();

      const { chapterId, content, triggerType, description } = body;

      if (!chapterId || !content || !triggerType) {
        return c.json({ error: "chapterId, content, and triggerType are required" }, 400);
      }

      // Extract bookId from chapterId (format: "bookId:chapterNum")
      const [bookId] = chapterId.split(":");
      if (!bookId) {
        return c.json({ error: "Invalid chapterId format" }, 400);
      }

      const bookDir = state.bookDir(bookId);
      const db = new MemoryDB(bookDir);

      try {
        const snapshotId = db.createSnapshot(chapterId, content, triggerType, description);
        return c.json({ ok: true, snapshotId });
      } finally {
        db.close();
      }
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- List snapshots for a chapter ---

  app.get("/api/snapshots/:chapterId", async (c) => {
    try {
      const chapterId = c.req.param("chapterId");
      const limit = parseInt(c.req.query("limit") ?? "50", 10);

      // Extract bookId from chapterId
      const [bookId] = chapterId.split(":");
      if (!bookId) {
        return c.json({ error: "Invalid chapterId format" }, 400);
      }

      const bookDir = state.bookDir(bookId);
      const db = new MemoryDB(bookDir);

      try {
        const snapshots = db.getSnapshots(chapterId, limit);
        // Return metadata only (no content)
        const metadata = snapshots.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          triggerType: s.triggerType,
          description: s.description,
        }));
        return c.json({ snapshots: metadata });
      } finally {
        db.close();
      }
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Get snapshot content ---

  app.get("/api/snapshots/:id/content", async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "Invalid snapshot ID" }, 400);
      }

      // We need to find which book this snapshot belongs to
      // For now, we'll try to get it from query param or header
      const bookId = c.req.query("bookId");
      if (!bookId) {
        return c.json({ error: "bookId query parameter is required" }, 400);
      }

      const bookDir = state.bookDir(bookId);
      const db = new MemoryDB(bookDir);

      try {
        const snapshot = db.getSnapshotContent(id);
        if (!snapshot) {
          return c.json({ error: "Snapshot not found" }, 404);
        }
        return c.json({ snapshot });
      } finally {
        db.close();
      }
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Restore snapshot ---

  app.post("/api/snapshots/:id/restore", async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "Invalid snapshot ID" }, 400);
      }

      const bookId = c.req.query("bookId");
      if (!bookId) {
        return c.json({ error: "bookId query parameter is required" }, 400);
      }

      const bookDir = state.bookDir(bookId);
      const db = new MemoryDB(bookDir);

      try {
        const snapshot = db.getSnapshotContent(id);
        if (!snapshot) {
          return c.json({ error: "Snapshot not found" }, 404);
        }
        return c.json({ ok: true, content: snapshot.content });
      } finally {
        db.close();
      }
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Compare two snapshots ---

  app.get("/api/snapshots/:id/diff/:compareId", async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      const compareId = parseInt(c.req.param("compareId"), 10);

      if (isNaN(id) || isNaN(compareId)) {
        return c.json({ error: "Invalid snapshot IDs" }, 400);
      }

      const bookId = c.req.query("bookId");
      if (!bookId) {
        return c.json({ error: "bookId query parameter is required" }, 400);
      }

      const bookDir = state.bookDir(bookId);
      const db = new MemoryDB(bookDir);

      try {
        const snapshot1 = db.getSnapshotContent(id);
        const snapshot2 = db.getSnapshotContent(compareId);

        if (!snapshot1 || !snapshot2) {
          return c.json({ error: "One or both snapshots not found" }, 404);
        }

        // Simple line-by-line diff
        const lines1 = snapshot1.content.split("\n");
        const lines2 = snapshot2.content.split("\n");

        const diff: Array<{ type: "add" | "remove" | "same"; line: string; lineNum: number }> = [];
        const maxLen = Math.max(lines1.length, lines2.length);

        for (let i = 0; i < maxLen; i++) {
          const line1 = lines1[i];
          const line2 = lines2[i];

          if (line1 === line2) {
            if (line1 !== undefined) {
              diff.push({ type: "same", line: line1, lineNum: i + 1 });
            }
          } else {
            if (line1 !== undefined) {
              diff.push({ type: "remove", line: line1, lineNum: i + 1 });
            }
            if (line2 !== undefined) {
              diff.push({ type: "add", line: line2, lineNum: i + 1 });
            }
          }
        }

        return c.json({ diff });
      } finally {
        db.close();
      }
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  return app;
}
