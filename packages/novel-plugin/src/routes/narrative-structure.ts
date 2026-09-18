/**
 * 叙事结构聚合路由（Narrative Structure Aggregate Route）。
 *
 * GET /api/books/:bookId/narrative-structure
 * 一次请求返回卷、章、场景、剧情线、挂载关系、伏笔债务、实体的全书结构快照。
 */

import { Hono } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import { buildNarrativeStructure } from "../engine/narrative-taxonomy/narrative-structure.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";

export interface NarrativeStructureRouterOptions {
  readonly storage?: StorageDatabase;
}

export function createNarrativeStructureRouter(options: NarrativeStructureRouterOptions = {}): Hono {
  const app = new Hono();
  const storage = () => options.storage ?? getStorageDatabase();

  app.get("/api/books/:bookId/narrative-structure", (c) => {
    const bookId = c.req.param("bookId");
    if (!bookId?.trim()) {
      return c.json({ error: "invalid-book-id", summary: "bookId 不能为空。" }, 400);
    }

    try {
      const db = storage();
      ensureNarrativeMemorySchema(db);
      const payload = buildNarrativeStructure(db, bookId);
      return c.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        { error: "narrative-structure-read-failed", summary: "读取全书叙事结构失败。", detail: message },
        500,
      );
    }
  });

  return app;
}
