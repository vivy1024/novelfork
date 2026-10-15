import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { correctNarrativeFact, retireNarrativeFact } from "../engine/narrative-memory/fact-mutations.js";
import {
  ensureNarrativeMemorySchema,
  insertNarrativeEvent,
  insertNarrativeFact,
} from "../engine/narrative-memory/storage.js";
import { ensureSettlementLedgerSchema } from "../engine/narrative-memory/settlement-idempotency.js";
import type { NarrativeEvent, NarrativeFact } from "../engine/narrative-memory/types.js";
import { withChapterIndexLock } from "../engine/writing-resource/chapter-index-lock.js";
import { handleChapterDiscardRange } from "./chapter-discard-range.js";

const tempDirs: string[] = [];

async function createBook(chapters: number[]): Promise<{ bookRoot: string; storage: StorageDatabase }> {
  const dir = join(tmpdir(), `novelfork-discard-range-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters"), { recursive: true });
  await mkdir(join(dir, "story"), { recursive: true });
  tempDirs.push(dir);
  await writeFile(join(dir, "book.json"), JSON.stringify({ id: "book-1", title: "测试书" }), "utf8");
  const index = [];
  for (const number of chapters) {
    const fileName = `${String(number).padStart(4, "0")}-ch.md`;
    await writeFile(join(dir, "chapters", fileName), `第${number}章正文`, "utf8");
    index.push({ number, title: `第${number}章`, fileName, wordCount: 10, status: "accepted" });
  }
  await writeFile(join(dir, "chapters", "index.json"), JSON.stringify(index), "utf8");
  await writeFile(join(dir, "story", "pending_hooks.md"), `# 伏笔\n- 第1章埋下的伏笔\n- 第5章埋下的伏笔\n`, "utf8");

  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content_md TEXT,
      fields_json TEXT,
      related_chapter_numbers_json TEXT,
      category TEXT,
      lifecycle TEXT,
      sort_order INTEGER DEFAULT 0,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  ensureNarrativeMemorySchema(storage);
  return { bookRoot: dir, storage };
}

function event(id: string, chapterNumber: number): NarrativeEvent {
  return {
    id,
    bookId: "book-1",
    chapterNumber,
    eventType: "timeline_advanced",
    subject: "主角",
    predicate: "完成",
    object: `事件${chapterNumber}`,
    evidenceText: `第${chapterNumber}章事件`,
    confidence: 0.9,
    source: "settle",
    status: "applied",
    riskLevel: "low",
    createdAt: "2026-06-22T00:00:00.000Z",
    appliedAt: "2026-06-22T00:00:00.000Z",
  };
}

function fact(id: string, sourceChapter: number): NarrativeFact {
  return {
    id,
    bookId: "book-1",
    subject: "主角",
    predicate: "位于",
    object: `地点${sourceChapter}`,
    category: "character_state",
    layer: "dynamic",
    confidence: 0.9,
    sourceType: "event",
    sourceId: `e-${sourceChapter}`,
    sourceChapter,
    validFromChapter: sourceChapter,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("chapter.discard_range", () => {
  it("requires confirm=true", async () => {
    const { bookRoot, storage } = await createBook([1]);
    try {
      const result = await handleChapterDiscardRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 1,
        confirm: false as unknown as true,
        storage,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("confirm-required");
    } finally {
      storage.close();
    }
  });

  it("clears only in-range memory and archives chapter files", async () => {
    const { bookRoot, storage } = await createBook([1, 2, 5]);
    try {
      insertNarrativeEvent(storage, event("e-1", 1));
      insertNarrativeEvent(storage, event("e-2", 2));
      insertNarrativeEvent(storage, event("e-5", 5));
      insertNarrativeFact(storage, fact("f-1", 1));
      insertNarrativeFact(storage, fact("f-5", 5));

      storage.sqlite.prepare(`
        INSERT INTO story_jingwei_entry (id, book_id, title, content_md, fields_json, related_chapter_numbers_json, category, lifecycle, updated_at, deleted_at)
        VALUES ('hook-1', 'book-1', '第1章伏笔', '内容', '{}', '[1]', 'foreshadowing', 'active', '2026-06-22T00:00:00.000Z', NULL)
      `).run();

      const result = await handleChapterDiscardRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 2,
        confirm: true,
        storage,
      });

      expect(result.ok).toBe(true);
      expect(result.deletedEvents).toBe(2);
      expect(result.deletedFacts).toBe(1);
      expect(result.deletedChapterFiles).toBe(2);
      expect(result.hooksReset).toBeGreaterThanOrEqual(1);

      const remainingEvents = storage.sqlite.prepare(
        "SELECT chapter_number AS n FROM narrative_event WHERE book_id = ? ORDER BY chapter_number",
      ).all("book-1") as Array<{ n: number }>;
      expect(remainingEvents).toEqual([{ n: 5 }]);

      const remainingFacts = storage.sqlite.prepare(
        "SELECT source_chapter AS n FROM narrative_fact WHERE book_id = ?",
      ).all("book-1") as Array<{ n: number }>;
      expect(remainingFacts).toEqual([{ n: 5 }]);

      const index = JSON.parse(await readFile(join(bookRoot, "chapters", "index.json"), "utf8")) as Array<{ number: number }>;
      expect(index.map((item) => item.number)).toEqual([5]);

      const hooks = await readFile(join(bookRoot, "story", "pending_hooks.md"), "utf8");
      expect(hooks).not.toContain("第1章");
      expect(hooks).toContain("第5章");
    } finally {
      storage.close();
    }
  });

it("删章后不留孤儿记忆，且被删章关闭的旧事实重新激活（T-14②）", async () => {
  const { bookRoot, storage } = await createBook([1, 5]);
  try {
    // 第 1 章的旧事实：从第 1 章起生效，被第 5 章（将被删的章）结算出的同槽位新值关闭。
    insertNarrativeFact(storage, { ...fact("f-old-closed-by-5", 1), validUntilChapter: 5 });
    insertNarrativeFact(storage, fact("f-5-successor", 5));
    // 第 5 章的孤儿候选：结算台账、证据链、章节提及、结构分、场景。
    ensureSettlementLedgerSchema(storage);
    storage.sqlite.prepare(`INSERT INTO narrative_chapter_settlement (book_id, chapter_number, content_fingerprint, settled_at, settlement_count, event_ids_json) VALUES ('book-1', 5, 'fp', '2026-06-22T00:00:00.000Z', 1, '[]')`).run();
    storage.sqlite.prepare(`INSERT INTO narrative_settlement_artifact (book_id, chapter_number, content_fingerprint, artifact_json, created_at) VALUES ('book-1', 5, 'fp', '{}', '2026-06-22T00:00:00.000Z')`).run();
    storage.sqlite.prepare(`INSERT INTO narrative_chapter_mention (book_id, chapter_number, position, entity_name) VALUES ('book-1', 5, 0, '韩立')`).run();
    storage.sqlite.prepare(`INSERT INTO narrative_structure_score (id, book_id, chapter_number, feature_id, dimension, value, recorded_at) VALUES ('sc-5', 'book-1', 5, 'f', 'd', 'v', 1782950400000)`).run();
    storage.sqlite.prepare(`INSERT INTO narrative_scene (id, book_id, chapter_number, ordinal, created_at, updated_at) VALUES ('scene-5', 'book-1', 5, 0, 1782950400000, 1782950400000)`).run();

    const result = await handleChapterDiscardRange({
      bookId: "book-1",
      bookRoot,
      fromChapter: 5,
      toChapter: 5,
      confirm: true,
      storage,
    });
    expect(result.ok).toBe(true);

    const orphanCount = (sql: string) => storage.sqlite.prepare<{ count: number }>(sql).get()?.count ?? 0;
    const residue = {
      settlement: orphanCount("SELECT COUNT(*) AS count FROM narrative_chapter_settlement WHERE chapter_number = 5"),
      artifact: orphanCount("SELECT COUNT(*) AS count FROM narrative_settlement_artifact WHERE chapter_number = 5"),
      mention: orphanCount("SELECT COUNT(*) AS count FROM narrative_chapter_mention WHERE chapter_number = 5"),
      structureScore: orphanCount("SELECT COUNT(*) AS count FROM narrative_structure_score WHERE chapter_number = 5"),
      scene: orphanCount("SELECT COUNT(*) AS count FROM narrative_scene WHERE chapter_number = 5"),
    };
    expect(residue).toEqual({ settlement: 0, artifact: 0, mention: 0, structureScore: 0, scene: 0 });

    // 被删章关闭的旧事实重新激活：valid_until 不再指向已删除的第 5 章。
    const reactivated = storage.sqlite
      .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE id = 'f-old-closed-by-5' AND valid_until_chapter IS NULL")
      .get()?.count;
    expect(reactivated).toBe(1);
    // 结果字段与库内实际变化一致：恰好重新激活 1 条旧事实，清理掉 5 张孤儿表各 1 行。
    expect(result.reactivatedFacts).toBe(1);
    expect(result.deletedOrphans).toBe(5);
  } finally {
    storage.close();
  }
});

describe("删章重新激活只认「关闭它的后继值来自被删章」（T-14②）", () => {
  function openFacts(storage: StorageDatabase): string[] {
    return storage.sqlite
      .prepare<{ id: string }>("SELECT id FROM narrative_fact WHERE book_id = 'book-1' AND valid_until_chapter IS NULL ORDER BY id")
      .all()
      .map((row) => row.id);
  }

  async function discard(bookRoot: string, storage: StorageDatabase, fromChapter: number, toChapter: number) {
    const result = await handleChapterDiscardRange({ bookId: "book-1", bookRoot, fromChapter, toChapter, confirm: true, storage });
    expect(result.ok).toBe(true);
    return result;
  }

  it("作者手动作废的事实，删掉最后几章后不复活", async () => {
    const { bookRoot, storage } = await createBook([1, 5]);
    try {
      insertNarrativeFact(storage, fact("f-1", 1));
      // 第 5 章另一个槽位的事实：让「全书最大章」到 5，作者作废时 valid_until 会写成 5。
      insertNarrativeFact(storage, { ...fact("f-5-other-slot", 5), subject: "配角" });
      expect(retireNarrativeFact(storage, { bookId: "book-1", factId: "f-1" }).ok).toBe(true);
      expect(storage.sqlite.prepare<{ until: number }>("SELECT valid_until_chapter AS until FROM narrative_fact WHERE id = 'f-1'").get()?.until).toBe(5);

      const result = await discard(bookRoot, storage, 5, 5);

      expect(openFacts(storage), "author-retired fact was revived by discarding chapter 5").not.toContain("f-1");
      expect(result.reactivatedFacts).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("作者纠正过的事实：删掉最后几章后原值不复活，作者的纠正值保留", async () => {
    const { bookRoot, storage } = await createBook([1, 5]);
    try {
      insertNarrativeFact(storage, fact("f-1", 1));
      insertNarrativeFact(storage, { ...fact("f-5-other-slot", 5), subject: "配角" });
      const corrected = correctNarrativeFact(storage, { bookId: "book-1", factId: "f-1", object: "作者认定的地点" });
      expect(corrected.ok).toBe(true);

      await discard(bookRoot, storage, 5, 5);

      const open = openFacts(storage);
      expect(open, "author-corrected original was revived").not.toContain("f-1");
      expect(open, "author's correction was deleted together with the discarded chapter").toContain(corrected.fact!.id);
    } finally {
      storage.close();
    }
  });

  it("改写第 12 章作废的旧事实（valid_until=11 < valid_from=12），只删第 11 章时不复活", async () => {
    const { bookRoot, storage } = await createBook([11, 12]);
    try {
      insertNarrativeFact(storage, { ...fact("f-12-retired-by-rewrite", 12), validUntilChapter: 11 });

      const result = await discard(bookRoot, storage, 11, 11);

      expect(openFacts(storage)).not.toContain("f-12-retired-by-rewrite");
      expect(result.reactivatedFacts).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("对照：被第 N 章新值正常关闭的旧值，删第 N 章后复活（原有正确行为保持）", async () => {
    const { bookRoot, storage } = await createBook([1, 5]);
    try {
      insertNarrativeFact(storage, { ...fact("f-1", 1), validUntilChapter: 5 });
      insertNarrativeFact(storage, fact("f-5", 5));

      const result = await discard(bookRoot, storage, 5, 5);

      expect(openFacts(storage)).toEqual(["f-1"]);
      expect(result.reactivatedFacts).toBe(1);
    } finally {
      storage.close();
    }
  });
});

describe("删章清理不留残留，且失败可安全重试（T-14④⑤⑥）", () => {
  it("场景挂载随场景一起删除，文风金库里被删章的 AI 原稿移出金库", async () => {
    const { bookRoot, storage } = await createBook([1, 5]);
    try {
      storage.sqlite.prepare(`INSERT INTO narrative_scene (id, book_id, chapter_number, ordinal, created_at, updated_at) VALUES ('scene-1', 'book-1', 1, 0, 1, 1), ('scene-5', 'book-1', 5, 0, 1, 1)`).run();
      storage.sqlite.prepare(`INSERT INTO narrative_storyline (id, book_id, name, created_at, updated_at) VALUES ('line-1', 'book-1', '主线', 1, 1)`).run();
      storage.sqlite.prepare(`INSERT INTO narrative_scene_storyline (scene_id, storyline_id, role, created_at) VALUES ('scene-1', 'line-1', 'primary', 1), ('scene-5', 'line-1', 'primary', 1)`).run();
      const vaultDir = join(bookRoot, "story", "style-vault");
      await mkdir(vaultDir, { recursive: true });
      for (const n of [1, 5]) {
        await writeFile(join(vaultDir, `chapter-${String(n).padStart(4, "0")}.json`), JSON.stringify({ schemaVersion: 1, chapterNumber: n, text: `第${n}章原稿`, source: "pipeline.write", createdAt: "2026-06-22T00:00:00.000Z" }), "utf8");
      }

      const result = await handleChapterDiscardRange({ bookId: "book-1", bookRoot, fromChapter: 5, toChapter: 5, confirm: true, storage });
      expect(result.ok).toBe(true);

      const mounts = storage.sqlite.prepare<{ sceneId: string }>("SELECT scene_id AS sceneId FROM narrative_scene_storyline ORDER BY scene_id").all().map((row) => row.sceneId);
      expect(mounts, "orphan storyline mount left for a deleted scene").toEqual(["scene-1"]);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_storyline").get()?.count).toBe(1);

      const vault = (await readdir(vaultDir)).sort();
      expect(vault, "style-vault draft of the discarded chapter is still in the vault").toEqual(["chapter-0001.json"]);
    } finally {
      storage.close();
    }
  });

  it("记忆清理失败：返回 ok:false 与三段式 explanation，什么都没动；排除故障后重试成功", async () => {
    const { bookRoot, storage } = await createBook([1, 5]);
    try {
      insertNarrativeEvent(storage, event("e-5", 5));
      storage.sqlite.exec(`
        CREATE TRIGGER t14_simulated_failure BEFORE DELETE ON narrative_event
        BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;
      `);

      const failed = await handleChapterDiscardRange({ bookId: "book-1", bookRoot, fromChapter: 5, toChapter: 5, confirm: true, storage });

      expect(failed.ok).toBe(false);
      expect(failed.error).toBe("memory-cleanup-failed");
      expect(failed.explanation?.whatHappened).toBeTruthy();
      expect(failed.explanation?.whyItMatters).toBeTruthy();
      expect(failed.explanation?.suggestedAction).toMatch(/重试/u);
      // 事务回滚 + 记忆先于文件处理：记忆与正文都原样。
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE id = 'e-5'").get()?.count).toBe(1);
      expect((await readdir(join(bookRoot, "chapters"))).sort()).toContain("0005-ch.md");

      storage.sqlite.exec("DROP TRIGGER t14_simulated_failure");
      const retried = await handleChapterDiscardRange({ bookId: "book-1", bookRoot, fromChapter: 5, toChapter: 5, confirm: true, storage });
      expect(retried.ok).toBe(true);
      expect(retried.deletedEvents).toBe(1);
      expect(retried.deletedChapterFiles).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("章节索引的读改写排在章节索引锁里，不抹掉并发写入方的条目", async () => {
    const { bookRoot, storage } = await createBook([1, 5]);
    const indexPath = join(bookRoot, "chapters", "index.json");
    try {
      let releaseWriter!: () => void;
      const writerGate = new Promise<void>((resolveGate) => { releaseWriter = resolveGate; });
      // 另一个写入方（例如写作台保存第 9 章）先拿到锁，读出索引后停在半路。
      const writer = withChapterIndexLock(bookRoot, async () => {
        const index = JSON.parse(await readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
        await writerGate;
        index.push({ number: 9, title: "第9章", fileName: "0009-ch.md", wordCount: 10, status: "accepted" });
        await writeFile(indexPath, JSON.stringify(index), "utf8");
      });
      const discarding = handleChapterDiscardRange({ bookId: "book-1", bookRoot, fromChapter: 5, toChapter: 5, confirm: true, storage });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      releaseWriter();
      const [, result] = await Promise.all([writer, discarding]);
      expect(result.ok).toBe(true);

      const numbers = (JSON.parse(await readFile(indexPath, "utf8")) as Array<{ number: number }>).map((entry) => entry.number).sort((a, b) => a - b);
      expect(numbers, "index read-modify-write raced with a concurrent writer").toEqual([1, 9]);
    } finally {
      storage.close();
    }
  });

  it("生产路径（写作资源服务可用）默认归档：被删章正文进 _discarded，不被物理删除", async () => {
    const dir = join(tmpdir(), `novelfork-discard-archive-${crypto.randomUUID()}`);
    tempDirs.push(dir);
    await mkdir(join(dir, "chapters"), { recursive: true });
    await writeFile(join(dir, "book.json"), JSON.stringify({ id: "book-1", title: "测试书" }), "utf8");
    const index = [];
    for (const number of [1, 5]) {
      const fileName = `${String(number).padStart(4, "0")}-ch.md`;
      await writeFile(join(dir, "chapters", fileName), `第${number}章正文`, "utf8");
      index.push({ number, title: `第${number}章`, fileName, wordCount: 10, status: "accepted" });
    }
    await writeFile(join(dir, "chapters", "index.json"), JSON.stringify(index), "utf8");
    const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
    try {
      runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
      await createBookRepository(storage).create({
        id: "book-1",
        name: "测试书",
        jingweiMode: "dynamic",
        currentChapter: 5,
        createdAt: new Date("2026-06-22T00:00:00.000Z"),
        updatedAt: new Date("2026-06-22T00:00:00.000Z"),
      });

      const result = await handleChapterDiscardRange({ bookId: "book-1", bookRoot: dir, fromChapter: 5, toChapter: 5, confirm: true, storage });
      expect(result.ok).toBe(true);

      const chapterFiles = (await readdir(join(dir, "chapters"), { recursive: true }))
        .map((name) => String(name).replace(/\\/gu, "/"));
      expect(chapterFiles).not.toContain("0005-ch.md");
      const archived = chapterFiles.filter((name) => name.startsWith("_discarded/") && name.endsWith("0005-ch.md"));
      expect(archived, "default archive mode physically deleted the chapter text").toHaveLength(1);
      expect(await readFile(join(dir, "chapters", archived[0]!), "utf8")).toBe("第5章正文");
    } finally {
      storage.close();
    }
  });
});
});
