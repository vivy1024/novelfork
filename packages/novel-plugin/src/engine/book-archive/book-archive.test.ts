/**
 * 项目档案：导出 → 导入往返、ID 重映射、坏档案与路径穿越拒收、导入失败整体回滚。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createScene, createStoryline, listMounts, listScenes, listStorylines, mountSceneToStoryline } from "../narrative-memory/scene-store.js";
import { ensureNarrativeMemorySchema } from "../narrative-memory/storage.js";
import { rebuildNarrativeEntityIndex } from "../narrative-entity/entity-index.js";
import { computeModuleDigest, exportBookArchive } from "./export.js";
import { countBookArchiveRows, importBookArchiveIntoStorage, purgeBookArchiveData, readBookArchive } from "./import.js";
import type { BookArchiveManifest } from "./manifest.js";
import { BookArchiveError } from "./manifest.js";
import { readZip, writeZip } from "./zip.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function tempDir(label: string): Promise<string> {
  const dir = join(tmpdir(), `novelfork-archive-${label}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function createStorage(): Promise<StorageDatabase> {
  const dir = await tempDir("db");
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  ensureNarrativeMemorySchema(storage);
  storages.push(storage);
  return storage;
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const SOURCE_BOOK = "档案源书-1a2b3c4d";

interface SeededBook {
  readonly root: string;
  readonly sectionId: string;
  readonly entry1: string;
  readonly entry2: string;
  readonly relationId: string;
  readonly factId: string;
  readonly eventId: string;
  readonly causeEventId: string;
  readonly storylineId: string;
  readonly sceneId: string;
}

async function writeText(root: string, relativePath: string, content: string): Promise<void> {
  const target = join(root, ...relativePath.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function seedBook(storage: StorageDatabase, bookId = SOURCE_BOOK): Promise<SeededBook> {
  const root = await tempDir("book");
  await writeText(root, "book.json", `${JSON.stringify({ id: bookId, title: "档案源书", genre: "玄幻", chapterWordCount: 3000 }, null, 2)}\n`);
  await writeText(root, "chapters/index.json", `${JSON.stringify([
    { number: 1, title: "山门", fileName: "卷01/0001_山门.md", wordCount: 20 },
    { number: 2, title: "夜雨", fileName: "卷01/0002_夜雨.md", wordCount: 18 },
  ], null, 2)}\n`);
  await writeText(root, "chapters/卷01/0001_山门.md", "# 第1章 山门\n\n林远背着药篓走上青石台阶。\n");
  await writeText(root, "chapters/卷01/0002_夜雨.md", "# 第2章 夜雨\n\n苏晚把一枚铜钱按在林远掌心。\n");
  await writeText(root, "story/author_intent.md", "# 作者意图\n\n慢热成长。\n");
  await writeText(root, "story/style_preset.json", `${JSON.stringify({ schemaVersion: 1, principles: ["短句", "少形容词"], sources: [{ id: "src-a", name: "范文" }] }, null, 2)}\n`);
  await writeText(root, "story/workflow_recipes.json", `${JSON.stringify({ recipes: [{ id: "custom-recipe", name: "自定义流程", nodes: [{ id: "start" }] }] }, null, 2)}\n`);
  await writeText(root, "story/style-distillations/job-1.json", `${JSON.stringify({ jobId: "job-1", bookId, sourceFingerprint: "a".repeat(64) }, null, 2)}\n`);
  await writeText(root, "story/style-vault/chapter-0001.json", `${JSON.stringify({ chapter: 1, draft: "AI 原稿：林远背着药篓。" })}
`);
  await writeText(root, "story/style-distillations/job-1.source.json", `${JSON.stringify({ jobId: "job-1", chapters: [{ number: 1, content: "参考正文" }] })}\n`);
  await writeText(root, ".novelfork/skills/zhangmo/SKILL.md", "---\nname: 章末钩子\n---\n\n每章结尾留一个悬念。\n");
  await writeText(root, ".git/HEAD", "ref: refs/heads/main\n");
  await writeText(root, ".env", "SECRET=1\n");
  await writeText(root, "story/memory.db", "derived");

  const now = Date.now();
  storage.sqlite.prepare(`INSERT INTO book (id, name, jingwei_mode, current_chapter, created_at, updated_at, state_revision) VALUES (?, ?, 'dynamic', 2, ?, ?, 3)`).run(bookId, "档案源书", now, now);
  const sectionId = randomUUID();
  storage.sqlite.prepare(`INSERT INTO story_jingwei_section (id, book_id, key, name, description, "order", enabled, show_in_sidebar, participates_in_ai, default_visibility, fields_json, builtin_kind, source_template, created_at, updated_at)
    VALUES (?, ?, 'characters', '角色', '', 0, 1, 1, 1, 'tracked', '[]', 'characters', 'manual', ?, ?)`).run(sectionId, bookId, now, now);
  const entry1 = randomUUID();
  const entry2 = randomUUID();
  const insertEntry = storage.sqlite.prepare(`INSERT INTO story_jingwei_entry (id, book_id, section_id, title, content_md, tags_json, aliases_json, custom_fields_json, related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai, created_at, updated_at, category, fields_json, layer, status)
    VALUES (?, ?, ?, ?, ?, '[]', '[]', '{}', '[1,2]', ?, '{"type":"tracked"}', 1, ?, ?, 'characters', ?, 'dynamic', 'confirmed')`);
  insertEntry.run(entry1, bookId, sectionId, "林远", "药童出身，性子沉。", JSON.stringify([entry2]), now, now, JSON.stringify({ rival: entry2, note: "不要改我 main" }));
  insertEntry.run(entry2, bookId, sectionId, "苏晚", "经楼守灯人。", "[]", now, now, "{}");
  const relationId = randomUUID();
  storage.sqlite.prepare(`INSERT INTO jingwei_relations (id, book_id, source_entry_id, target_entry_id, relation_type, label, metadata_json, created_at) VALUES (?, ?, ?, ?, 'ally', '铜钱之约', '{}', ?)`).run(relationId, bookId, entry1, entry2, now);
  storage.sqlite.prepare(`INSERT INTO jingwei_revision (id, entry_id, book_id, content_md, category, layer, reason, changed_by, created_at, snapshot_json) VALUES (?, ?, ?, '旧设定', 'characters', 'dynamic', 'edit', 'author', ?, ?)`)
    .run(randomUUID(), entry1, bookId, now, JSON.stringify({ id: entry1, bookId, title: "林远" }));

  const factId = `manual-fact:${bookId}:${randomUUID()}`;
  storage.sqlite.prepare(`INSERT INTO narrative_fact (id, book_id, subject, predicate, object, category, layer, confidence, source_type, source_chapter, evidence_text, valid_from_chapter, subject_entry_id, created_at, updated_at)
    VALUES (?, ?, '林远', '持有', '铜钱', 'item', 'dynamic', 1, 'manual', 2, '把一枚铜钱按在林远掌心', 2, ?, ?, ?)`).run(factId, bookId, entry1, new Date(now).toISOString(), new Date(now).toISOString());
  const causeEventId = `${bookId}:1:location_changed:${encodeURIComponent("林远")}-aaaa:${encodeURIComponent("到达")}-bbbb:${encodeURIComponent("山门")}-cccc`;
  const eventId = `${bookId}:2:relationship_changed:${encodeURIComponent("苏晚")}-d65c:${encodeURIComponent("约见")}-fd77:${encodeURIComponent("林远")}-ce25`;
  const insertEvent = storage.sqlite.prepare(`INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text, confidence, source, status, risk_level, subject_entry_id, object_entry_id, caused_by_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.9, 'manual', 'applied', 'low', ?, ?, ?, ?)`);
  insertEvent.run(causeEventId, bookId, 1, "location_changed", "林远", "到达", "山门", "林远走上青石台阶", entry1, null, null, new Date(now).toISOString());
  insertEvent.run(eventId, bookId, 2, "relationship_changed", "苏晚", "约见", "林远", "明日辰时，后山见。", entry2, entry1, JSON.stringify([{ eventId: causeEventId, relation: "enables" }]), new Date(now).toISOString());

  const storyline = createStoryline(storage, { bookId, name: "铜钱之约", kind: "main", goal: "查清铜钱来历", entryId: entry1, layer: "canon", status: "confirmed", source: "manual" });
  if (!storyline.ok) throw new Error(storyline.summary);
  const scene = createScene(storage, { bookId, chapterNumber: 2, title: "经楼夜访", summary: "苏晚送来铜钱", layer: "canon", status: "confirmed", source: "manual" });
  if (!scene.ok) throw new Error(scene.summary);
  mountSceneToStoryline(storage, scene.data.id, storyline.data.id, "primary");

  storage.sqlite.prepare(`INSERT INTO writing_log (book_id, chapter_number, word_count, completed_at, date) VALUES (?, 1, 20, ?, '2026-09-29')`).run(bookId, new Date(now).toISOString());
  storage.sqlite.prepare(`INSERT INTO writing_log (book_id, chapter_number, word_count, completed_at, date) VALUES (?, 2, 18, ?, '2026-09-29')`).run(bookId, new Date(now).toISOString());

  // 源书也有派生的实体索引：导出时应列为「未包含」而不是带走。
  rebuildNarrativeEntityIndex(storage, bookId);

  return { root, sectionId, entry1, entry2, relationId, factId, eventId, causeEventId, storylineId: storyline.data.id, sceneId: scene.data.id };
}

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function exportSeeded(storage: StorageDatabase, seeded: SeededBook, modules?: Parameters<typeof exportBookArchive>[0]["modules"]) {
  return exportBookArchive({ storage, bookRoot: seeded.root, bookId: SOURCE_BOOK, novelforkVersion: "0.0.4-test", ...(modules ? { modules } : {}) });
}

async function importInto(storage: StorageDatabase, bytes: Uint8Array, newBookId: string, modules?: Parameters<typeof importBookArchiveIntoStorage>[0]["modules"]) {
  const stagingRoot = join(await tempDir("staging"), "book");
  const archive = readBookArchive(bytes);
  const report = await importBookArchiveIntoStorage({ storage, archive, newBookId, stagingRoot, ...(modules ? { modules } : {}) });
  return { report, stagingRoot };
}

/** 解开档案、改动后重新打包；可选同步清单里的哈希，用来构造「结构合法但内容可疑」的档案。 */
function repack(bytes: Uint8Array, mutate: (entries: Map<string, Uint8Array>, manifest: BookArchiveManifest) => void): Uint8Array {
  const entries = readZip(bytes);
  const manifest = JSON.parse(Buffer.from(entries.get("manifest.json")!).toString("utf8")) as BookArchiveManifest;
  mutate(entries, manifest);
  entries.set("manifest.json", Buffer.from(JSON.stringify(manifest), "utf8"));
  return writeZip([...entries].map(([path, data]) => ({ path, data })));
}

