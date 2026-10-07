/**
 * 「全书走势」章节时间线路由。
 *
 * 只读：数据来自 buildChapterTimeline 读模型（章节索引 + 经纬章摘要 + applied 事件 +
 * 出场人物 + 结算新鲜度），不写任何表。书籍目录与 storage 的解析方式同
 * routes/narrative-memory.ts 的 settlement-freshness 路由。
 */

import { Hono } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import { buildChapterTimeline } from "../engine/narrative-taxonomy/chapter-timeline.js";

export interface CreateChapterTimelineRouterOptions {
  readonly storage?: StorageDatabase;
  /** Resolve trusted absolute book root for chapter index IO. */
  readonly resolveBookRoot?: (bookId: string) => string;
}

export function createChapterTimelineRouter(options: CreateChapterTimelineRouterOptions = {}): Hono {
  const app = new Hono();
  const storageFor = () => options.storage ?? getStorageDatabase();

  app.get("/api/books/:bookId/narrative-memory/chapter-timeline", async (c) => {
    const bookId = c.req.param("bookId");
    if (!options.resolveBookRoot) {
      throw new Error("chapter-timeline requires resolveBookRoot on the product router");
    }
    const timeline = await buildChapterTimeline(storageFor(), bookId, options.resolveBookRoot(bookId));
    return c.json(timeline);
  });

  return app;
}
