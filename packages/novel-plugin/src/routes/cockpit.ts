import { Hono } from "hono";
import type { StorageDatabase } from "@vivy1024/novelfork-core";

import { createCockpitService } from "../handlers/index.js";
import type { RouterContext } from "./context.js";

/**
 * 驾驶舱只读面板（近期章节结果 + 待回收伏笔）。
 *
 * WorkbenchCanvas 的「作品基础」区在挂载时并发拉取这两个接口获取轻声提示；
 * 早期只有 cockpit.snapshot 这一个 Runtime Agent 工具，没有 HTTP 端点，永远 404。
 * 这里复用 `CockpitService` 已有查询，把它们暴露为 GET 路由。
 *
 * 字段约定（与前端 `CockpitListItem` 兼容）：
 * - items[i].id         —— 稳定 key
 * - items[i].title      —— 章节结果使用（Hooks 无 title，前端回落到 text）
 * - items[i].text       —— Hooks 使用，前端会剥掉 "pending hooks：" 前缀
 * - items[i].status     —— 章节状态 / hook 风险等级，前端直接展示
 * - items[i].sourceChapter —— Hooks 的埋设章号
 * - items[i].createdAt  —— ISO 时间戳
 */
export interface CreateCockpitRouterOptions {
  /**
   * 测试注入。生产环境不传，回退到 process 级 getStorageDatabase()。
   */
  readonly storage?: StorageDatabase;
}

export function createCockpitRouter(ctx: RouterContext, options: CreateCockpitRouterOptions = {}): Hono {
  const app = new Hono();

  function service() {
    return createCockpitService({
      state: ctx.state,
      ...(options.storage ? { storage: options.storage } : {}),
    });
  }

  app.get("/api/books/:bookId/cockpit/recent-chapter-results", async (c) => {
    const bookId = c.req.param("bookId");
    const limit = parseLimit(c.req.query("limit"));
    const result = await service().listRecentChapterResults({
      bookId,
      ...(limit !== undefined ? { limit } : {}),
    });
    return c.json({
      status: result.status,
      items: result.items,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  });

  app.get("/api/books/:bookId/cockpit/open-hooks", async (c) => {
    const bookId = c.req.param("bookId");
    const limit = parseLimit(c.req.query("limit"));
    const result = await service().listOpenHooks({
      bookId,
      ...(limit !== undefined ? { limit } : {}),
    });
    return c.json({
      status: result.status,
      items: result.items,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  });

  return app;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}
