/**
 * 朱雀检测配置保存路由的契约测试（T-10）。
 *
 * 保存时就应拒绝内网 endpoint：配置一旦写入，之后每次检测都会用到它，
 * 不能等到使用时才发现它指向内网。发请求前还会再校验一次（存量配置可能早于校验写入）。
 * 「只允许管理员写」由产品层 domain.ts 的统一守卫负责，见 product-runtime 的
 * embedding-admin-keys.red.test.ts。
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStorageDatabase, createKvRepository, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createFilterRouter } from "./filter.js";
import { decryptSecret } from "../engine/secret-box.js";
import { createFilterReportRepository } from "../engine/filter/repositories/filter-report-repo.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-zhuque-route-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  return storage;
}

/** 测试里不做真实 DNS：示例域名一律解析到一个公网地址。 */
const resolvePublic = async () => ["203.0.113.10"];

function putZhuque(app: ReturnType<typeof createFilterRouter>, body: unknown) {
  return app.request("/api/settings/zhuque", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function scan(app: ReturnType<typeof createFilterRouter>) {
  return app.request("/api/filter/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "这是一段测试正文。" }),
  });
}

type ExplainedError = { error?: string; code?: string; explanation?: { whatHappened?: string; whyItMatters?: string; suggestedAction?: string } };

function expectExplained(body: ExplainedError) {
  expect(body.explanation?.whatHappened).toBeTruthy();
  expect(body.explanation?.whyItMatters).toBeTruthy();
  expect(body.explanation?.suggestedAction).toBeTruthy();
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PUT /api/settings/zhuque", () => {
  it("refuses an internal endpoint and does not persist it (T-10)", async () => {
    const storage = await createStorage();
    try {
      const app = createFilterRouter({ storage, resolveHost: resolvePublic });

      const response = await putZhuque(app, { apiKey: "k", endpoint: "http://10.0.0.5:8080/scan" });

      expect(response.status).toBe(400);
      expectExplained(await response.json() as ExplainedError);
      expect(await createKvRepository(storage).get("settings:zhuque")).toBeFalsy();
    } finally {
      storage.close();
    }
  });

  it.each([
    "file:///etc/passwd",
    "file:///C:/Users/someone/.novelfork/.secret-key",
    "data:application/json,{}",
    "ftp://example.com/scan",
  ])("refuses a non-http endpoint %s with an explanation and does not persist it", async (endpoint) => {
    const storage = await createStorage();
    try {
      const app = createFilterRouter({ storage, resolveHost: resolvePublic });

      const response = await putZhuque(app, { apiKey: "k", endpoint });

      expect(response.status).toBe(400);
      const body = await response.json() as ExplainedError;
      expect(body.code).toBe("ZHUQUE_ENDPOINT_REJECTED");
      expectExplained(body);
      expect(await createKvRepository(storage).get("settings:zhuque")).toBeFalsy();
    } finally {
      storage.close();
    }
  });

  it("refuses a domain whose DNS answer points into the internal network", async () => {
    const storage = await createStorage();
    try {
      const app = createFilterRouter({ storage, resolveHost: async () => ["192.168.1.7"] });

      const response = await putZhuque(app, { apiKey: "k", endpoint: "https://rebind.example/scan" });

      expect(response.status).toBe(400);
      expectExplained(await response.json() as ExplainedError);
      expect(await createKvRepository(storage).get("settings:zhuque")).toBeFalsy();
    } finally {
      storage.close();
    }
  });

  it("answers a malformed JSON body with 400 and an explanation instead of a 500", async () => {
    const storage = await createStorage();
    try {
      const app = createFilterRouter({ storage, resolveHost: resolvePublic });

      const response = await putZhuque(app, "{not json");

      expect(response.status).toBe(400);
      expectExplained(await response.json() as ExplainedError);
    } finally {
      storage.close();
    }
  });

  it("clamps timeoutMs into 1000–60000 and retries into 0–5 when saving", async () => {
    const storage = await createStorage();
    try {
      const app = createFilterRouter({ storage, resolveHost: resolvePublic });

      const response = await putZhuque(app, { apiKey: "k", endpoint: "https://api.zhuque.example/scan", timeoutMs: 10_000_000, retries: 99 });

      expect(response.status).toBe(200);
      const stored = JSON.parse(await createKvRepository(storage).get("settings:zhuque") ?? "{}") as { timeoutMs?: number; retries?: number };
      expect(stored.timeoutMs).toBe(60_000);
      expect(stored.retries).toBe(5);
    } finally {
      storage.close();
    }
  });

  it("explains a corrupt master key file instead of crashing, and leaves both the key file and the config untouched", async () => {
    const storage = await createStorage();
    const previousHome = process.env.NOVELFORK_HOME;
    const home = join(tmpdir(), `novelfork-zhuque-corrupt-key-${crypto.randomUUID()}`);
    tempDirs.push(home);
    await mkdir(home, { recursive: true });
    const corrupt = Buffer.alloc(16, 3);
    await writeFile(join(home, ".secret-key"), corrupt);
    process.env.NOVELFORK_HOME = home;
    try {
      const app = createFilterRouter({ storage, resolveHost: resolvePublic });

      const response = await putZhuque(app, { apiKey: "k-new", endpoint: "https://8.8.8.8/scan" });

      expect(response.status).toBe(500);
      const body = await response.json() as ExplainedError;
      expect(body.code).toBe("SECRET_KEY_FILE_CORRUPT");
      expectExplained(body);
      expect(Buffer.compare(await readFile(join(home, ".secret-key")), corrupt)).toBe(0);
      expect(await createKvRepository(storage).get("settings:zhuque")).toBeFalsy();
    } finally {
      if (previousHome === undefined) delete process.env.NOVELFORK_HOME;
      else process.env.NOVELFORK_HOME = previousHome;
      storage.close();
    }
  });

  it("sends the chapter text to the saved Zhuque endpoint on a manual scan, and only then (T-10)", async () => {
    const storage = await createStorage();
    try {
      const app = createFilterRouter({ storage, resolveHost: resolvePublic });
      await putZhuque(app, { apiKey: "k-zhuque-live", endpoint: "https://api.zhuque.example/scan" });

      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ aiProbability: 0.2, internal: "do-not-echo" }) });
      const scanApp = createFilterRouter({ storage, resolveHost: resolvePublic, fetchImpl: fetchSpy as unknown as typeof fetch });
      const response = await scan(scanApp);

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith("https://api.zhuque.example/scan", expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer k-zhuque-live" }),
        redirect: "manual",
      }));
      const body = await response.json() as { report?: { zhuque?: unknown } };
      expect(body.report?.zhuque).toEqual({ status: "success", score: 20 });
      expect(JSON.stringify(body)).not.toContain("do-not-echo");
    } finally {
      storage.close();
    }
  });

  it("still saves a public endpoint", async () => {
    const storage = await createStorage();
    try {
      const app = createFilterRouter({ storage, resolveHost: resolvePublic });

      const response = await putZhuque(app, { apiKey: "k-zhuque-secret", endpoint: "https://api.zhuque.example/scan" });

      expect(response.status).toBe(200);
      const stored = await createKvRepository(storage).get("settings:zhuque");
      expect(stored).toBeTruthy();
      expect(stored ?? "").not.toContain("k-zhuque-secret");
      const parsed = JSON.parse(stored ?? "{}") as { apiKey?: unknown };
      expect(parsed.apiKey).toMatchObject({ enc: "v1" });
      expect(await decryptSecret(parsed.apiKey)).toBe("k-zhuque-secret");
    } finally {
      storage.close();
    }
  });

  it("sends nothing to Zhuque on a manual scan when no config was saved (no behaviour change)", async () => {
    const storage = await createStorage();
    try {
      const fetchSpy = vi.fn();
      const app = createFilterRouter({ storage, fetchImpl: fetchSpy as unknown as typeof fetch });

      const response = await scan(app);

      expect(response.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      const body = await response.json() as { report?: { zhuque?: { status?: string } } };
      expect(body.report?.zhuque?.status).toBe("not-configured");
    } finally {
      storage.close();
    }
  });
});

