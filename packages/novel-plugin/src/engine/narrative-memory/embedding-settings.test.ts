import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  EMBEDDING_SETTINGS_KV_KEY,
  parseEmbeddingSettingsPatch,
  probeEmbeddingSettings,
  readPublicEmbeddingSettings,
  saveEmbeddingSettings,
} from "./embedding-settings.js";
import { refreshBookEntityEmbeddings } from "./embedding-provider.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-embed-settings-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseEmbeddingSettingsPatch", () => {
  it("rejects invalid urls and keeps masked secrets", () => {
    expect(() => parseEmbeddingSettingsPatch({ baseUrl: "not-a-url" })).toThrow(/有效的 URL/);
    expect(parseEmbeddingSettingsPatch({ apiKey: "********abcd" })).toEqual({});
    expect(parseEmbeddingSettingsPatch({
      baseUrl: "https://api.siliconflow.cn/v1/",
      model: "BAAI/bge-m3",
      dim: 1024,
      apiKey: "sk-real",
    })).toEqual({
      baseUrl: "https://api.siliconflow.cn/v1",
      model: "BAAI/bge-m3",
      dim: 1024,
      apiKey: "sk-real",
    });
  });
});

describe("saveEmbeddingSettings", () => {
  it("writes embedding config into NovelFork kv, not process env", async () => {
    const previous = process.env.NOVELFORK_EMBEDDING_API_KEY;
    delete process.env.NOVELFORK_EMBEDDING_API_KEY;
    const storage = await createStorage();
    try {
      const publicSettings = await saveEmbeddingSettings({
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        dim: 1024,
        apiKey: "sk-embed",
      }, storage);
      expect(publicSettings.configured).toBe(true);
      expect(publicSettings.apiKeyMasked).toBe("********mbed");
      expect(process.env.NOVELFORK_EMBEDDING_API_KEY).toBeUndefined();

      const raw = storage.sqlite.prepare<{ value: string }>(
        `SELECT "value" FROM "kv_store" WHERE "key" = ?`,
      ).get(EMBEDDING_SETTINGS_KV_KEY);
      expect(JSON.parse(raw?.value ?? "{}")).toMatchObject({
        model: "BAAI/bge-m3",
        apiKey: "sk-embed",
      });

      const loaded = await readPublicEmbeddingSettings(storage);
      expect(loaded.configured).toBe(true);
      expect(loaded.model).toBe("BAAI/bge-m3");
    } finally {
      storage.close();
      if (previous === undefined) delete process.env.NOVELFORK_EMBEDDING_API_KEY;
      else process.env.NOVELFORK_EMBEDDING_API_KEY = previous;
    }
  });

  it("returns unconfigured defaults when kv is empty", async () => {
    const storage = await createStorage();
    try {
      const settings = await readPublicEmbeddingSettings(storage);
      expect(settings.configured).toBe(false);
      expect(settings.hasApiKey).toBe(false);
      expect(settings.model).toBe("BAAI/bge-m3");
      expect(settings.dim).toBe(1024);
    } finally {
      storage.close();
    }
  });
});

describe("probeEmbeddingSettings", () => {
  it("fails closed without api key", async () => {
    const storage = await createStorage();
    try {
      const result = await probeEmbeddingSettings({
        storage,
        embed: async () => { throw new Error("should not call"); },
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/API Key/);
    } finally {
      storage.close();
    }
  });

  it("returns dim from a successful embed", async () => {
    const storage = await createStorage();
    try {
      await saveEmbeddingSettings({
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        dim: 1024,
        apiKey: "sk-embed",
      }, storage);
      const result = await probeEmbeddingSettings({
        storage,
        embed: async (config, texts) => ({
          model: config.model,
          dim: 1024,
          vectors: texts.map(() => Array.from({ length: 1024 }, () => 0.1)),
        }),
      });
      expect(result).toEqual({ ok: true, model: "BAAI/bge-m3", dim: 1024 });
    } finally {
      storage.close();
    }
  });
});

describe("refreshBookEntityEmbeddings", () => {
  it("skips without embedding config in NovelFork kv", async () => {
    const storage = await createStorage();
    try {
      const result = await refreshBookEntityEmbeddings({
        storage,
        bookId: "book-1",
        dictionary: { bookId: "book-1", entries: [], index: new Map() },
      });
      expect(result.skipped).toBe("no-embedding-config");
    } finally {
      storage.close();
    }
  });
});
