/**
 * 写作就绪只读路由 —— 给「写作视图」提供 write.preflight / outline.volume(read) / publish.check 的 HTTP 入口。
 *
 * 纪律：
 * - bookId 只从已通过 ACL 的路径参数取；bookRoot 由宿主注入的 resolveBookRoot 解析，前端不得传路径。
 * - 只读：不写经纬、不写记忆、不落盘诊断结果。写动作仍走工具与权限确认。
 */

import { Hono } from "hono";

import { handleWritePreflight } from "../handlers/write-preflight.js";
import { handleOutlineVolume } from "../handlers/outline-volume.js";

export interface CreateWriteReadinessRouterOptions {
  /** 解析可信书籍根目录（由 Product Runtime 的绑定提供）。 */
  readonly resolveBookRoot: (bookId: string) => string;
}

export function createWriteReadinessRouter(options: CreateWriteReadinessRouterOptions): Hono {
  const app = new Hono();

  app.post("/api/books/:bookId/write/preflight", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    try {
      const result = await handleWritePreflight({
        bookId,
        bookRoot: options.resolveBookRoot(bookId),
        chapterNumber: typeof body.chapterNumber === "number" ? body.chapterNumber : undefined,
        userDirectives: typeof body.userDirectives === "string" ? body.userDirectives : undefined,
        acceptFocusDefault: body.acceptFocusDefault === true,
      });
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "预检失败" }, 500);
    }
  });

  app.get("/api/books/:bookId/write/volume", async (c) => {
    const bookId = c.req.param("bookId");
    try {
      // action=get 只读经纬 outline，不生成也不写入。
      const result = await handleOutlineVolume({
        bookId,
        bookRoot: options.resolveBookRoot(bookId),
        action: "get",
      });
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "读取卷纲失败" }, 500);
    }
  });

  return app;
}