function expectArchiveError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BookArchiveError);
    expect((error as BookArchiveError).code).toBe(code);
    expect((error as BookArchiveError).explanation.length).toBeGreaterThan(10);
    return;
  }
  throw new Error(`expected BookArchiveError ${code}`);
}

describe("项目档案导出", () => {
  it("清单记录格式版本、源书、模块条目数与哈希，并如实列出未包含项", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const { bytes, manifest, fileName } = await exportSeeded(storage, seeded);
    expect(fileName).toMatch(/^档案源书-档案-\d{4}-\d{2}-\d{2}\.zip$/u);
    expect(manifest.format).toBe("novelfork-book-archive");
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.novelforkVersion).toBe("0.0.4-test");
    expect(manifest.source.bookId).toBe(SOURCE_BOOK);
    expect(manifest.source.schemaMigrations.length).toBeGreaterThan(30);
    const byId = new Map(manifest.modules.map((module) => [module.id, module]));
    expect(byId.get("chapters")!.files.map((file) => file.path)).toEqual(expect.arrayContaining(["chapters/index.json", "chapters/卷01/0001_山门.md", "story/author_intent.md"]));
    expect(byId.get("workflow")!.files.map((file) => file.path)).toEqual(["story/workflow_recipes.json"]);
    expect(byId.get("style")!.files.map((file) => file.path)).toEqual(expect.arrayContaining(["story/style_preset.json", "story/style-distillations/job-1.json", "story/style-vault/chapter-0001.json"]));
    // 实体索引是派生数据，不进档案。
    const allTables = manifest.modules.flatMap((module) => module.tables.map((table) => table.name));
    expect(allTables.some((name) => name.startsWith("narrative_entity") || name === "narrative_relation" || name === "narrative_state_change" || name === "narrative_event_participant")).toBe(false);
    expect(byId.get("references")!.files.map((file) => file.path)).toEqual(["story/style-distillations/job-1.source.json"]);
    expect(byId.get("skills")!.files.map((file) => file.path)).toEqual([".novelfork/skills/zhangmo/SKILL.md"]);
    expect(byId.get("jingwei")!.tables.find((table) => table.name === "story_jingwei_entry")?.rows).toBe(2);
    expect(byId.get("narrative")!.tables.find((table) => table.name === "narrative_scene_storyline")?.rows).toBe(1);
    for (const module of manifest.modules) expect(module.sha256).toBe(computeModuleDigest(module));

    const notIncluded = manifest.notIncluded.map((item) => item.name);
    expect(notIncluded).toEqual(expect.arrayContaining([".git/", ".env", "story/memory.db", "叙述者会话与消息", "narrative_entity"]));
    for (const item of manifest.notIncluded) expect(item.explanation.length).toBeGreaterThan(5);
    // 被排除的文件确实没进档案。
    const entries = readZip(bytes);
    expect([...entries.keys()].some((path) => path.includes(".git/") || path.endsWith(".env") || path.endsWith("memory.db"))).toBe(false);
    expect(Buffer.from(entries.get("files/chapters/卷01/0001_山门.md")!).toString("utf8")).toContain("青石台阶");
  });

  it("只导出部分模块时，指出对未导出模块的引用", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const { manifest } = await exportSeeded(storage, seeded, ["narrative"]);
    expect(manifest.modules.filter((module) => module.included).map((module) => module.id)).toEqual(["narrative"]);
    const dangling = manifest.warnings.filter((warning) => warning.code === "dangling-reference");
    expect(dangling.map((warning) => `${warning.table}.${warning.column}`)).toEqual(expect.arrayContaining(["narrative_fact.subject_entry_id", "narrative_storyline.entry_id"]));
    expect(dangling.every((warning) => warning.explanation.includes("经纬"))).toBe(true);
    expect(manifest.notIncluded.some((item) => item.kind === "module" && item.name === "正文")).toBe(true);
  });
});