describe("stored Zhuque config read back at scan time", () => {
  it("refuses a legacy file: endpoint written before validation existed, without sending anything", async () => {
    const storage = await createStorage();
    try {
      await createKvRepository(storage).set("settings:zhuque", JSON.stringify({ apiKey: "k-legacy", endpoint: "file:///etc/passwd", timeoutMs: 10_000, retries: 2 }));
      const fetchSpy = vi.fn();
      const app = createFilterRouter({ storage, resolveHost: resolvePublic, fetchImpl: fetchSpy as unknown as typeof fetch });

      const response = await scan(app);

      expect(response.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      const body = await response.json() as { report?: { zhuque?: { status?: string } } };
      expect(body.report?.zhuque?.status).toBe("failed");
    } finally {
      storage.close();
    }
  });

  it("treats an undecryptable key as not configured instead of failing the whole scan with 500", async () => {
    const storage = await createStorage();
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const sealedUnderAnotherKey = { enc: "v1", iv: "AAAAAAAAAAAAAAAA", tag: "AAAAAAAAAAAAAAAAAAAAAA==", ct: "AAAA" };
      await createKvRepository(storage).set("settings:zhuque", JSON.stringify({ apiKey: sealedUnderAnotherKey, endpoint: "https://8.8.8.8/scan" }));
      const fetchSpy = vi.fn();
      const app = createFilterRouter({ storage, resolveHost: resolvePublic, fetchImpl: fetchSpy as unknown as typeof fetch });

      const response = await scan(app);

      expect(response.status).toBe(200);
      const body = await response.json() as { report?: { zhuque?: { status?: string } } };
      expect(body.report?.zhuque?.status).toBe("not-configured");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("朱雀");
    } finally {
      storage.close();
    }
  });

  it("treats corrupt JSON in the stored config as not configured, for batch rescans too", async () => {
    const storage = await createStorage();
    try {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await createKvRepository(storage).set("settings:zhuque", "{corrupt");
      const app = createFilterRouter({ storage, resolveHost: resolvePublic });

      const single = await scan(app);
      const batch = await app.request("/api/books/book-1/filter/batch-rescan", { method: "POST" });

      expect(single.status).toBe(200);
      expect(batch.status).toBe(200);
    } finally {
      storage.close();
    }
  });
});

describe("GET /api/books/:bookId/filter/report", () => {
  it("never echoes a raw Zhuque body that older versions stored in the report details", async () => {
    const storage = await createStorage();
    try {
      await createFilterReportRepository(storage).insert({
        id: "report-legacy-raw",
        bookId: "book-raw",
        chapterNumber: 1,
        aiTasteScore: 10,
        level: "clean",
        hitCountsJson: "{}",
        zhuqueScore: 33,
        zhuqueStatus: "success",
        details: JSON.stringify({ aiTasteScore: 10, zhuque: { status: "success", score: 33, raw: { leaked: "root:x:0:0" } } }),
        engineVersion: "filter-v1",
        scannedAt: new Date(),
      });
      const app = createFilterRouter({ storage });

      const list = await app.request("/api/books/book-raw/filter/report");
      const single = await app.request("/api/books/book-raw/filter/report/1");

      const listText = await list.text();
      const singleText = await single.text();
      expect(listText).not.toContain("root:x");
      expect(singleText).not.toContain("root:x");
      expect(JSON.parse(singleText).report.details.zhuque).toEqual({ status: "success", score: 33 });
    } finally {
      storage.close();
    }
  });
});
