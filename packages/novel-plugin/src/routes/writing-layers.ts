import { Hono } from "hono";

import {
  resolveWritingLayers,
  saveBookDesign,
  saveBookRules,
} from "../engine/writing-layers/layer-store.js";
import type { RouterContext } from "./context.js";

export interface CreateWritingLayersRouterOptions {
  readonly resolveBookRoot?: (bookId: string) => string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function createWritingLayersRouter(
  ctx: RouterContext,
  options: CreateWritingLayersRouterOptions = {},
): Hono {
  const app = new Hono();
  const resolveBookRoot = options.resolveBookRoot ?? ((bookId: string) => ctx.state.bookDir(bookId));

  app.get("/api/books/:bookId/writing-layers", async (c) => {
    const bookId = c.req.param("bookId");
    const bookRoot = resolveBookRoot(bookId);
    const layers = await resolveWritingLayers({ bookRoot });
    return c.json({
      bookId,
      bookDesign: layers.bookDesign,
      bookRulesRaw: layers.bookRulesRaw,
      bookRulesText: layers.bookRulesText,
      styleGuideText: layers.styleGuideText,
    });
  });

  app.put("/api/books/:bookId/writing-layers", async (c) => {
    const bookId = c.req.param("bookId");
    const bookRoot = resolveBookRoot(bookId);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.bookDesign && typeof body.bookDesign === "object" && !Array.isArray(body.bookDesign)) {
      const design = body.bookDesign as Record<string, unknown>;
      await saveBookDesign(bookRoot, {
        ...(asString(design.authorIntent) !== undefined ? { authorIntent: asString(design.authorIntent) } : {}),
        ...(asString(design.currentFocus) !== undefined ? { currentFocus: asString(design.currentFocus) } : {}),
        ...(asString(design.volumeOutline) !== undefined ? { volumeOutline: asString(design.volumeOutline) } : {}),
      });
    }
    if (typeof body?.bookRulesRaw === "string") {
      await saveBookRules(bookRoot, body.bookRulesRaw);
    }
    const layers = await resolveWritingLayers({ bookRoot });
    return c.json({
      bookId,
      bookDesign: layers.bookDesign,
      bookRulesRaw: layers.bookRulesRaw,
      bookRulesText: layers.bookRulesText,
    });
  });

  return app;
}
