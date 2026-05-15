import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Hono } from "hono";
import type { RouterContext } from "./context.js";
import { linkChapterToEntries, type LinkResult } from "../engine/jingwei/auto-linker.js";

async function readChapterContent(ctx: RouterContext, bookId: string, chapterNumber: number): Promise<string> {
  const chaptersDir = join(ctx.state.bookDir(bookId), "chapters");
  const padded = String(chapterNumber).padStart(4, "0");
  const files = await readdir(chaptersDir).catch(() => []);
  const filename = files.find((file) => file.startsWith(padded) && file.endsWith(".md"));
  if (!filename) return "";
  return readFile(join(chaptersDir, filename), "utf-8").catch(() => "");
}

export function createChapterLinksRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  // POST — 触发自动链接扫描，返回匹配结果
  app.post("/api/books/:bookId/chapters/:ch/link", async (c) => {
    const bookId = c.req.param("bookId");
    const chapterNumber = Number(c.req.param("ch"));
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }

    let content: string | undefined;
    try {
      const body = await c.req.json<{ content?: string }>();
      content = body.content;
    } catch {
      // no body or invalid JSON — will read from file
    }

    if (!content) {
      content = await readChapterContent(ctx, bookId, chapterNumber);
    }

    if (!content) {
      return c.json({ error: "Chapter content not found" }, 404);
    }

    const links: LinkResult[] = await linkChapterToEntries(bookId, chapterNumber, content);
    return c.json({ links });
  });

  // GET — 返回该章已关联的条目列表（实时扫描）
  app.get("/api/books/:bookId/chapters/:ch/links", async (c) => {
    const bookId = c.req.param("bookId");
    const chapterNumber = Number(c.req.param("ch"));
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }

    const content = await readChapterContent(ctx, bookId, chapterNumber);
    if (!content) {
      return c.json({ error: "Chapter content not found" }, 404);
    }

    const links: LinkResult[] = await linkChapterToEntries(bookId, chapterNumber, content);
    return c.json({ links });
  });

  return app;
}
