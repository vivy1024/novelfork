/**
 * Poison Detector routes — toxic pattern detection for web novels.
 * Exposes the deterministic toxic-detector from @vivy1024/novelfork-core.
 */

import { Hono } from "hono";
import { detectToxicPatterns, type ToxicDetectionContext, loadRuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import type { RouterContext } from "./context.js";
import { ApiError } from "../errors.js";

export function createPoisonDetectorRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state, root } = ctx;

  /**
   * POST /api/poison-detector/analyze
   * Analyze chapter content for toxic patterns.
   */
  app.post("/api/poison-detector/analyze", async (c) => {
    const body = await c.req.json<{
      bookId: string;
      chapterNumber: number;
      content?: string;
    }>();

    const { bookId, chapterNumber, content } = body;

    if (!bookId || !chapterNumber) {
      throw new ApiError("INVALID_INPUT", "bookId and chapterNumber are required", 400);
    }

    // Load chapter content
    const chapterContent = content ?? (await state.loadChapterContent(bookId, chapterNumber));

    // Load book config for protagonist name
    const bookConfig = await state.loadBookConfig(bookId);
    const protagonistName = bookConfig.protagonistName;

    // Load recent chapter summaries from runtime state
    const bookDir = state.bookDir(bookId);
    let recentSummaries: Array<{
      chapter: number;
      mood: string;
      events: string;
      chapterType: string;
    }> = [];

    try {
      const snapshot = await loadRuntimeStateSnapshot(bookDir);
      recentSummaries = snapshot.chapterSummaries.rows
        .filter((s) => s.chapter < chapterNumber && s.chapter >= chapterNumber - 5)
        .map((s) => ({
          chapter: s.chapter,
          mood: s.mood ?? "",
          events: s.events ?? "",
          chapterType: s.chapterType ?? "",
        }));
    } catch {
      // Runtime state not available, continue with empty summaries
    }

    // Determine if volume 1 (chapters 1-30)
    const isVolume1 = chapterNumber <= 30;

    // Build detection context
    const detectionContext: ToxicDetectionContext = {
      content: chapterContent,
      chapterNumber,
      recentSummaries,
      protagonistName,
      isVolume1,
      language: "zh", // TODO: detect from book config
    };

    // Run detection
    const result = detectToxicPatterns(detectionContext);

    // Map severity to response format
    const severity =
      result.score >= 60 ? "high" : result.score >= 30 ? "medium" : "low";

    return c.json({
      poisons: result.violations.map((v) => ({
        rule: v.rule,
        severity: v.severity,
        description: v.description,
        suggestion: v.suggestion,
      })),
      severity,
      score: result.score,
    });
  });

  /**
   * POST /api/books/:id/chapters/:number/detect-poisons
   * Convenience endpoint for detecting poisons in a specific chapter.
   */
  app.post("/api/books/:id/chapters/:number/detect-poisons", async (c) => {
    const bookId = c.req.param("id");
    const chapterNumber = parseInt(c.req.param("number"), 10);

    if (isNaN(chapterNumber)) {
      throw new ApiError("INVALID_INPUT", "Invalid chapter number", 400);
    }

    // Load chapter content
    const chapterContent = await state.loadChapterContent(bookId, chapterNumber);

    // Load book config
    const bookConfig = await state.loadBookConfig(bookId);
    const protagonistName = bookConfig.protagonistName;

    // Load recent summaries from runtime state
    const bookDir = state.bookDir(bookId);
    let recentSummaries: Array<{
      chapter: number;
      mood: string;
      events: string;
      chapterType: string;
    }> = [];

    try {
      const snapshot = await loadRuntimeStateSnapshot(bookDir);
      recentSummaries = snapshot.chapterSummaries.rows
        .filter((s) => s.chapter < chapterNumber && s.chapter >= chapterNumber - 5)
        .map((s) => ({
          chapter: s.chapter,
          mood: s.mood ?? "",
          events: s.events ?? "",
          chapterType: s.chapterType ?? "",
        }));
    } catch {
      // Runtime state not available, continue with empty summaries
    }

    const isVolume1 = chapterNumber <= 30;

    const detectionContext: ToxicDetectionContext = {
      content: chapterContent,
      chapterNumber,
      recentSummaries,
      protagonistName,
      isVolume1,
      language: "zh",
    };

    const result = detectToxicPatterns(detectionContext);

    const severity =
      result.score >= 60 ? "high" : result.score >= 30 ? "medium" : "low";

    return c.json({
      poisons: result.violations.map((v) => ({
        rule: v.rule,
        severity: v.severity,
        description: v.description,
        suggestion: v.suggestion,
      })),
      severity,
      score: result.score,
    });
  });

  return app;
}

