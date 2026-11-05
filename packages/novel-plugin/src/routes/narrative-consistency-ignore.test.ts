/**
 * 叙事体检路由：GET /consistency 读真实章节正文跑场景校验；忽略 / 撤销忽略持久化。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { refreshNarrativeEntityIndex } from "../engine/narrative-entity/entity-index.js";
import { applyNarrativeEvents } from "../engine/narrative-memory/reducer.js";
import { insertNarrativeEvent } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent } from "../engine/narrative-memory/types.js";
import { upsertLedgerEntry } from "../handlers/jingwei-ledger-store.js";
import { createNarrativeMemoryRouter } from "./narrative-memory.js";

const tempDirs: string[] = [];
const BOOK = "book-1";
const CH3 = "夜色沉沉。甲一掌拍碎了石桌，震得乙连退三步。";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(): Promise<{ storage: StorageDatabase; bookRoot: string }> {
  const dir = join(tmpdir(), `novelfork-consistency-route-${crypto.randomUUID()}`);
  tempDirs.push(dir);
  const bookRoot = join(dir, "book");
  await mkdir(join(bookRoot, "chapters"), { recursive: true });
  await writeFile(join(bookRoot, "chapters", "0003.md"), CH3, "utf-8");
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-10-20T00:00:00.000Z");
  await createBookRepository(storage).create({ id: BOOK, name: "路由", jingweiMode: "dynamic", currentChapter: 3, createdAt: now, updatedAt: now });
  upsertLedgerEntry(storage, { bookId: BOOK, category: "characters", title: "甲", contentMd: "主角" });
  upsertLedgerEntry(storage, { bookId: BOOK, category: "characters", title: "乙", contentMd: "对手" });
  const events: NarrativeEvent[] = [
    { chapterNumber: 2, eventType: "character_state_changed", subject: "甲", predicate: "身亡", object: "死亡", evidenceText: "甲断了气。" },
    { chapterNumber: 3, eventType: "relationship_changed", subject: "甲", predicate: "击退", object: "乙", evidenceText: "甲一掌拍碎了石桌，震得乙连退三步。" },
  ].map((item, index) => ({
    ...item,
    id: `ev-${index}`,
    bookId: BOOK,
    confidence: 0.9,
    source: "settle",
    status: "applied",
    riskLevel: "low",
    createdAt: now.toISOString(),
  }) as NarrativeEvent);
  for (const record of events) insertNarrativeEvent(storage, record);
  applyNarrativeEvents(storage, BOOK, events);
  refreshNarrativeEntityIndex(storage, BOOK);
  return { storage, bookRoot };
}

async function postJson(app: ReturnType<typeof createNarrativeMemoryRouter>, path: string, body: unknown) {
  return app.request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("叙事体检路由", () => {
  it("读章节正文检出场景矛盾；忽略后不再出现，撤销后恢复", async () => {
    const { storage, bookRoot } = await setup();
    try {
      const app = createNarrativeMemoryRouter({ storage, resolveBookRoot: () => bookRoot });
      const base = `/api/books/${BOOK}/narrative-memory/consistency`;

      const first = await (await app.request(`http://localhost${base}`)).json() as { findings: Array<{ kind: string; evidenceText: string; ignoreKey: Record<string, unknown> }>; ignored: unknown[] };
      const finding = first.findings.find((item) => item.kind === "scene-dead-acts");
      expect(finding?.evidenceText).toBe("甲一掌拍碎了石桌，震得乙连退三步。");

      expect((await postJson(app, `${base}/ignores`, finding!.ignoreKey)).status).toBe(200);
      const after = await (await app.request(`http://localhost${base}`)).json() as { findings: Array<{ kind: string }>; ignored: Array<{ kind: string }> };
      expect(after.findings.some((item) => item.kind === "scene-dead-acts")).toBe(false);
      expect(after.ignored.map((item) => item.kind)).toEqual(["scene-dead-acts"]);

      const removed = await (await postJson(app, `${base}/ignores/remove`, finding!.ignoreKey)).json() as { removed: boolean };
      expect(removed.removed).toBe(true);
      const restored = await (await app.request(`http://localhost${base}`)).json() as { findings: Array<{ kind: string }> };
      expect(restored.findings.some((item) => item.kind === "scene-dead-acts")).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("忽略请求缺检测类型时拒绝", async () => {
    const { storage, bookRoot } = await setup();
    try {
      const app = createNarrativeMemoryRouter({ storage, resolveBookRoot: () => bookRoot });
      const response = await postJson(app, `/api/books/${BOOK}/narrative-memory/consistency/ignores`, { entityId: "x" });
      expect(response.status).toBe(400);
    } finally {
      storage.close();
    }
  });

  it("entityId / factId 超长时拒绝，不静默截断成另一把键", async () => {
    const { storage, bookRoot } = await setup();
    try {
      const app = createNarrativeMemoryRouter({ storage, resolveBookRoot: () => bookRoot });
      const base = `/api/books/${BOOK}/narrative-memory/consistency/ignores`;
      expect((await postJson(app, base, { kind: "scene-dead-acts", entityId: "e".repeat(401) })).status).toBe(400);
      expect((await postJson(app, `${base}/remove`, { kind: "scene-dead-acts", factId: "f".repeat(401) })).status).toBe(400);
      expect((await postJson(app, base, { kind: "scene-dead-acts", entityId: 42 })).status).toBe(400);
      // 正好 400 仍可用
      expect((await postJson(app, base, { kind: "scene-dead-acts", entityId: "e".repeat(400) })).status).toBe(200);
    } finally {
      storage.close();
    }
  });

  it("书不在产品库里时记忽略返回 404（外键与迁移一致），不抛 500", async () => {
    const { storage, bookRoot } = await setup();
    try {
      const app = createNarrativeMemoryRouter({ storage, resolveBookRoot: () => bookRoot });
      const response = await postJson(app, `/api/books/book-missing/narrative-memory/consistency/ignores`, { kind: "scene-dead-acts" });
      expect(response.status).toBe(404);
      const body = await response.json() as { explanation: { whatHappened: string } };
      expect(body.explanation.whatHappened).toContain("不在叙事记忆库里");
    } finally {
      storage.close();
    }
  });
});
