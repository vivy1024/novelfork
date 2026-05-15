import { Hono } from "hono";
import {
  getStorageDatabase,
  createUserTemplateRepository,
} from "@vivy1024/novelfork-core";
import {
  listPresets,
  listBundles,
  getPreset,
  getBundle,
  getPresetsByGenre,
  listBeatTemplates,
} from "@vivy1024/novelfork-novel-plugin/engine";
import type { RouterContext } from "./context.js";

const REMOTE_TEMPLATES_URL =
  "https://raw.githubusercontent.com/vivy1024/novelfork-templates/main/index.json";

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

  // -------------------------------------------------------------------------
  // User Templates CRUD
  // -------------------------------------------------------------------------

  app.get("/api/presets/user-templates", (c) => {
    const bookId = c.req.query("bookId");
    const storage = getStorageDatabase();
    const repo = createUserTemplateRepository(storage);
    const templates = repo.list(bookId || undefined);
    return c.json({ templates });
  });

  app.post("/api/presets/user-templates", async (c) => {
    const body = await c.req.json<{
      id?: string;
      bookId?: string;
      name: string;
      genre?: string;
      description?: string;
      bundleJson: string;
    }>();

    if (!body.name || !body.bundleJson) {
      return c.json({ error: "name and bundleJson are required" }, 400);
    }

    const storage = getStorageDatabase();
    const repo = createUserTemplateRepository(storage);
    const id = body.id || crypto.randomUUID();
    const template = repo.create({
      id,
      bookId: body.bookId,
      name: body.name,
      genre: body.genre,
      description: body.description,
      bundleJson: body.bundleJson,
    });
    return c.json({ template }, 201);
  });

  app.put("/api/presets/user-templates/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      name?: string;
      genre?: string;
      description?: string;
      bundleJson?: string;
    }>();

    const storage = getStorageDatabase();
    const repo = createUserTemplateRepository(storage);
    const updated = repo.update(id, body);
    if (!updated) {
      return c.json({ error: `User template "${id}" not found` }, 404);
    }
    return c.json({ template: updated });
  });

  app.delete("/api/presets/user-templates/:id", (c) => {
    const id = c.req.param("id");
    const storage = getStorageDatabase();
    const repo = createUserTemplateRepository(storage);
    const deleted = repo.softDelete(id);
    if (!deleted) {
      return c.json({ error: `User template "${id}" not found` }, 404);
    }
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Remote Market Proxy
  // -------------------------------------------------------------------------

  app.get("/api/market/templates", async (c) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(REMOTE_TEMPLATES_URL, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return c.json({ templates: [] });
      }

      const data = await response.json();
      return c.json({ templates: Array.isArray(data) ? data : data.templates ?? [] });
    } catch {
      return c.json({ templates: [] });
    }
  });

  app.post("/api/market/templates/:id/download", async (c) => {
    const templateId = c.req.param("id");

    try {
      // Fetch remote template list
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(REMOTE_TEMPLATES_URL, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return c.json({ error: "Failed to fetch remote templates" }, 502);
      }

      const data = await response.json();
      const templates = Array.isArray(data) ? data : data.templates ?? [];
      const remoteTemplate = templates.find(
        (t: { id?: string }) => t.id === templateId,
      );

      if (!remoteTemplate) {
        return c.json({ error: `Remote template "${templateId}" not found` }, 404);
      }

      // Save to local user_template table
      const storage = getStorageDatabase();
      const repo = createUserTemplateRepository(storage);
      const localTemplate = repo.create({
        id: remoteTemplate.id || crypto.randomUUID(),
        name: remoteTemplate.name || "Untitled",
        genre: remoteTemplate.genre,
        description: remoteTemplate.description,
        bundleJson: JSON.stringify(remoteTemplate.bundle || remoteTemplate),
      });

      return c.json({ template: localTemplate }, 201);
    } catch {
      return c.json({ error: "Failed to download remote template" }, 502);
    }
  });

  return app;
}
