/**
 * storyline.propose 的行为契约 —— 经 executeRuntimeDomainTool 走完整分发。
 *
 * 锁住三条产品判断：
 *   · 只产 needs-review 草稿，叙述者不能给自己盖章；
 *   · 同书同名的待审草稿幂等复用（归纳时重复主张不会堆一堆草稿）；
 *   · relatedEntryTitles 只解析不建实体，解析不出的名字如实列出。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import * as coreModule from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getStoryline, listStorylines } from "../engine/narrative-memory/scene-store.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { executeRuntimeDomainTool, type TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

const tempDirs: string[] = [];
let activeStorage: StorageDatabase | undefined;
let testDir: string;
let binding: TrustedRuntimeBookBinding;

async function seedBook(storage: StorageDatabase): Promise<void> {
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "..", "core", "src", "storage", "migrations") });
  storage.sqlite
    .prepare(`INSERT INTO "book" (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("book-test-1", "测试书", Date.now(), Date.now());
  const now = new Date("2026-09-01T00:00:00.000Z");
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-1", bookId: "book-test-1", key: "characters", name: "角色", description: "", icon: null, order: 1, enabled: true,
    showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: null,
    sourceTemplate: null, createdAt: now, updatedAt: now,
  });
}

async function seedEntry(storage: StorageDatabase, id: string, title: string): Promise<void> {
  const now = new Date("2026-09-01T00:00:00.000Z");
  await createStoryJingweiEntryRepository(storage).create({
    id, bookId: "book-test-1", sectionId: "sec-1", title, contentMd: "",
    category: "characters", fields: {}, customFields: {}, tags: [], aliases: [],
    relatedChapterNumbers: [], relatedEntryIds: [], visibilityRule: { type: "tracked" }, participatesInAi: true,
    tokenBudget: null, layer: "canon", status: "confirmed", createdAt: now, updatedAt: now,
  });
}

async function propose(input: Record<string, unknown>) {
  return executeRuntimeDomainTool("storyline.propose", input, binding, {} as never);
}

beforeEach(async () => {
  testDir = join(tmpdir(), `novelfork-storyline-propose-${crypto.randomUUID()}`);
  await mkdir(testDir, { recursive: true });
  tempDirs.push(testDir);
  activeStorage = createStorageDatabase({ databasePath: join(testDir, "novelfork.db") });
  await seedBook(activeStorage);
  vi.spyOn(coreModule, "getStorageDatabase").mockImplementation(() => activeStorage!);
  binding = { bookId: "book-test-1", root: testDir };
});

afterEach(async () => {
  if (activeStorage) {
    activeStorage.close();
    activeStorage = undefined;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("storyline.propose", () => {
  it("提交待审草稿：只进 needs-review，确认权在作者", async () => {
    const result = await propose({ bookId: "book-test-1", name: "主线·寻找失踪的哥哥", kind: "main", goal: "找到哥哥的下落" });
    expect(result.ok).toBe(true);
    const lines = listStorylines(activeStorage!, "book-test-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: "主线·寻找失踪的哥哥", kind: "main", status: "needs-review", layer: "dynamic", source: "inferred" });
  });

  it("同书同名的待审草稿幂等复用，不重复创建", async () => {
    const first = await propose({ bookId: "book-test-1", name: "感情线" });
    const second = await propose({ bookId: "book-test-1", name: "感情线" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect((second.data as { reused: boolean }).reused).toBe(true);
    expect((second.data as { storylineId: string }).storylineId).toBe((first.data as { storylineId: string }).storylineId);
    expect(listStorylines(activeStorage!, "book-test-1")).toHaveLength(1);
  });

  it("relatedEntryTitles 按标题解析，解析不出的名字如实列出且不建实体", async () => {
    await seedEntry(activeStorage!, "entry-xue", "薛行之");
    const result = await propose({
      bookId: "book-test-1",
      name: "主线",
      relatedEntryTitles: ["薛行之", "不存在的人"],
    });
    expect(result.ok).toBe(true);
    const data = result.data as { resolvedEntries: { title: string }[]; unresolvedNames: string[]; linkedEntry?: { id: string } };
    expect(data.resolvedEntries.map((entry) => entry.title)).toEqual(["薛行之"]);
    expect(data.unresolvedNames).toEqual(["不存在的人"]);
    expect(data.linkedEntry?.id).toBe("entry-xue");
    const line = listStorylines(activeStorage!, "book-test-1")[0];
    expect(line.entryId).toBe("entry-xue");
  });

  it("name 为空与 kind 非法都被挡下", async () => {
    expect((await propose({ bookId: "book-test-1", name: "  " })).ok).toBe(false);
    expect((await propose({ bookId: "book-test-1", name: "线", kind: "epic" })).ok).toBe(false);
    expect(listStorylines(activeStorage!, "book-test-1")).toHaveLength(0);
  });

  it("已确认的剧情线不再被 reviewStoryline 改写状态", async () => {
    const storage = activeStorage!;
    const { reviewStoryline, createStoryline } = await import("../engine/narrative-memory/scene-store.js");
    const created = createStoryline(storage, { bookId: "book-test-1", name: "作者手建", layer: "canon", status: "confirmed", source: "manual" });
    expect(created.ok).toBe(true);
    const reviewed = reviewStoryline(storage, created.data!.id, "rejected");
    expect(reviewed.ok).toBe(false);
    expect(getStoryline(storage, created.data!.id)?.status).toBe("confirmed");
  });
});
