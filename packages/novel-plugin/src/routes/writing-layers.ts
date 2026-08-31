import { Hono } from "hono";

import { parseAuthorProfile, type AuthorProfile } from "@vivy1024/novelfork-core";

import {
  loadAuthorProfile,
  loadBookDesign,
  loadBookRules,
  resolveAuthorHome,
  resolveWritingLayers,
  saveAuthorProfile,
  saveBookDesign,
  saveBookRules,
} from "../engine/writing-layers/layer-store.js";
import type { RouterContext } from "./context.js";

export interface CreateWritingLayersRouterOptions {
  readonly home?: string;
  readonly resolveBookRoot?: (bookId: string) => string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function createWritingLayersRouter(
  ctx: RouterContext,
  options: CreateWritingLayersRouterOptions = {},
): Hono {
  const app = new Hono();
  const resolveBookRoot = options.resolveBookRoot ?? ((bookId: string) => ctx.state.bookDir(bookId));

  app.get("/api/author-profile", async (c) => {
    const profile = await loadAuthorProfile(options.home);
    return c.json({
      profile,
      path: `${resolveAuthorHome(options.home).replaceAll("\\", "/")}/author-profile.json`,
    });
  });

  app.put("/api/author-profile", async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const profile = await saveAuthorProfile(parseAuthorProfile({
      version: 1,
      habits: asString(body?.habits) ?? "",
      styleNotes: asString(body?.styleNotes) ?? "",
      avoidances: Array.isArray(body?.avoidances)
        ? body.avoidances.filter((item): item is string => typeof item === "string")
        : [],
    }), options.home);
    return c.json({ profile });
  });

  app.get("/api/books/:bookId/writing-layers", async (c) => {
    const bookId = c.req.param("bookId");
    const bookRoot = resolveBookRoot(bookId);
    const book = await ctx.state.loadBookConfig(bookId).catch(() => null);
    const layers = await resolveWritingLayers({ bookRoot, book, home: options.home });
    return c.json({
      bookId,
      authorProfileEnabled: layers.authorProfileEnabled,
      authorProfile: layers.authorProfile,
      authorHabitsText: layers.authorHabitsText,
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
    const book = await ctx.state.loadBookConfig(bookId).catch(() => null);
    const layers = await resolveWritingLayers({ bookRoot, book, home: options.home });
    return c.json({
      bookId,
      authorProfileEnabled: layers.authorProfileEnabled,
      authorProfile: layers.authorProfile as AuthorProfile,
      authorHabitsText: layers.authorHabitsText,
      bookDesign: layers.bookDesign,
      bookRulesRaw: layers.bookRulesRaw,
      bookRulesText: layers.bookRulesText,
    });
  });

  return app;
}
