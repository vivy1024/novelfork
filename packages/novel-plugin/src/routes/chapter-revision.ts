/**
 * 整章改动「采用」接口（T5.3）。
 *
 * 叙述者的大写操作一律先经 chapter.propose_revision 产候选（artifact 带 originalHash
 * 与新正文）；这条接口是它们的唯一落盘点：用 handleChapterWrite 的 expectedHash
 * 乐观锁校验「采用那一刻的正文，确实还是候选生成时看到的那一版」，
 * 不一致就 409 告知原因，绝不悄悄覆盖。
 */

import { Hono } from "hono";
import { createHash } from "node:crypto";
import { getStorageDatabase, isSafeBookId } from "@vivy1024/novelfork-core";

import { handleChapterWrite } from "../handlers/chapter-write.js";

export interface CreateChapterRevisionRouterOptions {
  readonly resolveBookRoot?: (bookId: string) => string;
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

const HEX_64 = /^[0-9a-f]{64}$/u;

export function createChapterRevisionRouter(options: CreateChapterRevisionRouterOptions = {}): Hono {
  const app = new Hono();

  app.post("/api/books/:bookId/chapters/:chapterNumber/revision-apply", async (c) => {
    const bookId = c.req.param("bookId");
    if (!isSafeBookId(bookId)) {
      return c.json({ ok: false, error: "invalid-book-id", summary: "书籍 ID 不合法" }, 400);
    }
    const bookRoot = options.resolveBookRoot?.(bookId);
    if (!bookRoot) {
      return c.json({ ok: false, error: "book-root-unavailable", summary: "找不到这本书的可信目录，无法落盘。" }, 404);
    }
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ ok: false, error: "invalid-chapter-number", summary: "章号必须是正整数" }, 400);
    }

    const body = await readBody(c);
    const originalHash = typeof body.originalHash === "string" ? body.originalHash.trim() : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (!HEX_64.test(originalHash)) {
      return c.json({
        ok: false,
        error: "invalid-original-hash",
        summary: "originalHash 缺失或不是 64 位小写十六进制。请从叙述者结果卡的候选里点「采用」，不要手工拼请求。",
      }, 400);
    }
    if (!content.trim()) {
      return c.json({ ok: false, error: "empty-content", summary: "新正文不能为空。" }, 400);
    }

    const result = await handleChapterWrite(
      { bookId, chapterNumber, content, expectedHash: originalHash },
      { bookRoot, storage: getStorageDatabase(), purpose: "revision" },
    );
    if (!result.ok) {
      const status = result.error === "chapter-concurrent-modification" ? 409 : 422;
      return c.json({
        ok: false,
        error: result.error,
        summary: result.summary,
        ...(result.explanation ? { explanation: result.explanation } : {}),
        ...(result.data !== undefined ? { data: result.data } : {}),
      }, status);
    }
    return c.json({
      ok: true,
      kind: "chapter-revision-applied",
      newHash: createHash("sha256").update(content, "utf8").digest("hex"),
      summary: result.summary,
      data: result.data,
    });
  });

  return app;
}
