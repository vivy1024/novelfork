/**
 * Context Manager Router — real-time context management with compression
 */

import { estimateTokenCount } from "@vivy1024/novelfork-core";
import { Hono } from "hono";
import type { RouterContext } from "./context.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_CONTEXT_GOVERNANCE = {
  compressionThresholdPercent: 99,
  truncateTargetPercent: 95,
  compressionThresholdSource: "default.contextCompressionThresholdPercent",
  truncateTargetSource: "default.contextTruncateTargetPercent",
} as const;

function normalizePercent(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
}

export function createContextManagerRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state } = ctx;

  const CONTEXT_MAX_TOKENS = 100000; // Claude 3.5 context window

  const getRuntimeThresholds = async () => {
    const governance = await ctx.getContextGovernance?.() ?? DEFAULT_CONTEXT_GOVERNANCE;
    const compressionThresholdPercent = normalizePercent(
      governance.compressionThresholdPercent,
      DEFAULT_CONTEXT_GOVERNANCE.compressionThresholdPercent,
    );
    const truncateTargetPercent = normalizePercent(
      governance.truncateTargetPercent,
      DEFAULT_CONTEXT_GOVERNANCE.truncateTargetPercent,
    );
    return {
      compressionRatio: compressionThresholdPercent / 100,
      truncateRatio: truncateTargetPercent / 100,
      compressionThresholdPercent,
      truncateTargetPercent,
      compressionThresholdSource: governance.compressionThresholdSource
        ?? DEFAULT_CONTEXT_GOVERNANCE.compressionThresholdSource,
      truncateTargetSource: governance.truncateTargetSource
        ?? DEFAULT_CONTEXT_GOVERNANCE.truncateTargetSource,
    };
  };

  /**
   * GET /api/context/:bookId/usage
   * Get current context token usage
   */
  app.get("/api/context/:bookId/usage", async (c) => {
    const bookId = c.req.param("bookId");

    try {
      const bookDir = state.bookDir(bookId);
      const storyDir = join(bookDir, "story");

      // Load all jingwei files
      const jingweiFiles = [
        "volume_outline.md",
        "chapter_summaries.md",
        "pending_hooks.md",
        "subplot_board.md",
        "emotional_arcs.md",
        "character_matrix.md",
        "world_bible.md",
        "style_guide.md",
      ];

      let totalTokens = 0;
      let messageCount = 0;

      for (const filename of jingweiFiles) {
        try {
          const content = await readFile(join(storyDir, filename), "utf-8");
          if (content.trim()) {
            totalTokens += estimateTokenCount(content);
            messageCount++;
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      const {
        compressionRatio,
        compressionThresholdPercent,
        truncateTargetPercent,
        compressionThresholdSource,
      } = await getRuntimeThresholds();
      const percentage = (totalTokens / CONTEXT_MAX_TOKENS) * 100;
      const canCompress = totalTokens > CONTEXT_MAX_TOKENS * compressionRatio;

      return c.json({
        totalTokens,
        maxTokens: CONTEXT_MAX_TOKENS,
        percentage,
        messages: messageCount,
        canCompress,
        governance: {
          source: compressionThresholdSource,
          compressionThresholdPercent,
          truncateTargetPercent,
          compressionReason: canCompress
            ? `当前上下文已达到 ${compressionThresholdSource}=${compressionThresholdPercent}% 的压缩阈值`
            : `当前上下文未达到 ${compressionThresholdSource}=${compressionThresholdPercent}% 的压缩阈值`,
        },
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/context/:bookId/compress
   * Compress context by summarizing old content
   */
  app.post("/api/context/:bookId/compress", async (c) => {
    const bookId = c.req.param("bookId");

    try {
      const bookDir = state.bookDir(bookId);
      const storyDir = join(bookDir, "story");

      // Compress chapter_summaries.md (keep last 10 chapters, summarize older)
      const summariesPath = join(storyDir, "chapter_summaries.md");
      try {
        const content = await readFile(summariesPath, "utf-8");
        const lines = content.split("\n");

        // Keep last 10 chapters
        const recentLines = lines.slice(-50); // ~5 lines per chapter
        const compressed = recentLines.join("\n");

        await writeFile(summariesPath, compressed, "utf-8");
      } catch {
        // File doesn't exist
      }

      // Compress pending_hooks.md (remove resolved hooks)
      const hooksPath = join(storyDir, "pending_hooks.md");
      try {
        const content = await readFile(hooksPath, "utf-8");
        const lines = content.split("\n").filter((line) => {
          return !line.includes("✓") && !line.includes("已解决");
        });

        await writeFile(hooksPath, lines.join("\n"), "utf-8");
      } catch {
        // File doesn't exist
      }

      return c.json({ status: "compressed" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/context/:bookId/truncate
   * Truncate context to fit within token limit
   */
  app.post("/api/context/:bookId/truncate", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json<{ maxTokens?: number }>().catch(() => ({ maxTokens: undefined }));
    const {
      truncateRatio,
      compressionThresholdPercent,
      truncateTargetPercent,
      truncateTargetSource,
    } = await getRuntimeThresholds();
    const targetTokens = body.maxTokens ?? CONTEXT_MAX_TOKENS * truncateRatio;

    try {
      const bookDir = state.bookDir(bookId);
      const storyDir = join(bookDir, "story");

      // Truncate chapter_summaries.md
      const summariesPath = join(storyDir, "chapter_summaries.md");
      try {
        const content = await readFile(summariesPath, "utf-8");
        const estimatedTokens = estimateTokenCount(content);

        if (estimatedTokens > targetTokens) {
          // Keep only last N characters to fit target
          const ratio = targetTokens / estimatedTokens;
          const keepChars = Math.floor(content.length * ratio);
          const truncated = content.slice(-keepChars);

          await writeFile(summariesPath, truncated, "utf-8");
        }
      } catch {
        // File doesn't exist
      }

      return c.json({
        status: "truncated",
        targetTokens,
        governance: {
          source: truncateTargetSource,
          compressionThresholdPercent,
          truncateTargetPercent,
          truncateReason: `本次截断目标来自 ${truncateTargetSource}=${truncateTargetPercent}%`,
        },
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/context/:bookId/clear
   * Clear all context (dangerous operation)
   */
  app.post("/api/context/:bookId/clear", async (c) => {
    const bookId = c.req.param("bookId");

    try {
      const bookDir = state.bookDir(bookId);
      const storyDir = join(bookDir, "story");

      // Clear chapter_summaries.md
      const summariesPath = join(storyDir, "chapter_summaries.md");
      await writeFile(summariesPath, "", "utf-8");

      // Clear pending_hooks.md
      const hooksPath = join(storyDir, "pending_hooks.md");
      await writeFile(hooksPath, "", "utf-8");

      return c.json({ status: "cleared" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  return app;
}
