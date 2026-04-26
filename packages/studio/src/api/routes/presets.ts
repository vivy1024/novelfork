import { Hono } from "hono";
import {
  listPresets,
  listBundles,
  getPreset,
  getBundle,
  getPresetsByGenre,
  listBeatTemplates,
} from "@vivy1024/novelfork-core";
import type { RouterContext } from "./context.js";

export function createPresetsRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state } = ctx;

  app.get("/api/presets", (c) => {
    const category = c.req.query("category");
    const genre = c.req.query("genre");

    if (genre) {
      return c.json({ presets: getPresetsByGenre(genre) });
    }

    const presets = category
      ? listPresets(category as Parameters<typeof listPresets>[0])
      : listPresets();

    return c.json({ presets });
  });

  app.get("/api/presets/bundles", (c) => {
    return c.json({ bundles: listBundles() });
  });

  app.get("/api/presets/beats", (c) => {
    return c.json({ beats: listBeatTemplates() });
  });

  app.get("/api/presets/:presetId", (c) => {
    const id = c.req.param("presetId");
    const preset = getPreset(id);
    if (!preset) {
      return c.json({ error: `Preset "${id}" not found` }, 404);
    }
    return c.json({ preset });
  });

  app.get("/api/presets/bundles/:bundleId", (c) => {
    const id = c.req.param("bundleId");
    const bundle = getBundle(id);
    if (!bundle) {
      return c.json({ error: `Bundle "${id}" not found` }, 404);
    }

    const resolved = {
      ...bundle,
      resolvedPresets: [
        ...(bundle.toneId ? [getPreset(bundle.toneId)] : []),
        ...(bundle.settingBaseId ? [getPreset(bundle.settingBaseId)] : []),
        ...bundle.logicRiskIds.map((rid) => getPreset(rid)),
      ].filter(Boolean),
    };

    return c.json({ bundle: resolved });
  });

  app.get("/api/books/:id/presets", async (c) => {
    const bookId = c.req.param("id");
    try {
      const book = await state.loadBookConfig(bookId);
      const enabledIds = book.enabledPresetIds ?? [];
      const enabledPresets = enabledIds.map((pid) => getPreset(pid)).filter(Boolean);
      return c.json({ enabledPresetIds: enabledIds, enabledPresets });
    } catch {
      return c.json({ error: `Book "${bookId}" not found` }, 404);
    }
  });

  app.put("/api/books/:id/presets", async (c) => {
    const bookId = c.req.param("id");
    const body = await c.req.json<{ enabledPresetIds: string[] }>();

    if (!Array.isArray(body.enabledPresetIds)) {
      return c.json({ error: "enabledPresetIds must be an array of strings" }, 400);
    }

    try {
      const book = await state.loadBookConfig(bookId);
      const updated = {
        ...book,
        enabledPresetIds: body.enabledPresetIds,
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(bookId, updated);
      return c.json({ ok: true, enabledPresetIds: updated.enabledPresetIds });
    } catch {
      return c.json({ error: `Book "${bookId}" not found` }, 404);
    }
  });

  app.post("/api/books/:id/presets/:presetId/customize", async (c) => {
    const bookId = c.req.param("id");
    const presetId = c.req.param("presetId");
    const preset = getPreset(presetId);
    if (!preset) {
      return c.json({ error: `Preset "${presetId}" not found` }, 404);
    }

    const body = await c.req.json<Record<string, unknown>>();

    try {
      const book = await state.loadBookConfig(bookId);
      const updated = {
        ...book,
        customPresetOverrides: {
          ...(book.customPresetOverrides ?? {}),
          [presetId]: body,
        },
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(bookId, updated);
      return c.json({ ok: true, presetId, override: body });
    } catch {
      return c.json({ error: `Book "${bookId}" not found` }, 404);
    }
  });

  return app;
}
