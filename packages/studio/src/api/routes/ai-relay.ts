/**
 * AI Relay routes — stateless snapshot-based AI execution.
 * Content-based endpoints that don't require PipelineRunner.
 *
 * Mounted in relay mode only. Standalone mode uses ai.ts instead.
 *
 * Removed (PipelineRunner deleted): write-next, draft, audit, revise.
 */

import { Hono } from "hono";
import type { RouterContext } from "./context.js";

export function createAIRelayRouter(_ctx: RouterContext): Hono {
  const app = new Hono();

  // --- Detect (content-based, no snapshot needed) ---
  app.post("/api/ai/detect", async (c) => {
    const { content } = await c.req.json<{ content: string }>();
    if (!content?.trim()) return c.json({ error: "content is required" }, 400);
    try {
      const { analyzeAITells } = await import("@vivy1024/novelfork-novel-plugin/engine");
      const result = analyzeAITells(content);
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // --- Style Analyze (content-based, no snapshot needed) ---
  app.post("/api/ai/style", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { analyzeStyle } = await import("@vivy1024/novelfork-novel-plugin/engine");
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  return app;
}
