/**
 * Golden Chapters routes — 黄金三章检测 API
 */

import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeGoldenChapters } from "../lib/golden-chapters-analyzer.js";
import type { RouterContext } from "./context.js";

export function createGoldenChaptersRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state } = ctx;

  /**
   * GET /api/golden-chapters/:bookId
   * 分析指定书籍的前 3 章
   */
  app.get("/api/golden-chapters/:bookId", async (c) => {
    const bookId = c.req.param("bookId");

    try {
      // 加载书籍配置
      const bookConfig = await state.loadBookConfig(bookId);
      const language = (bookConfig.language || "zh") as "zh" | "en";

      // 加载前 3 章内容
      const bookDir = state.bookDir(bookId);
      const chapters: Array<{ number: number; content: string }> = [];

      for (let i = 1; i <= 3; i++) {
        try {
          const chapterPath = join(bookDir, "chapters", `chapter_${i}.md`);
          const content = await readFile(chapterPath, "utf-8");
          chapters.push({ number: i, content });
        } catch (err) {
          // 章节不存在，跳过
          console.warn(`Chapter ${i} not found for book ${bookId}`);
        }
      }

      if (chapters.length === 0) {
        return c.json({
          error: "前 3 章内容未找到，请先生成章节",
        }, 404);
      }

      // 执行分析
      const result = analyzeGoldenChapters(chapters, language);

      return c.json({
        bookId,
        language,
        result,
      });
    } catch (err) {
      console.error("Golden chapters analysis error:", err);
      return c.json({
        error: err instanceof Error ? err.message : String(err),
      }, 500);
    }
  });

  /**
   * GET /api/golden-chapters/:bookId/chapter/:num
   * 分析指定章节
   */
  app.get("/api/golden-chapters/:bookId/chapter/:num", async (c) => {
    const bookId = c.req.param("bookId");
    const chapterNum = parseInt(c.req.param("num"), 10);

    if (isNaN(chapterNum) || chapterNum < 1 || chapterNum > 3) {
      return c.json({
        error: "章节号必须在 1-3 之间",
      }, 400);
    }

    try {
      const bookConfig = await state.loadBookConfig(bookId);
      const language = (bookConfig.language || "zh") as "zh" | "en";

      const bookDir = state.bookDir(bookId);
      const chapterPath = join(bookDir, "chapters", `chapter_${chapterNum}.md`);
      const content = await readFile(chapterPath, "utf-8");

      const result = analyzeGoldenChapters([{ number: chapterNum, content }], language);

      return c.json({
        bookId,
        chapterNumber: chapterNum,
        language,
        result: result.chapters[0],
      });
    } catch (err) {
      console.error(`Chapter ${chapterNum} analysis error:`, err);
      return c.json({
        error: err instanceof Error ? err.message : String(err),
      }, 500);
    }
  });

  return app;
}
