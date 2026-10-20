/**
 * B1：经纬冲突的解除路径。
 *
 * 问题：`recordLedgerConflict` 只负责**记**——写 `jingwei_ledger_conflict` 行，并在条目上挂
 * `conflict_status=pending`。此前除了 revert / retire / softDelete 没有任何地方清：作者在经纬
 * 条目页读完警示、核对完再保存，`PUT /jingwei/entries/:id` 不传 conflictStatus，
 * `entry-repo.update` 又遵循「未提供则保留原值」，于是 pending 与那条记录永久残留——
 * 条目页一直显示「存在协同修改冲突」，「待确认」面板里那一项也永远消不掉。
 *
 * 作者的这次保存本身就是裁决（保留自己这一版），因此这条路由要顺手复位。
 *
 * B1 回归：这个复位必须是**显式**的，只能由「作者保存内容」的路径触发。单条 move、
 * 批量移动 / 改状态只是整理条目，不代表作者核对过机器那一版；它们既不能复位条目上的
 * pending，也不能删台账行，否则「待确认」里的冲突项会被偷偷清掉。
 *
 * 临时目录放在仓库内被忽略的 `packages/novel-plugin/tmp/`：本仓库约定测试不在仓库外
 * 路径写文件。
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  listLedgerConflicts,
  recordLedgerConflict,
  resolveLedgerConflict,
} from "../engine/jingwei/ledger-conflict-store.js";
import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { createCharacterVoiceRouter } from "./character-voice.js";
import { createJingweiRouter } from "./jingwei.js";

const TMP_ROOT = join(process.cwd(), "tmp", "jingwei-conflict-resolve");

let storage: StorageDatabase;
let tempDir: string;

async function readConflictStatus(entryId: string): Promise<string | undefined> {
  const entry = await createStoryJingweiEntryRepository(storage).getById("book-1", entryId);
  return entry?.conflictStatus;
}

/** 造一条被机器写入撞车挂上 pending 的条目，返回条目 id。 */
async function seedPendingConflict(): Promise<string> {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const repo = createStoryJingweiEntryRepository(storage);
  await repo.create({
    id: "entry-1",
    bookId: "book-1",
    sectionId: "sec-1",
    title: "韩立",
    contentMd: "作者写的内容",
    category: "characters",
    fields: {},
    customFields: {},
    tags: [],
    aliases: [],
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "tracked" },
    participatesInAi: true,
    tokenBudget: null,
    layer: "dynamic",
    status: "confirmed",
    source: "user",
    createdAt: now,
    updatedAt: now,
  });
  recordLedgerConflict(storage, "book-1", {
    reason: "版本不符",
    info: {
      kind: "version-mismatch",
      entryId: "entry-1",
      category: "characters",
      title: "韩立",
      expectedVersion: 1,
      currentVersion: 2,
      changedBy: "auto-settle",
      changedFields: ["contentMd", "fields"],
    },
  });
  return "entry-1";
}

