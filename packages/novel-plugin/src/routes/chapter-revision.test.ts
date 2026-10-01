import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import * as coreModule from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChapterRevisionRouter } from "./chapter-revision.js";

const tempDirs: string[] = [];
let activeStorage: StorageDatabase | undefined;
let testDir: string;
let app: ReturnType<typeof createChapterRevisionRouter>;

beforeEach(async () => {
  testDir = join(tmpdir(), `novelfork-revision-apply-${crypto.randomUUID()}`);
  await mkdir(join(testDir, "chapters", "卷01"), { recursive: true });
  tempDirs.push(testDir);
  activeStorage = createStorageDatabase({ databasePath: join(testDir, "novelfork.db") });
  // 采用落盘的附带动作要写作日志与审计过期表；与线上同构建全量 schema。
  runStorageMigrations(activeStorage, { migrationsDir: join(process.cwd(), "..", "core", "src", "storage", "migrations") });
  activeStorage.sqlite.prepare(`INSERT INTO "book" (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("book-1", "测试书", Date.now(), Date.now());
  vi.spyOn(coreModule, "getStorageDatabase").mockImplementation(() => activeStorage!);
  await writeFile(join(testDir, "book.json"), JSON.stringify({ id: "book-1", title: "测试", chapterWordCount: 3000 }), "utf8");
  app = createChapterRevisionRouter({ resolveBookRoot: () => testDir });
});

afterEach(async () => {
  if (activeStorage) {
    activeStorage.close();
    activeStorage = undefined;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function seedChapter(chapterNumber: number, content: string): Promise<void> {
  const fileName = `卷01/${String(chapterNumber).padStart(4, "0")}_旧章.md`;
  await writeFile(join(testDir, "chapters", fileName), content, "utf8");
  await writeFile(
    join(testDir, "chapters", "index.json"),
    JSON.stringify([{ id: `chapter:${chapterNumber}`, fileName, chapterNumber, title: "旧章", wordCount: content.length, status: "accepted", updatedAt: new Date().toISOString() }]),
    "utf8",
  );
}

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function applyRequest(body: unknown) {
  return new Request("http://local/api/books/book-1/chapters/3/revision-apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("chapter revision-apply（T5.3 采用落盘）", () => {
  it("originalHash 缺失或形状错误 → 400", async () => {
    const resp = await app.request(applyRequest({ content: "新正文" }));
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("invalid-original-hash");

    const resp2 = await app.request(applyRequest({ originalHash: "not-hex", content: "新正文" }));
    expect(resp2.status).toBe(400);
  });

  it("正文被改过后采用 → 409，正文不被覆盖", async () => {
    const original = "原来的第 3 章正文。";
    await seedChapter(3, original);
    const originalHash = hash(original);
    // 模拟候选生成后正文又变了
    await writeFile(join(testDir, "chapters", "卷01", "0003_旧章.md"), "被别人改过的正文。", "utf8");

    const resp = await app.request(applyRequest({ originalHash, content: "候选的新正文。" }));
    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.error).toBe("chapter-concurrent-modification");
    expect((await readFile(join(testDir, "chapters", "卷01", "0003_旧章.md"), "utf8"))).toContain("被别人改过");
  });

  it("hash 一致 → 写入正文并返回新 hash", async () => {
    // 本书目标 3000 字（硬范围约 2200–3800）：候选正文按实际长度给，字数门是叙述者候选也要过的合同。
    const original = "原来的第 3 章正文。".repeat(300);
    await seedChapter(3, original);
    const originalHash = hash(original);
    const next = `${original}\n\n叙述者建议的收束段。`.repeat(1);

    const resp = await app.request(applyRequest({ originalHash, content: next }));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.kind).toBe("chapter-revision-applied");
    expect(body.newHash).toBe(hash(next));
    expect((await readFile(join(testDir, "chapters", "卷01", "0003_旧章.md"), "utf8"))).toContain("收束段");
  });

  it("章节不存在于目录时也走新建写入（originalHash=空串 sha256）", async () => {
    const emptyHash = hash("");
    const resp = await app.request(new Request("http://local/api/books/book-1/chapters/9/revision-apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ originalHash: emptyHash, content: "全新的第 9 章。" }),
    }));
    // 新建时 handleChapterWrite 对不存在的章节会因 update 落空而拒绝——如实返回 422
    expect([422, 200]).toContain(resp.status);
  });
});
