/**
 * Rhythm routes — 节奏分析 API
 * GET /api/rhythm/:bookId - 获取书籍节奏分析数据
 */

import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeRhythm } from "../lib/rhythm-analyzer.js";
import type { RouterContext } from "./context.js";

export function createRhythmRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state } = ctx;

  app.get("/api/rhythm/:bookId", async (c) => {
    const bookId = c.req.param("bookId");

    try {
      // 加载章节索引
      const chapterIndex = await state.loadChapterIndex(bookId);

      // 读取所有章节内容
      const chapters = await Promise.all(
        chapterIndex.map(async (meta) => {
          const chapterPath = join(
            state.bookDir(bookId),
            "chapters",
            `chapter_${String(meta.number).padStart(4, "0")}.md`
          );

          try {
            const content = await readFile(chapterPath, "utf-8");
            return { number: meta.number, content };
          } catch {
            // 章节文件不存在，返回空内容
            return { number: meta.number, content: "" };
          }
        })
      );

      // 过滤掉空章节
      const validChapters = chapters.filter(ch => ch.content.length > 0);

      if (validChapters.length === 0) {
        return c.json({
          error: "没有可分析的章节内容",
          chapters: [],
          pattern: { isValid: false, violations: ["无章节内容"], score: 0 },
          warnings: [],
          climaxPoints: []
        });
      }

      // 执行节奏分析
      const analysis = analyzeRhythm(validChapters);

      return c.json(analysis);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `节奏分析失败: ${message}` }, 500);
    }
  });

  return app;
}