beforeEach(async () => {
  tempDir = join(TMP_ROOT, crypto.randomUUID());
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-09-01T00:00:00.000Z");
  await createBookRepository(storage).create({
    id: "book-1",
    name: "冲突解除测试",
    jingweiMode: "dynamic",
    currentChapter: 1,
    createdAt: now,
    updatedAt: now,
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-1",
    bookId: "book-1",
    key: "characters",
    name: "角色",
    description: "",
    icon: null,
    order: 0,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
    builtinKind: null,
    sourceTemplate: null,
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

function request(path: string, init?: RequestInit): Promise<Response> {
  return createJingweiRouter({ storage }).request(
    `http://localhost/api/books/book-1/jingwei${path}`,
    init,
  );
}

describe("经纬冲突的解除路径（B1）", () => {
  it("前提：记录冲突后条目挂 pending，且「待确认」里能看到它", async () => {
    const entryId = await seedPendingConflict();

    expect(await readConflictStatus(entryId)).toBe("pending");
    expect(listLedgerConflicts(storage, "book-1")).toHaveLength(1);
  });

  it("作者在条目页保存（不传 conflictStatus）就清掉待处理冲突", async () => {
    const entryId = await seedPendingConflict();

    // 关键：请求体里**没有** conflictStatus。这正是此前残留的原因——
    // 面板/编辑器保存时不传它，update 便保留原值 pending。
    const response = await request(`/entries/${entryId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "韩立", contentMd: "作者改过的内容" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { entry: { conflictStatus?: string; conflictDetail?: string } };
    expect(body.entry.conflictStatus).toBe("none");
    expect(body.entry.conflictDetail).toBeUndefined();
    expect(await readConflictStatus(entryId)).toBe("none");
    expect(listLedgerConflicts(storage, "book-1")).toEqual([]);
  });

  it("机器再写一次仍会重新挂上 pending（不是把闸门关掉，只是清掉已裁决的）", async () => {
    const entryId = await seedPendingConflict();
    await request(`/entries/${entryId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentMd: "作者改过的内容" }),
    });
    expect(await readConflictStatus(entryId)).toBe("none");

    recordLedgerConflict(storage, "book-1", {
      reason: "又撞了一次",
      info: {
        kind: "version-mismatch",
        entryId,
        category: "characters",
        title: "韩立",
        expectedVersion: 3,
        currentVersion: 4,
        changedBy: "auto-settle",
        changedFields: ["fields"],
      },
    });

    expect(await readConflictStatus(entryId)).toBe("pending");
    expect(listLedgerConflicts(storage, "book-1")).toHaveLength(1);
  });

  it("机器自己写入时不会顺手把自己的冲突标记抹掉", async () => {
    const entryId = await seedPendingConflict();

    // agent 侧写入走 entryRepo.update（source 非 user）：待处理状态必须保留，
    // 否则机器每次重试都会把「作者还没核对」这件事洗掉。
    await createStoryJingweiEntryRepository(storage).update("book-1", entryId, {
      contentMd: "机器版本",
      source: "agent-write",
      changedBy: "agent",
    });

    expect(await readConflictStatus(entryId)).toBe("pending");
    expect(listLedgerConflicts(storage, "book-1")).toHaveLength(1);
  });
});

describe("整理动作不替作者裁决冲突（B1 回归）", () => {
  it("单条 move 只改位置：条目仍挂 pending，台账行保留", async () => {
    const entryId = await seedPendingConflict();

    const response = await request(`/entries/${entryId}/move`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: null }),
    });

    expect(response.status).toBe(200);
    expect(await readConflictStatus(entryId)).toBe("pending");
    expect(listLedgerConflicts(storage, "book-1")).toHaveLength(1);
  });

  it("bulk move 只改分类：条目仍挂 pending，台账行保留", async () => {
    const entryId = await seedPendingConflict();

    const response = await request("/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", entryIds: [entryId], target: "characters" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, affected: 1 });
    expect(await readConflictStatus(entryId)).toBe("pending");
    expect(listLedgerConflicts(storage, "book-1")).toHaveLength(1);
  });

  it("bulk set-status 只改状态：条目仍挂 pending，台账行保留", async () => {
    const entryId = await seedPendingConflict();

    const response = await request("/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-status", entryIds: [entryId], target: "draft" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, affected: 1 });
    expect(await readConflictStatus(entryId)).toBe("pending");
    expect(listLedgerConflicts(storage, "book-1")).toHaveLength(1);
  });

  it("自动回写传 resolveConflict=false：字段照写，但不替作者裁决冲突", async () => {
    const entryId = await seedPendingConflict();

    // 章节提拔后的大纲目标章号回写走同一个 PUT，但它不是作者在核对冲突。
    const response = await request(`/entries/${entryId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fields: { targetChapterNumber: 2 },
        revisionReason: "promote-outline",
        resolveConflict: false,
      }),
    });

    expect(response.status).toBe(200);
    const entry = await createStoryJingweiEntryRepository(storage).getById("book-1", entryId);
    expect(entry?.fields.targetChapterNumber).toBe(2);
    expect(await readConflictStatus(entryId)).toBe("pending");
    expect(listLedgerConflicts(storage, "book-1")).toHaveLength(1);
  });

  it("声线确认是作者的内容裁决：条目复位为 none，台账清空", async () => {
    const entryId = await seedPendingConflict();

    const response = await createCharacterVoiceRouter({ storage }).request(
      `http://localhost/api/books/book-1/jingwei/entries/${entryId}/voice`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 1,
          fields: { positioning: { value: "话少", status: "confirmed" } },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await readConflictStatus(entryId)).toBe("none");
    expect(listLedgerConflicts(storage, "book-1")).toEqual([]);
  });
});

describe("resolveLedgerConflict 自身", () => {
  it("返回清掉的记录条数，重复调用幂等", async () => {
    const entryId = await seedPendingConflict();

    expect(resolveLedgerConflict(storage, "book-1", entryId)).toBe(1);
    expect(resolveLedgerConflict(storage, "book-1", entryId)).toBe(0);
    expect(listLedgerConflicts(storage, "book-1")).toEqual([]);
    expect(await readConflictStatus(entryId)).toBe("none");
  });

  it("记录已被清理过时，条目上的 pending 标记仍会被复位", async () => {
    const entryId = await seedPendingConflict();
    storage.sqlite.prepare(`DELETE FROM "jingwei_ledger_conflict" WHERE book_id = ?`).run("book-1");
    expect(await readConflictStatus(entryId)).toBe("pending");

    expect(resolveLedgerConflict(storage, "book-1", entryId)).toBe(0);
    expect(await readConflictStatus(entryId)).toBe("none");
  });

  it("不碰别的书与别的条目", async () => {
    const entryId = await seedPendingConflict();
    const now = new Date("2026-09-01T00:00:00.000Z");
    await createBookRepository(storage).create({
      id: "book-2",
      name: "另一本书",
      jingweiMode: "dynamic",
      currentChapter: 1,
      createdAt: now,
      updatedAt: now,
    });
    recordLedgerConflict(storage, "book-2", {
      reason: "另一本书的冲突",
      info: {
        kind: "version-mismatch",
        entryId: "other-entry",
        category: "characters",
        title: "南宫婉",
        expectedVersion: 1,
        currentVersion: 2,
        changedBy: "auto-settle",
        changedFields: ["contentMd"],
      },
    });

    resolveLedgerConflict(storage, "book-1", entryId);

    const others = listLedgerConflicts(storage, "book-2");
    expect(others).toHaveLength(1);
    expect(others[0]?.entryId).toBe("other-entry");
  });
});
