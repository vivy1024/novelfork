import { Hono } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import {
  parseEmbeddingSettingsPatch,
  probeEmbeddingSettings,
  readPublicEmbeddingSettings,
  saveEmbeddingSettings,
} from "../engine/narrative-memory/embedding-settings.js";

export interface CreateEmbeddingSettingsRouterOptions {
  readonly storage?: StorageDatabase;
}

/**
 * 全局 embedding 提供商配置。不走 Runtime /api/settings，避免挤进 chat 供应商。
 * 落到 NovelFork 产品库 kv_store。
 */
export function createEmbeddingSettingsRouter(options: CreateEmbeddingSettingsRouterOptions = {}): Hono {
  const app = new Hono();
  const storage = () => options.storage ?? getStorageDatabase();

  app.get("/api/embedding", async (c) => {
    return c.json(await readPublicEmbeddingSettings(storage()));
  });

  app.put("/api/embedding", async (c) => {
    try {
      const body = await c.req.json().catch(() => null);
      const patch = parseEmbeddingSettingsPatch(body);
      const settings = await saveEmbeddingSettings(patch, storage());
      return c.json(settings);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/embedding/test", async (c) => {
    const result = await probeEmbeddingSettings({ storage: storage() });
    return c.json(result, result.ok ? 200 : 400);
  });

  return app;
}