describe("项目档案导入往返", () => {
  it("在源书仍在的同一个库里导入为新书：正文、经纬、叙事记忆、场景挂载、文风、工作流逐项一致，ID 全部重映射", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const before = countBookArchiveRows(storage, SOURCE_BOOK);
    const { bytes } = await exportSeeded(storage, seeded);
    const newBookId = "档案新书-9f8e7d6c";
    const { report, stagingRoot } = await importInto(storage, bytes, newBookId);

    expect(report.bookId).toBe(newBookId);
    expect(report.idRemap.bookId).toEqual({ from: SOURCE_BOOK, to: newBookId });
    expect(report.modules.every((module) => module.status === "imported")).toBe(true);
    // 源书一行不少。
    expect(countBookArchiveRows(storage, SOURCE_BOOK)).toEqual(before);
    // 新书各表行数与源书一致。
    expect(countBookArchiveRows(storage, newBookId)).toEqual(before);

    // 文件：正文与文风、工作流、技能逐字节一致；book.json 换成新 id；含 bookId 的蒸馏任务改写。
    for (const path of ["chapters/卷01/0001_山门.md", "chapters/卷01/0002_夜雨.md", "chapters/index.json", "story/style_preset.json", "story/workflow_recipes.json", ".novelfork/skills/zhangmo/SKILL.md", "story/style-distillations/job-1.source.json", "story/style-vault/chapter-0001.json"]) {
      const original = await readFile(join(seeded.root, ...path.split("/")));
      const imported = await readFile(join(stagingRoot, ...path.split("/")));
      expect(sha256(imported), path).toBe(sha256(original));
    }
    const bookJson = JSON.parse(await readFile(join(stagingRoot, "book.json"), "utf8")) as Record<string, unknown>;
    expect(bookJson).toMatchObject({ id: newBookId, title: "档案源书", genre: "玄幻", chapterWordCount: 3000 });
    const job = JSON.parse(await readFile(join(stagingRoot, "story/style-distillations/job-1.json"), "utf8")) as Record<string, unknown>;
    expect(job.bookId).toBe(newBookId);
    for (const excluded of [".git", ".env", "story/memory.db"]) {
      expect(await stat(join(stagingRoot, excluded)).catch(() => null), excluded).toBeNull();
    }

    // 经纬：条目、分类、关系、修订的外键全部指向新 ID。
    const sections = storage.sqlite.prepare<{ id: string }>(`SELECT id FROM story_jingwei_section WHERE book_id = ?`).all(newBookId);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).not.toBe(seeded.sectionId);
    const entries = storage.sqlite.prepare<{ id: string; title: string; section_id: string; related_entry_ids_json: string; fields_json: string; content_md: string }>(
      `SELECT id, title, section_id, related_entry_ids_json, fields_json, content_md FROM story_jingwei_entry WHERE book_id = ? ORDER BY title`,
    ).all(newBookId);
    const newEntry1 = entries.find((entry) => entry.title === "林远")!;
    const newEntry2 = entries.find((entry) => entry.title === "苏晚")!;
    expect(newEntry1.id).not.toBe(seeded.entry1);
    expect(newEntry1.content_md).toBe("药童出身，性子沉。");
    expect(newEntry1.section_id).toBe(sections[0]!.id);
    expect(JSON.parse(newEntry1.related_entry_ids_json)).toEqual([newEntry2.id]);
    expect(JSON.parse(newEntry1.fields_json)).toEqual({ rival: newEntry2.id, note: "不要改我 main" });
    const relation = storage.sqlite.prepare<{ id: string; source_entry_id: string; target_entry_id: string; label: string }>(`SELECT id, source_entry_id, target_entry_id, label FROM jingwei_relations WHERE book_id = ?`).get(newBookId)!;
    expect(relation).toMatchObject({ source_entry_id: newEntry1.id, target_entry_id: newEntry2.id, label: "铜钱之约" });
    expect(relation.id).not.toBe(seeded.relationId);
    const revision = storage.sqlite.prepare<{ entry_id: string; snapshot_json: string }>(`SELECT entry_id, snapshot_json FROM jingwei_revision WHERE book_id = ?`).get(newBookId)!;
    expect(revision.entry_id).toBe(newEntry1.id);
    expect(JSON.parse(revision.snapshot_json)).toEqual({ id: newEntry1.id, bookId: newBookId, title: "林远" });
    // 检索索引按新书重建。
    expect(storage.sqlite.prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM jingwei_fts_doc WHERE book_id = ?`).get(newBookId)!.count).toBe(2);

    // 叙事记忆：事实与事件 ID 里的 bookId 与 UUID 换新，实体引用与因果链指向新 ID。
    const fact = storage.sqlite.prepare<{ id: string; subject_entry_id: string; evidence_text: string }>(`SELECT id, subject_entry_id, evidence_text FROM narrative_fact WHERE book_id = ?`).get(newBookId)!;
    expect(fact.id.startsWith(`manual-fact:${newBookId}:`)).toBe(true);
    expect(fact.id).not.toBe(seeded.factId.replace(SOURCE_BOOK, newBookId));
    expect(fact.subject_entry_id).toBe(newEntry1.id);
    expect(fact.evidence_text).toBe("把一枚铜钱按在林远掌心");
    const events = storage.sqlite.prepare<{ id: string; chapter_number: number; subject_entry_id: string | null; object_entry_id: string | null; caused_by_json: string | null }>(
      `SELECT id, chapter_number, subject_entry_id, object_entry_id, caused_by_json FROM narrative_event WHERE book_id = ? ORDER BY chapter_number`,
    ).all(newBookId);
    expect(events.map((event) => event.id)).toEqual([seeded.causeEventId, seeded.eventId].map((id) => id.replace(SOURCE_BOOK, newBookId)));
    expect(events[1]).toMatchObject({ subject_entry_id: newEntry2.id, object_entry_id: newEntry1.id });
    expect(JSON.parse(events[1]!.caused_by_json!)).toEqual([{ eventId: events[0]!.id, relation: "enables" }]);

    // 场景、剧情线与挂载。
    const scenes = listScenes(storage, newBookId);
    const storylines = listStorylines(storage, newBookId);
    const mounts = listMounts(storage, newBookId);
    expect(scenes).toHaveLength(1);
    expect(storylines).toHaveLength(1);
    expect(scenes[0]!.id.startsWith(`scene:${newBookId}:`)).toBe(true);
    expect(scenes[0]!.id).not.toBe(seeded.sceneId);
    expect(scenes[0]).toMatchObject({ title: "经楼夜访", summary: "苏晚送来铜钱", chapterNumber: 2 });
    expect(storylines[0]).toMatchObject({ name: "铜钱之约", goal: "查清铜钱来历", entryId: newEntry1.id });
    expect(mounts).toEqual([expect.objectContaining({ sceneId: scenes[0]!.id, storylineId: storylines[0]!.id, role: "primary" })]);
    // 源书的挂载仍然只指向源书。
    expect(listMounts(storage, SOURCE_BOOK)).toEqual([expect.objectContaining({ sceneId: seeded.sceneId, storylineId: seeded.storylineId })]);

    // 书籍行：章节进度与状态修订号随正文迁移。
    expect(storage.sqlite.prepare(`SELECT name, current_chapter, state_revision FROM book WHERE id = ?`).get(newBookId)).toEqual({ name: "档案源书", current_chapter: 2, state_revision: 3 });
    // 实体索引按新书重建：实体 ID 带新书 ID 与新经纬条目 ID。
    const entityIds = storage.sqlite.prepare<{ id: string; entry_id: string | null }>(`SELECT id, entry_id FROM narrative_entity WHERE book_id = ?`).all(newBookId);
    expect(entityIds.length).toBeGreaterThan(0);
    expect(entityIds.every((entity) => entity.id.includes(newBookId))).toBe(true);
    expect(entityIds.some((entity) => entity.entry_id === newEntry1.id)).toBe(true);
    expect(report.items.some((item) => item.target === "实体索引" && item.explanation.startsWith("实体索引已按新书重建"))).toBe(true);
    // 报告如实列出未包含项与技能提醒。
    expect(report.items.some((item) => item.severity === "missing" && item.target.startsWith("叙述者会话"))).toBe(true);
    expect(report.items.some((item) => item.severity === "warning" && item.module === "skills")).toBe(true);
    expect(report.items.every((item) => item.explanation.length > 5)).toBe(true);
  });

  it("导入到另一台机器（空库）同样完整，同一档案导入两次得到两本互不相干的书", async () => {
    const source = await createStorage();
    const seeded = await seedBook(source);
    const before = countBookArchiveRows(source, SOURCE_BOOK);
    const { bytes } = await exportSeeded(source, seeded);
    const target = await createStorage();
    await importInto(target, bytes, "另一台机器-11111111");
    await importInto(target, bytes, "另一台机器-22222222");
    expect(countBookArchiveRows(target, "另一台机器-11111111")).toEqual(before);
    expect(countBookArchiveRows(target, "另一台机器-22222222")).toEqual(before);
    const ids = target.sqlite.prepare<{ id: string }>(`SELECT id FROM story_jingwei_entry`).all().map((row) => row.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("只导入选中的模块，其余模块在报告里说明", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const { bytes } = await exportSeeded(storage, seeded);
    const newBookId = "只要正文-33333333";
    const { report, stagingRoot } = await importInto(storage, bytes, newBookId, ["chapters"]);
    const counts = countBookArchiveRows(storage, newBookId);
    expect(Object.keys(counts)).toEqual(["writing_log"]);
    expect(await stat(join(stagingRoot, "story/style_preset.json")).catch(() => null)).toBeNull();
    expect(await readFile(join(stagingRoot, "chapters/卷01/0001_山门.md"), "utf8")).toContain("青石台阶");
    const notSelected = report.modules.filter((module) => module.status === "not-selected").map((module) => module.id);
    expect(notSelected).toEqual(["jingwei", "narrative", "workflow", "style", "skills", "references"]);
    expect(report.items.filter((item) => item.severity === "info" && item.module && item.target !== "实体索引")).toHaveLength(6);
  });

  it("档案缺少的模块在报告里逐条列出，并补齐空章节索引", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const { bytes } = await exportSeeded(storage, seeded, ["jingwei"]);
    const { report, stagingRoot } = await importInto(storage, bytes, "只有经纬-44444444");
    const missing = report.items.filter((item) => item.severity === "missing" && item.module);
    expect(missing.map((item) => item.module)).toEqual(["chapters", "narrative", "workflow", "style", "skills", "references"]);
    expect(await readFile(join(stagingRoot, "chapters/index.json"), "utf8")).toBe("[]\n");
    expect(storage.sqlite.prepare(`SELECT current_chapter, state_revision FROM book WHERE id = ?`).get("只有经纬-44444444")).toEqual({ current_chapter: 0, state_revision: 0 });
  });
});

describe("坏档案一律拒收", () => {
  it("不是 zip", () => {
    expectArchiveError(() => readBookArchive(Buffer.from("definitely not a zip archive at all")), "zip-not-zip");
  });

  it("内容与清单哈希不符", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const { bytes } = await exportSeeded(storage, seeded);
    const tampered = repack(bytes, (entries) => {
      entries.set("files/chapters/卷01/0001_山门.md", Buffer.from("被篡改的正文", "utf8"));
    });
    expectArchiveError(() => readBookArchive(tampered), "hash-mismatch");
  });

  it("清单之外夹带的条目", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const { bytes } = await exportSeeded(storage, seeded);
    const tampered = repack(bytes, (entries) => {
      entries.set("files/chapters/偷带.md", Buffer.from("x", "utf8"));
    });
    expectArchiveError(() => readBookArchive(tampered), "unexpected-entry");
  });

  it("格式版本比当前更新", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const { bytes } = await exportSeeded(storage, seeded);
    const tampered = repack(bytes, (_entries, manifest) => {
      (manifest as { formatVersion: number }).formatVersion = 2;
    });
    expectArchiveError(() => readBookArchive(tampered), "format-too-new");
  });

  it("往作品目录放版本库钩子等不允许的路径（哈希齐全也拒收）", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const { bytes } = await exportSeeded(storage, seeded);
    const tampered = repack(bytes, (entries, manifest) => {
      const data = Buffer.from("#!/bin/sh\necho pwned\n", "utf8");
      entries.set("files/.git/hooks/post-checkout", data);
      const chapters = manifest.modules.find((module) => module.id === "chapters")!;
      chapters.files.push({ path: ".git/hooks/post-checkout", bytes: data.length, sha256: sha256(data) });
      chapters.sha256 = computeModuleDigest(chapters);
    });
    expectArchiveError(() => readBookArchive(tampered), "forbidden-path");
  });

  it("路径穿越（..）", async () => {
    const zip = Buffer.from(writeZip([
      { path: "manifest.json", data: Buffer.from("{}") },
      { path: "files/aa/evil.md", data: Buffer.from("x") },
    ]));
    // 同长度替换条目名，绕过写入端的校验，模拟恶意档案。
    const patched = Buffer.from(zip.toString("latin1").replaceAll("files/aa/evil.md", "files/../evil.md"), "latin1");
    expectArchiveError(() => readBookArchive(patched), "zip-unsafe-path");
  });

  it("绝对路径", async () => {
    const zip = Buffer.from(writeZip([{ path: "xC/evil.md", data: Buffer.from("x") }]));
    const patched = Buffer.from(zip.toString("latin1").replaceAll("xC/evil.md", "/C/evil.md"), "latin1");
    expectArchiveError(() => readBookArchive(patched), "zip-unsafe-path");
  });

  it("符号链接条目", () => {
    const zip = Buffer.from(writeZip([{ path: "files/link.md", data: Buffer.from("/etc/passwd") }]));
    const centralOffset = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt32LE(((0o120000 | 0o777) << 16) >>> 0, centralOffset + 38);
    expectArchiveError(() => readBookArchive(zip), "zip-symlink");
  });
});

describe("导入失败整体回滚", () => {
  it("写库中途失败：数据库不留新书任何一行，暂存目录被删除", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const { bytes } = await exportSeeded(storage, seeded);
    // 挂载表多一行指向不存在场景的记录：外键检查在提交时失败。
    const tampered = repack(bytes, (entries, manifest) => {
      const path = "tables/narrative_scene_storyline.jsonl";
      const text = `${Buffer.from(entries.get(path)!).toString("utf8")}${JSON.stringify({ scene_id: "scene:nowhere:00000000-0000-4000-8000-000000000000", storyline_id: seeded.storylineId, role: "support", created_at: 1 })}\n`;
      const data = Buffer.from(text, "utf8");
      entries.set(path, data);
      const narrative = manifest.modules.find((module) => module.id === "narrative")!;
      const table = narrative.tables.find((candidate) => candidate.name === "narrative_scene_storyline")!;
      table.rows += 1;
      table.sha256 = sha256(data);
      narrative.sha256 = computeModuleDigest(narrative);
    });
    const archive = readBookArchive(tampered);
    const stagingRoot = join(await tempDir("staging"), "book");
    const newBookId = "回滚新书-55555555";
    await expect(importBookArchiveIntoStorage({ storage, archive, newBookId, stagingRoot })).rejects.toMatchObject({ code: "import-failed" });
    expect(countBookArchiveRows(storage, newBookId)).toEqual({});
    expect(storage.sqlite.prepare(`SELECT id FROM book WHERE id = ?`).get(newBookId)).toBeFalsy();
    expect(await stat(stagingRoot).catch(() => null)).toBeNull();
    // 事务确实结束了：后续写入正常。
    storage.sqlite.prepare(`INSERT INTO writing_log (book_id, chapter_number, word_count, completed_at, date) VALUES (?, 3, 1, 'x', 'x')`).run(SOURCE_BOOK);
  });

  it("补偿清理删掉导入的全部数据，源书不受影响", async () => {
    const storage = await createStorage();
    const seeded = await seedBook(storage);
    const before = countBookArchiveRows(storage, SOURCE_BOOK);
    const { bytes } = await exportSeeded(storage, seeded);
    const newBookId = "待清理-66666666";
    await importInto(storage, bytes, newBookId);
    purgeBookArchiveData(storage, newBookId);
    expect(countBookArchiveRows(storage, newBookId)).toEqual({});
    expect(storage.sqlite.prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM jingwei_fts_doc WHERE book_id = ?`).get(newBookId)!.count).toBe(0);
    expect(storage.sqlite.prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM narrative_entity WHERE book_id = ?`).get(newBookId)!.count).toBe(0);
    expect(countBookArchiveRows(storage, SOURCE_BOOK)).toEqual(before);
  });
});
