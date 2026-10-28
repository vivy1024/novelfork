/**
 * 长篇规模基准：500 章、几百个实体的测试书上，单章结算与实体索引维护的耗时。
 *
 * 默认跳过（耗时数秒，不进日常测试）；需要时：
 *   NOVELFORK_BENCH=1 pnpm --filter @vivy1024/novelfork-novel-plugin exec vitest run src/engine/narrative-entity/entity-index.bench.test.ts
 * 数据全部写在临时目录，跑完删除。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { settleConfirmedChapter } from "../../handlers/chapter-settlement-service.js";
import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { ensureNarrativeMemorySchema } from "../narrative-memory/storage.js";
import { planNarrativeEntityIndex, rebuildNarrativeEntityIndex, refreshNarrativeEntityIndex } from "./entity-index.js";

const BOOK = "bench-book";
const CHAPTERS = 500;
const CHARACTERS = 300;
const LOCATIONS = 120;
const PROPS = 80;
const FORESHADOWS = 40;
const EVENTS_PER_CHAPTER = 8;

let storage: StorageDatabase;
let tempDir: string;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function time<T>(fn: () => T | Promise<T>, runs: number): Promise<{ median: number; samples: number[] }> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  return { median: median(samples), samples };
}

/** 确定性伪随机，保证每次基准的数据一致。 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export async function seedLongBook(db: StorageDatabase, bookId: string, chapters: number): Promise<{ characterNames: string[]; locationNames: string[] }> {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const iso = now.toISOString();
  await createBookRepository(db).create({ id: bookId, name: "长篇基准", jingweiMode: "dynamic", currentChapter: chapters, createdAt: now, updatedAt: now });
  let order = 0;
  for (const key of ["characters", "locations", "props", "foreshadowing"]) {
    await createStoryJingweiSectionRepository(db).create({
      id: `${bookId}-sec-${key}`, bookId, key, name: key, description: "", icon: null, order: order++, enabled: true,
      showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: key,
      sourceTemplate: null, createdAt: now, updatedAt: now,
    });
  }
  const insertEntry = db.sqlite.prepare(`
    INSERT INTO story_jingwei_entry (id, book_id, section_id, title, content_md, category, fields_json, aliases_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)
  `);
  const characterNames: string[] = [];
  const locationNames: string[] = [];
  const random = rng(42);
  db.sqlite.transaction(() => {
    for (let i = 0; i < CHARACTERS; i += 1) {
      const name = `角色${i}号`;
      characterNames.push(name);
      const title = i % 7 === 0 ? `${name}（主线人物）` : name;
      insertEntry.run(`${bookId}-c${i}`, bookId, `${bookId}-sec-characters`, title, "characters", JSON.stringify({ aliases: [`小${i}`] }), JSON.stringify([`${name}道友`]), now.getTime(), now.getTime());
    }
    for (let i = 0; i < LOCATIONS; i += 1) {
      const name = `地点${i}`;
      locationNames.push(name);
      insertEntry.run(`${bookId}-l${i}`, bookId, `${bookId}-sec-locations`, name, "locations", "{}", "[]", now.getTime(), now.getTime());
    }
    for (let i = 0; i < PROPS; i += 1) {
      insertEntry.run(`${bookId}-p${i}`, bookId, `${bookId}-sec-props`, `功法${i}`, "props", "{}", "[]", now.getTime(), now.getTime());
    }
    for (let i = 0; i < FORESHADOWS; i += 1) {
      insertEntry.run(`${bookId}-h${i}`, bookId, `${bookId}-sec-foreshadowing`, `伏笔${i}`, "foreshadowing", JSON.stringify({ status: "已埋设" }), "[]", now.getTime(), now.getTime());
    }

    const insertEvent = db.sqlite.prepare(`
      INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
        confidence, source, status, risk_level, subject_entry_id, object_entry_id, created_at, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '证据', 0.9, 'settle', ?, 'low', ?, NULL, ?, ?)
    `);
    const insertFact = db.sqlite.prepare(`
      INSERT INTO narrative_fact (id, book_id, subject, predicate, object, category, layer, confidence, source_type, source_id,
        source_chapter, evidence_text, valid_from_chapter, valid_until_chapter, subject_entry_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'dynamic', 0.85, 'event', ?, ?, '原文证据', ?, NULL, ?, ?, ?)
    `);
    const insertMention = db.sqlite.prepare(`
      INSERT OR IGNORE INTO narrative_chapter_mention (book_id, chapter_number, position, entity_name, entry_id, source)
      VALUES (?, ?, ?, ?, ?, 'dictionary')
    `);
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
    for (let chapter = 1; chapter <= chapters; chapter += 1) {
      for (let k = 0; k < EVENTS_PER_CHAPTER; k += 1) {
        const a = Math.floor(random() * CHARACTERS);
        const b = Math.floor(random() * CHARACTERS);
        const kind = k % 4;
        const id = `${bookId}-e${chapter}-${k}`;
        const status = random() < 0.85 ? "applied" : random() < 0.5 ? "pending" : "rejected";
        const withEntry = random() < 0.3 ? `${bookId}-c${a}` : null;
        if (kind === 0) {
          const subject = random() < 0.3 ? `${characterNames[a]}与${characterNames[b]}` : characterNames[a]!;
          insertEvent.run(id, bookId, chapter, "relationship_changed", subject, "结盟", characterNames[b]!, status, withEntry, iso, status === "applied" ? iso : null);
          if (status === "applied") insertFact.run(`${id}-f`, bookId, subject, "结盟", characterNames[b]!, "relationship", id, chapter, chapter, withEntry, iso, iso);
        } else if (kind === 1) {
          const place = pick(locationNames);
          insertEvent.run(id, bookId, chapter, "location_changed", random() < 0.1 ? `路人${chapter}` : characterNames[a]!, "抵达", place, status, withEntry, iso, status === "applied" ? iso : null);
          if (status === "applied") insertFact.run(`${id}-f`, bookId, characterNames[a]!, "位置", place, "location", id, chapter, chapter, withEntry, iso, iso);
        } else if (kind === 2) {
          insertEvent.run(id, bookId, chapter, "character_state_changed", `${characterNames[a]}（小${a}）`, "境界", `第${chapter % 9}层`, status, withEntry, iso, status === "applied" ? iso : null);
          if (status === "applied") insertFact.run(`${id}-f`, bookId, characterNames[a]!, "境界", `第${chapter % 9}层`, "character_state", id, chapter, chapter, withEntry, iso, iso);
        } else {
          insertEvent.run(id, bookId, chapter, "hook_progressed", `伏笔${a % FORESHADOWS}`, "推进", "线索浮现", status, null, iso, status === "applied" ? iso : null);
          if (status === "applied") insertFact.run(`${id}-f`, bookId, `伏笔${a % FORESHADOWS}`, "推进", "线索浮现", "hook", id, chapter, chapter, null, iso, iso);
        }
      }
      for (let m = 0; m < 10; m += 1) {
        const c = Math.floor(random() * CHARACTERS);
        insertMention.run(bookId, chapter, m, characterNames[c]!, `${bookId}-c${c}`);
      }
    }
  })();
  return { characterNames, locationNames };
}

describe.skipIf(!process.env.NOVELFORK_BENCH)("长篇规模基准（500 章）", () => {
  let names: { characterNames: string[]; locationNames: string[] };

  beforeAll(async () => {
    tempDir = join(tmpdir(), `novelfork-entity-bench-${crypto.randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
    runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
    ensureNarrativeMemorySchema(storage);
    names = await seedLongBook(storage, BOOK, CHAPTERS - 1);
    rebuildNarrativeEntityIndex(storage, BOOK);
  }, 120_000);

  afterAll(async () => {
    storage?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("量化：全量重建实体索引 vs 单章结算", async () => {
    const counts = Object.fromEntries(["narrative_event", "narrative_fact", "narrative_entity", "narrative_event_participant", "narrative_relation", "narrative_state_change", "narrative_knowledge"].map((table) => [
      table,
      storage.sqlite.prepare<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE book_id = ?`).get(BOOK)!.n,
    ]));

    const plan = await time(() => planNarrativeEntityIndex(storage, BOOK), 5);
    const rebuild = await time(() => rebuildNarrativeEntityIndex(storage, BOOK), 5);
    // 差量刷新：快照命中（同进程连续结算）与快照失效（进程重启后首次，从库里读回）两种基准
    const refreshSnapshot = await time(() => refreshNarrativeEntityIndex(storage, BOOK), 5);
    const refreshCold = await time(() => {
      storage.sqlite.prepare("UPDATE narrative_entity SET last_chapter = last_chapter WHERE book_id = ? AND rowid = (SELECT MAX(rowid) FROM narrative_entity WHERE book_id = ?)").run(BOOK, BOOK);
      storage.sqlite.prepare("DELETE FROM narrative_event_participant WHERE book_id = ? AND rowid = (SELECT MAX(rowid) FROM narrative_event_participant WHERE book_id = ?)").run(BOOK, BOOK);
      return refreshNarrativeEntityIndex(storage, BOOK);
    }, 5);

    const settleSamples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const chapter = CHAPTERS + i;
      const a = names.characterNames[i * 3]!;
      const b = names.characterNames[i * 3 + 1]!;
      const content = `第${chapter}章正文：${a}与${b}在${names.locationNames[i]}会面。`;
      const start = performance.now();
      const result = await settleConfirmedChapter({ bookId: BOOK, chapterNumber: chapter, title: `第${chapter}章`, content }, {
        storage,
        llmExtractor: async () => [
          { eventType: "location_changed", subject: a, predicate: "抵达", object: names.locationNames[i]!, evidenceText: content, confidence: 0.9, source: "settle" },
          { eventType: "relationship_changed", subject: `${a}与${b}`, predicate: "结盟", object: b, evidenceText: content, confidence: 0.9, source: "settle" },
          { eventType: "character_state_changed", subject: b, predicate: "境界", object: "筑基", evidenceText: content, confidence: 0.9, source: "settle" },
        ],
      });
      settleSamples.push(performance.now() - start);
      expect(result.status).toBe("completed");
    }

    const report = {
      counts,
      planMedianMs: Number(plan.median.toFixed(1)),
      rebuildMedianMs: Number(rebuild.median.toFixed(1)),
      refreshSnapshotMedianMs: Number(refreshSnapshot.median.toFixed(1)),
      refreshColdMedianMs: Number(refreshCold.median.toFixed(1)),
      settleMedianMs: Number(median(settleSamples).toFixed(1)),
      settleSamplesMs: settleSamples.map((value) => Number(value.toFixed(1))),
    };
    console.log(`[entity-index bench] ${JSON.stringify(report)}`);
  }, 300_000);
});
