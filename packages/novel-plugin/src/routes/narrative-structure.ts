/**
 * 叙事结构聚合路由（Narrative Structure Aggregate Route）。
 *
 * GET /api/books/:bookId/narrative-structure
 * 一次请求返回卷、章、场景、剧情线、挂载关系、伏笔债务、实体的全书结构快照。
 */

import { Hono } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import { buildNarrativeStructure } from "../engine/narrative-taxonomy/narrative-structure.js";
import { resolveForeshadowDebtThresholds } from "../engine/narrative-taxonomy/foreshadow-debts.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";

export interface NarrativeStructureRouterOptions {
  readonly storage?: StorageDatabase;
  /** 读取 book.json；用于取作者设置的伏笔阈值。不提供或读取失败时用默认阈值。 */
  readonly loadBookConfig?: (bookId: string) => Promise<{ readonly foreshadowDebtThresholds?: unknown }>;
}

export function createNarrativeStructureRouter(options: NarrativeStructureRouterOptions = {}): Hono {
  const app = new Hono();
  const storage = () => options.storage ?? getStorageDatabase();

  app.get("/api/books/:bookId/narrative-structure", async (c) => {
    const bookId = c.req.param("bookId");
    if (!bookId?.trim()) {
      return c.json({ error: "invalid-book-id", summary: "bookId 不能为空。" }, 400);
    }

    // 书籍配置缺失或损坏不该拖垮整份结构快照：阈值回到默认值即可。
    let rawThresholds: unknown;
    try {
      rawThresholds = (await options.loadBookConfig?.(bookId))?.foreshadowDebtThresholds;
    } catch {
      rawThresholds = undefined;
    }

    try {
      const db = storage();
      ensureNarrativeMemorySchema(db);
      const payload = buildNarrativeStructure(db, bookId, {
        foreshadowThresholds: resolveForeshadowDebtThresholds(rawThresholds),
      });
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
