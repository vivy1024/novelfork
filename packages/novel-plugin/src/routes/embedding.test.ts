import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createEmbeddingSettingsRouter } from "./embedding.js";
import { EMBEDDING_SETTINGS_KV_KEY } from "../engine/narrative-memory/embedding-settings.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-embed-route-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createEmbeddingSettingsRouter", () => {
  it("exposes get/put/test and persists into kv", async () => {
    const storage = await createStorage();
    try {
      const app = createEmbeddingSettingsRouter({ storage });
      const paths = app.routes.map((route) => `${route.method} ${route.path}`).sort();
      expect(paths).toContain("GET /api/embedding");
      expect(paths).toContain("PUT /api/embedding");
      expect(paths).toContain("POST /api/embedding/test");

      const initial = await app.request("/api/embedding");
      expect(initial.status).toBe(200);
      expect(await initial.json()).toMatchObject({ configured: false, model: "BAAI/bge-m3", dim: 1024 });

      const invalid = await app.request("/api/embedding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: "ftp://example.com" }),
      });
      expect(invalid.status).toBe(400);

      const saved = await app.request("/api/embedding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://api.siliconflow.cn/v1",
          model: "BAAI/bge-m3",
          dim: 1024,
          apiKey: "sk-embed",
        }),
      });
      expect(saved.status).toBe(200);
      const body = await saved.json() as { configured: boolean; apiKeyMasked: string };
      expect(body.configured).toBe(true);
      expect(body.apiKeyMasked).toBe("********mbed");

      const raw = storage.sqlite.prepare<{ value: string }>(
        `SELECT "value" FROM "kv_store" WHERE "key" = ?`,
      ).get(EMBEDDING_SETTINGS_KV_KEY);
      expect(JSON.parse(raw?.value ?? "{}").apiKey).toBe("sk-embed");
      expect(process.env.NOVELFORK_EMBEDDING_API_KEY).not.toBe("sk-embed");
    } finally {
      storage.close();
    }
  });
});
