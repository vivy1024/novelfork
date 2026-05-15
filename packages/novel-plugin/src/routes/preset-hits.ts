import { Hono } from "hono";
import type { RouterContext } from "./context.js";

export function createPresetHitsRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  app.get("/api/books/:bookId/chapters/:ch/preset-hits", async (c) => {
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);

    // Preset hit tracking is not yet implemented in the writing pipeline.
    // Return empty array as placeholder until writing logs record preset hits.
    return c.json({ hits: [] });
  });

  return app;
}
