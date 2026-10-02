import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { insertDissectionStaging } from "../engine/jingwei/dissection-staging.js";
import { createJingweiRouter } from "./jingwei.js";

let storage: StorageDatabase;
let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-jingwei-route-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-08-01T00:00:00.000Z");
  await createBookRepository(storage).create({
    id: "book-1",
    name: "路由测试",
    jingweiMode: "dynamic",
    currentChapter: 1,
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

function app() {
  return createJingweiRouter({ storage });
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return app().request(`http://localhost/api/books/book-1/jingwei${path}`, init);
}

async function postEntry() {
  const response = await request("/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "韩立",
      contentMd: "旧正文",
      category: "characters",
      fields: { phase: "canonical" },
      customFields: { phase: "legacy" },
      priorityTier: "relevant",
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { entry: { id: string; fields: Record<string, unknown>; category: string } }).entry;
}

describe("Jingwei canonical entry routes", () => {
  it("accepts category-only creation and gives fields precedence over legacy customFields", async () => {
    const entry = await postEntry();

    expect(entry.category).toBe("characters");
    expect(entry.fields).toEqual({ phase: "canonical" });
    const row = storage.sqlite.prepare<{ fields_json: string; custom_fields_json: string; category: string }>(`
      SELECT fields_json, custom_fields_json, category FROM story_jingwei_entry WHERE id = ?
    `).get(entry.id)!;
    expect(JSON.parse(row.fields_json)).toEqual({ phase: "canonical" });
    expect(JSON.parse(row.custom_fields_json)).toEqual({ phase: "canonical" });
    expect(row.category).toBe("characters");
  });

  it("returns final persisted data and exposes only jingwei_revision history", async () => {
    const created = await postEntry();
    const response = await request(`/entries/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentMd: "新正文",
        category: "relationships",
        fields: { phase: "changed" },
        customFields: { phase: "ignored" },
        priorityTier: "core",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { entry: { contentMd: string; category: string; fields: Record<string, unknown>; priorityTier: string; version: number } };
    expect(payload.entry).toMatchObject({
      contentMd: "新正文",
      category: "relationships",
      fields: { phase: "changed" },
      priorityTier: "core",
      version: 2,
    });

    const historyResponse = await request(`/entries/${created.id}/revisions`);
    const history = await historyResponse.json() as { revisions: Array<{ id: string; content_md: string; snapshot?: { fields?: Record<string, unknown> } }> };
    expect(history.revisions).toHaveLength(1);
    expect(history.revisions[0]).toMatchObject({ content_md: "旧正文", snapshot: { fields: { phase: "canonical" } } });

    storage.sqlite.prepare(`UPDATE story_jingwei_entry SET revision_history = ? WHERE id = ?`).run(
      JSON.stringify([{ timestamp: "legacy", source: "user", changedFields: ["title"] }]),
      created.id,
    );
    const stillCanonical = await (await request(`/entries/${created.id}/revisions`)).json() as { revisions: unknown[] };
    expect(stillCanonical.revisions).toHaveLength(1);
  });
});

describe("Jingwei dissection staging 清单（T4.2）", () => {
  it("列待审草案：类型过滤、total 全量计数、limit 截断", async () => {
    const now = new Date("2026-08-02T00:00:00.000Z");
    const seeds = [
      { kind: "character" as const, category: "characters", title: "李安平" },
      { kind: "character" as const, category: "characters", title: "陈默" },
      { kind: "location" as const, category: "locations", title: "中都" },
    ];
    for (const [index, seed] of seeds.entries()) {
      insertDissectionStaging(storage, {
        bookId: "book-1",
        kind: seed.kind,
        category: seed.category,
        proposedTitle: seed.title,
        sourceRefs: [{ chapterNumber: index + 1, excerpt: `证据 ${seed.title}` }],
        classificationReason: "拆书抽出",
        contentMd: "",
        now: () => now,
      });
    }

    const allResponse = await request("/staging");
    expect(allResponse.status).toBe(200);
    const allBody = await allResponse.json() as { ok: boolean; count: number; total: number; items: Array<{ kind: string; title: string; reason: string; sourceRefs: Array<{ chapterNumber: number }> }> };
    expect(allBody.ok).toBe(true);
    expect(allBody.count).toBe(3);
    expect(allBody.total).toBe(3);
    expect(allBody.items[0]).toMatchObject({ kind: "character", title: "李安平" });
    expect(allBody.items[0]!.sourceRefs[0]!.chapterNumber).toBe(1);

    const characterResponse = await request("/staging?kind=character");
    const characterBody = await characterResponse.json() as { total: number; items: unknown[] };
    expect(characterBody.total).toBe(2);

    const limitResponse = await request("/staging?limit=2");
    const limitBody = await limitResponse.json() as { count: number; total: number };
    expect(limitBody).toMatchObject({ count: 2, total: 3 });
  });

  it("空暂存区返回空清单（200，不是 404）", async () => {
    const response = await request("/staging");
    expect(response.status).toBe(200);
    const body = await response.json() as { items: unknown[]; total: number };
    expect(body).toMatchObject({ items: [], total: 0 });
  });
});

describe("Jingwei markdown import", () => {
  it("按 category 创建 section 并写入真实 sectionId", async () => {
    const response = await request("/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entries: [{ title: "角色设定", contentMd: "这是用于导入测试的角色设定正文。", category: "characters" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, imported: 1 });
    const row = storage.sqlite.prepare<{ section_id: string; section_key: string }>(`
      SELECT e.section_id, s.key AS section_key
      FROM story_jingwei_entry e
      JOIN story_jingwei_section s ON s.id = e.section_id
      WHERE e.book_id = ? AND e.title = ?
    `).get("book-1", "角色设定");

    expect(row?.section_id).toBeTruthy();
    expect(row?.section_id).not.toBe("");
    expect(row?.section_key).toBe("characters");
  });

  it("已有同 category section 时复用而不是重复创建", async () => {
    const existing = await postEntry();
    const before = storage.sqlite.prepare<{ section_id: string }>(`
      SELECT section_id FROM story_jingwei_entry WHERE id = ?
    `).get(existing.id)!;

    const response = await request("/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entries: [{ title: "追加角色", contentMd: "追加导入的角色设定正文。", category: "characters" }],
      }),
    });

    expect(response.status).toBe(200);
    const imported = storage.sqlite.prepare<{ section_id: string }>(`
      SELECT section_id FROM story_jingwei_entry WHERE book_id = ? AND title = ?
    `).get("book-1", "追加角色");
    const sectionCount = storage.sqlite.prepare<{ count: number }>(`
      SELECT COUNT(*) AS count FROM story_jingwei_section WHERE book_id = ? AND key = ?
    `).get("book-1", "characters");

    expect(imported?.section_id).toBe(before.section_id);
    expect(sectionCount?.count).toBe(1);
  });
});

describe("Jingwei mutation routes", () => {
  it("records revisions for move and bulk mutations instead of bypassing the repository", async () => {
    const created = await postEntry();
    const moveResponse = await request(`/entries/${created.id}/move`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: "parent-1" }),
    });
    expect(moveResponse.status).toBe(200);
    expect((await moveResponse.json() as { entry: { parentId: string } }).entry.parentId).toBe("parent-1");

    const bulkResponse = await request("/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-status", entryIds: [created.id], target: "needs-review" }),
    });
    expect(await bulkResponse.json()).toMatchObject({ ok: true, affected: 1 });

    const history = await (await request(`/entries/${created.id}/revisions`)).json() as { revisions: unknown[] };
    expect(history.revisions).toHaveLength(2);
  });

  it("对拆书暂存候选执行 promote/reject", async () => {
    const staging = insertDissectionStaging(storage, {
      bookId: "book-1",
      kind: "rules",
      category: "rules",
      proposedTitle: "平台禁止内容",
      sourceRefs: [{ chapterNumber: 1, excerpt: "不得描写邪教仪式" }],
      classificationReason: "平台硬规则候选",
      contentMd: "不得描写邪教仪式细节。",
      fields: { source: "book.dissect" },
    });

    const promoteResponse = await request(`/staging/${staging.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stagingDecision: "promote" }),
    });
    expect(promoteResponse.status).toBe(200);
    expect(await promoteResponse.json()).toMatchObject({
      ok: true,
      data: { action: "created", bookId: "book-1", category: "rules", title: "平台禁止内容" },
    });

    const promotion = storage.sqlite.prepare(`
      SELECT title, category, participates_in_ai FROM story_jingwei_entry
      WHERE book_id = ? AND title = ?
    `).get("book-1", "平台禁止内容") as { title: string; category: string; participates_in_ai: number } | undefined;
    expect(promotion?.category).toBe("rules");
    expect(promotion?.participates_in_ai).toBe(1);

    const alreadyProcessed = storage.sqlite.prepare(`SELECT status FROM dissection_staging WHERE id = ?`).get(staging.id) as { status: string } | undefined;
    expect(alreadyProcessed?.status).toBe("accepted");

    const rejectCandidate = insertDissectionStaging(storage, {
      bookId: "book-1",
      kind: "foreshadowing",
      category: "foreshadowing",
      proposedTitle: "废案伏笔",
      sourceRefs: [{ chapterNumber: 2, excerpt: "旧伤来历" }],
      classificationReason: "废弃候选",
      contentMd: "旧伤来历已作废。",
      fields: { source: "book.dissect" },
    });
    const rejectResponse = await request(`/staging/${rejectCandidate.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stagingDecision: "reject" }),
    });
    expect(rejectResponse.status).toBe(200);
    const rejected = storage.sqlite.prepare(`SELECT status FROM dissection_staging WHERE id = ?`).get(rejectCandidate.id) as { status: string } | undefined;
    expect(rejected?.status).toBe("rejected");

    const repeatResponse = await request(`/staging/${rejectCandidate.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stagingDecision: "promote" }),
    });
    expect(repeatResponse.status).toBe(409);
  });

  it("拒绝包含宿主字段的 staging 决策", async () => {
    const staging = insertDissectionStaging(storage, {
      bookId: "book-1",
      kind: "rules",
      category: "rules",
      proposedTitle: "宿主守卫",
      sourceRefs: [{ chapterNumber: 1, excerpt: "证据" }],
      classificationReason: "守卫",
      contentMd: "守卫",
      fields: {},
    });

    const response = await request(`/staging/${staging.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stagingDecision: "promote", bookId: "other-book" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("FORGED_HOST_FIELD");
  });

  it("reverts the complete snapshot and returns the restored entry", async () => {
    const created = await postEntry();
    await request(`/entries/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentMd: "新正文", category: "relationships", fields: { phase: "changed" }, priorityTier: "core" }),
    });
    const history = await (await request(`/entries/${created.id}/revisions`)).json() as { revisions: Array<{ id: string }> };

    const response = await request(`/entries/${created.id}/revert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revisionId: history.revisions[0]!.id }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { entry: Record<string, unknown> };
    expect(payload.entry).toMatchObject({
      contentMd: "旧正文",
      category: "characters",
      fields: { phase: "canonical" },
      priorityTier: "relevant",
      version: 3,
    });
  });

  it("PUT fieldsPatch 只增量合并 status，保留 name/description/章节字段（伏笔拖拽场景）", async () => {
    const created = await postEntry();
    // 模拟有完整伏笔字段的条目
    await request(`/entries/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fields: {
          name: "血仇伏笔",
          description: "墨大夫夺舍之恨",
          plantedChapter: 3,
          targetChapter: 40,
          status: "已埋设",
        },
      }),
    });

    const dragResponse = await request(`/entries/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fieldsPatch: { status: "已回收" } }),
    });
    expect(dragResponse.status).toBe(200);
    // PUT 响应即最终落库数据（条目没有单独的 GET 详情接口）
    const detail = await dragResponse.json() as {
      entry: { fields: Record<string, unknown>; customFields: Record<string, unknown> };
    };
    expect(detail.entry.fields).toEqual({
      name: "血仇伏笔",
      description: "墨大夫夺舍之恨",
      plantedChapter: 3,
      targetChapter: 40,
      status: "已回收",
    });
    expect(detail.entry.customFields).toEqual(detail.entry.fields);
  });

  it("PUT 仅传 customFields 局部对象时同样合并不替换（旧客户端形状兜底）", async () => {
    const created = await postEntry();

    const response = await request(`/entries/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customFields: { status: "已回收" } }),
    });
    expect(response.status).toBe(200);
    const detail = await response.json() as {
      entry: { fields: Record<string, unknown> };
    };
    expect(detail.entry.fields).toEqual({ phase: "canonical", status: "已回收" });
  });

  describe("P0.5 import deduplication and merge suggestions", () => {
    let bookId: string;
    beforeEach(async () => {
      bookId = "book-merge-test";
    });

    it("GET /api/books/:bookId/jingwei/merge-suggestions returns suggestions without writing to DB", async () => {
      const res = await request(`/merge-suggestions`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.groups)).toBe(true);
    });

    it("import preserves entryKey and sourceRefs", async () => {
      const res = await request(`/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: [{
            title: "Test Entry",
            contentMd: "Content",
            category: "characters",
            entryKey: "custom:test",
            sourceRefs: [{ chapterNumber: 0, excerpt: "content", path: "test.md", fileName: "test.md" }],
          }]
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean; imported: number };
      expect(data).toMatchObject({ ok: true, imported: 1 });
      const row = storage.sqlite.prepare<{ entry_key: string; source_refs_json: string }>(`
        SELECT entry_key, source_refs_json FROM story_jingwei_entry WHERE book_id = ? AND title = ?
      `).get("book-1", "Test Entry");
      expect(row?.entry_key).toBe("custom:test");
      expect(JSON.parse(row?.source_refs_json ?? "[]")).toEqual([
        { chapterNumber: 0, excerpt: "content", path: "test.md", fileName: "test.md" },
      ]);
    });
  });

});
