/**
 * 关系图谱路由行为：从经纬条目 + 关系事实经实体索引重建后，按实体 id 查询。
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { rebuildNarrativeEntityIndex } from "../engine/narrative-entity/entity-index.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { createEntityGraphRouter } from "./entity-graph.js";

let storage: StorageDatabase;
let tempDir: string;
const now = new Date("2026-09-01T00:00:00.000Z");
const iso = now.toISOString();
const base = "/api/books/book-1/narrative-memory/entity-graph";

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-entity-graph-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  ensureNarrativeMemorySchema(storage);
  await createBookRepository(storage).create({ id: "book-1", name: "关系图谱", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-characters", bookId: "book-1", key: "characters", name: "角色", description: "", icon: null, order: 0, enabled: true,
    showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: "characters",
    sourceTemplate: null, createdAt: now, updatedAt: now,
  });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function character(title: string, aliases: string[] = []): Promise<string> {
  const created = await createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: "book-1", sectionId: "sec-characters", title, contentMd: "", category: "characters",
    fields: {}, customFields: {}, tags: [], aliases, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: "dynamic",
    status: "confirmed", createdAt: now, updatedAt: now,
  });
  return created.id;
}

function relationFact(id: string, chapter: number, subject: string, predicate: string, object: string, validUntil: number | null = null) {
  storage.sqlite.prepare(`
    INSERT INTO narrative_fact (id, book_id, subject, predicate, object, category, layer, confidence, source_type,
      source_chapter, evidence_text, valid_from_chapter, valid_until_chapter, created_at, updated_at)
    VALUES (?, 'book-1', ?, ?, ?, 'relationship', 'dynamic', 0.8, 'event', ?, ?, ?, ?, ?, ?)
  `).run(id, subject, predicate, object, chapter, `原文-${id}`, chapter, validUntil, iso, iso);
}

function event(id: string, chapter: number, subject: string, object: string) {
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
      confidence, source, status, risk_level, subject_entry_id, object_entry_id, created_at)
    VALUES (?, 'book-1', ?, 'relationship_changed', ?, '同行', ?, '证据', 0.9, 'settle', 'applied', 'low', NULL, NULL, ?)
  `).run(id, chapter, subject, object, iso);
}

async function get(path: string) {
  const res = await createEntityGraphRouter({ storage }).request(`${base}${path}`);
  return { status: res.status, body: await res.json() as any };
}

describe("关系图谱路由", () => {
  it("实体索引为空时给带 explanation 的空状态", async () => {
    const network = await get("/network");
    expect(network.status).toBe(200);
    expect(network.body).toMatchObject({ ok: true, status: "empty", reason: "index-empty" });
    expect(network.body.explanation.suggestedAction).toContain("重建索引");

    await character("薛行之");
    rebuildNarrativeEntityIndex(storage, "book-1");
    const noEdges = await get("/network");
    expect(noEdges.body).toMatchObject({ status: "empty", reason: "no-relations" });
    expect(noEdges.body.explanation.whatHappened).toContain("1 个实体");
  });

  it("按实体 id 出焦点网络、关系史与趋势；别名归到同一实体", async () => {
    const xue = await character("薛行之（主角）", ["薛小爷"]);
    const fang = await character("方工");
    const shen = await character("沈遥");
    relationFact("f1", 12, "薛行之与方工", "事故复核协作关系", "建立七天复核协作");
    relationFact("f2", 15, "方工与薛小爷", "作保与连带同盟关系", "两人进入攻守同盟");
    relationFact("f3", 13, "薛行之与沈遥", "安全判断共识", "沈遥认可判断", 20);
    event("e1", 12, "薛行之与方工", "灵科院");
    event("e2", 15, "方工", "薛小爷");
    const rebuilt = rebuildNarrativeEntityIndex(storage, "book-1");
    expect(rebuilt.ok).toBe(true);
    const xueId = `ent:book-1:${xue}`;
    const fangId = `ent:book-1:${fang}`;
    const shenId = `ent:book-1:${shen}`;

    const entities = await get("/entities?chapter=15");
    expect(entities.body.status).toBe("ok");
    // 第 15 章时薛行之与方工、沈遥都有关系，度数最高
    expect(entities.body.defaultFocusId).toBe(xueId);
    expect(entities.body.stats).toMatchObject({ entities: 3, relations: 3, latestChapter: 20 });

    const network = await get(`/network?focus=${encodeURIComponent(xueId)}&hops=1&chapter=15`);
    expect(network.body.status).toBe("ok");
    expect(network.body.network.nodes.map((node: any) => node.name)).toEqual(["薛行之", "方工", "沈遥"]);
    const edge = network.body.network.edges.find((item: any) => item.target === fangId);
    expect(edge).toMatchObject({ source: xueId, relationCount: 2, sharedEvents: 2, trend: "warming" });

    // 第 12 章时只有与方工的协作
    const at12 = await get(`/network?focus=${encodeURIComponent(xueId)}&chapter=12`);
    expect(at12.body.network.nodes.map((node: any) => node.id)).toEqual([xueId, fangId]);

    // 至今沈遥的关系已在第 20 章结束：焦点换成沈遥时孤立，给出说明
    const lonely = await get(`/network?focus=${encodeURIComponent(shenId)}`);
    expect(lonely.body.network.edges).toEqual([]);
    expect(lonely.body.notice.whatHappened).toContain("沈遥");

    const pair = await get(`/pair?a=${encodeURIComponent(xueId)}&b=${encodeURIComponent(fangId)}`);
    expect(pair.body.history.map((item: any) => [item.predicate, item.validFrom, item.evidence])).toEqual([
      ["事故复核协作关系", 12, "原文-f1"],
      ["作保与连带同盟关系", 15, "原文-f2"],
    ]);
    expect(pair.body.trend).toMatchObject({ kind: "warming", label: "升温" });

    const common = await get(`/pair?a=${encodeURIComponent(fangId)}&b=${encodeURIComponent(shenId)}&chapter=15`);
    expect(common.body.common.map((item: any) => item.entity.id)).toEqual([xueId]);

    const path = await get(`/path?from=${encodeURIComponent(fangId)}&to=${encodeURIComponent(shenId)}&chapter=15`);
    expect(path.body.steps.map((step: any) => step.to)).toEqual([xueId, shenId]);
  });

  it("实体抽屉按经纬条目 id 取关系；找不到时说明原因", async () => {
    const xue = await character("薛行之");
    const fang = await character("方工");
    relationFact("f1", 12, "薛行之与方工", "协作", "一起复核");
    rebuildNarrativeEntityIndex(storage, "book-1");

    const byEntry = await get(`/relations?entryId=${encodeURIComponent(fang)}`);
    expect(byEntry.body.status).toBe("ok");
    expect(byEntry.body.entity.name).toBe("方工");
    expect(byEntry.body.counterparts[0]).toMatchObject({ entity: { entryId: xue, name: "薛行之" } });
    expect(byEntry.body.counterparts[0].current[0].predicate).toBe("协作");

    const missing = await get("/relations?entryId=not-an-entry");
    expect(missing.body).toMatchObject({ status: "empty", reason: "entity-not-found" });
    expect(missing.body.explanation.suggestedAction).toContain("重建索引");
  });

  it("参数校验：hops、chapter、缺少实体", async () => {
    expect((await get("/network?hops=3")).status).toBe(400);
    expect((await get("/network?chapter=abc")).status).toBe(400);
    expect((await get("/relations")).status).toBe(400);
    expect((await get("/pair?a=x&b=x")).status).toBe(400);
  });
});
