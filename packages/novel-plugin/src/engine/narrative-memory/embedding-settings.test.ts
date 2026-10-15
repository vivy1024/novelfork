import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKvRepository, createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  EMBEDDING_SETTINGS_KV_KEY,
  loadEmbeddingConfig,
  parseEmbeddingSettingsPatch,
  probeEmbeddingSettings,
  readPublicEmbeddingSettings,
  saveEmbeddingSettings,
} from "./embedding-settings.js";
import { refreshBookEntityEmbeddings } from "./embedding-provider.js";
import { decryptSecret, encryptSecret } from "../secret-box.js";

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
      const stored = JSON.parse(raw?.value ?? "{}") as { model?: string; apiKey?: unknown };
      expect(stored.model).toBe("BAAI/bge-m3");
      expect(raw?.value ?? "").not.toContain("sk-embed");
      expect(stored.apiKey).toMatchObject({ enc: "v1" });
      expect(await decryptSecret(stored.apiKey)).toBe("sk-embed");

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

describe("embedding base url policy (按 NarraFork 口径：管理员配置，允许本地与内网，只限协议)", () => {
  it.each([
    "http://localhost:11434/v1",
    "http://127.0.0.1:1234/v1",
    "http://10.0.0.5:8080/v1",
    "http://192.168.1.20:11434/v1",
  ])("accepts an admin-configured local or LAN model service %s", async (baseUrl) => {
    const storage = await createStorage();
    try {
      const saved = await saveEmbeddingSettings({ baseUrl, model: "bge-m3", dim: 1024, apiKey: "sk-local" }, storage);
      expect(saved.configured).toBe(true);
      expect(saved.baseUrl).toBe(baseUrl);
    } finally {
      storage.close();
    }
  });

  it("lets a user with a localhost endpoint change only the model name", async () => {
    const storage = await createStorage();
    try {
      await saveEmbeddingSettings({ baseUrl: "http://localhost:11434/v1", model: "m1", dim: 1024, apiKey: "sk-local" }, storage);

      const changed = await saveEmbeddingSettings({ model: "m2" }, storage);

      expect(changed.model).toBe("m2");
      expect(changed.configured).toBe(true);
    } finally {
      storage.close();
    }
  });

  it.each(["file:///etc/passwd", "ftp://example.com/v1", "data:text/plain,x"])("refuses a %s base url in a patch", (baseUrl) => {
    expect(() => parseEmbeddingSettingsPatch({ baseUrl })).toThrow(/http|URL/);
  });

  it("treats a legacy non-http base url already stored in kv as not configured, and never calls the provider", async () => {
    const storage = await createStorage();
    try {
      const sealed = await encryptSecret("sk-legacy");
      await createKvRepository(storage).set(
        EMBEDDING_SETTINGS_KV_KEY,
        JSON.stringify({ baseUrl: "file:///etc/passwd", model: "m", dim: 8, apiKey: sealed }),
      );
      const embed = vi.fn();

      expect(await loadEmbeddingConfig(storage)).toBeNull();
      const probe = await probeEmbeddingSettings({ storage, embed });

      expect(probe.ok).toBe(false);
      expect(embed).not.toHaveBeenCalled();
    } finally {
      storage.close();
    }
  });

  it("refuses to save over a legacy non-http base url without a new valid one, explaining what to do", async () => {
    const storage = await createStorage();
    try {
      await createKvRepository(storage).set(
        EMBEDDING_SETTINGS_KV_KEY,
        JSON.stringify({ baseUrl: "file:///etc/passwd", model: "m", dim: 8, apiKey: "sk-legacy-plain" }),
      );

      // 存量地址读出时已按未配置处理，补丁不带地址时回落到默认公网地址，不会沿用 file:。
      const saved = await saveEmbeddingSettings({ model: "m2" }, storage);
      expect(saved.baseUrl.startsWith("https://")).toBe(true);
      await expect(saveEmbeddingSettings({ baseUrl: "file:///etc/hosts" } as never, storage)).rejects.toThrow(/http/);
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

  it("does not echo internal host or port from a failed probe (T-10)", async () => {
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
        embed: async () => { throw new Error("connect ECONNREFUSED 203.0.113.9:8443"); },
      });
      expect(result.ok).toBe(false);
      expect(result.error).not.toContain("8443");
      expect(result.error).not.toContain("203.0.113.9");
    } finally {
      storage.close();
    }
  });

  it("tells an auth failure apart from a network failure without echoing details", async () => {
    const storage = await createStorage();
    try {
      await saveEmbeddingSettings({
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        dim: 1024,
        apiKey: "sk-embed",
      }, storage);
      const authFailure = await probeEmbeddingSettings({
        storage,
        embed: async () => { throw Object.assign(new Error("401 Incorrect API key sk-embed"), { status: 401 }); },
      });
      expect(authFailure.error).toMatch(/API Key/);
      expect(authFailure.error).not.toContain("sk-embed");
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
