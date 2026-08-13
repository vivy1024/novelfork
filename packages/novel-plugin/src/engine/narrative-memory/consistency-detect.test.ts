import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { runConsistencyCheck, detectRealmDrift, detectOrphanLocation } from "./consistency-detect.js";
import { ensureNarrativeMemorySchema, insertNarrativeFact } from "./storage.js";
import type { NarrativeFact } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-consistency-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  ensureNarrativeMemorySchema(storage);
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      content_md TEXT NOT NULL DEFAULT '',
      summary_md TEXT,
      category TEXT NOT NULL DEFAULT 'unclassified',
      fields_json TEXT NOT NULL DEFAULT '{}',
      custom_fields_json TEXT NOT NULL DEFAULT '{}',
      parent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      status TEXT NOT NULL DEFAULT 'confirmed',
      version INTEGER NOT NULL DEFAULT 1,
      tags_json TEXT NOT NULL DEFAULT '[]',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      related_chapter_numbers_json TEXT NOT NULL DEFAULT '[]',
      related_entry_ids_json TEXT NOT NULL DEFAULT '[]',
      visibility_rule_json TEXT NOT NULL DEFAULT '{"type":"tracked"}',
      participates_in_ai INTEGER NOT NULL DEFAULT 1,
      token_budget INTEGER,
      priority_tier TEXT NOT NULL DEFAULT 'auto',
      layer TEXT NOT NULL DEFAULT 'dynamic',
      importance INTEGER NOT NULL DEFAULT 40,
      summary_l0 TEXT,
      source TEXT NOT NULL DEFAULT 'user',
      revision_history TEXT NOT NULL DEFAULT '[]',
      conflict_status TEXT NOT NULL DEFAULT 'none',
      conflict_detail TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function insertJingweiEntry(storage: StorageDatabase, input: {
  id: string;
  category: string;
  title: string;
  fields?: Record<string, unknown>;
  aliases?: string[];
}): void {
  storage.sqlite.prepare(`
    INSERT INTO story_jingwei_entry (
      id, book_id, section_id, title, category, fields_json, aliases_json, created_at, updated_at
    ) VALUES (?, 'book-1', '', ?, ?, ?, ?, 0, 0)
  `).run(
    input.id,
    input.title,
    input.category,
    JSON.stringify(input.fields ?? {}),
    JSON.stringify(input.aliases ?? []),
  );
}

function fact(input: Partial<NarrativeFact> & Pick<NarrativeFact, "id" | "subject" | "predicate" | "object" | "category">): NarrativeFact {
  return {
    id: input.id,
    bookId: "book-1",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    category: input.category,
    layer: "dynamic",
    confidence: input.confidence ?? 0.9,
    sourceType: "manual",
    validFromChapter: input.validFromChapter ?? 10,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
  };
}

describe("narrative memory consistency detection", () => {
  it("detects realm drift between jingwei characters and memory character_state", async () => {
    const storage = await createStorage();
    try {
      insertJingweiEntry(storage, {
        id: "char-linyuan",
        category: "characters",
        title: "林渊",
        aliases: ["林小渊"],
        fields: { realm: "结丹期" },
      });
      insertNarrativeFact(storage, fact({
        id: "fact-realm",
        subject: "林渊",
        predicate: "修为",
        object: "筑基期",
        category: "character_state",
      }));

      const findings = await detectRealmDrift(storage, { bookId: "book-1" });
      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual(expect.objectContaining({
        kind: "realm-drift",
        entity: "林渊",
        jingweiValue: "结丹期",
        memoryValue: "筑基期",
        // 前端要就地纠正就必须知道改哪条 slot、跳哪一章，不能靠猜。
        memoryPredicate: "修为",
        memoryChapter: 10,
      }));
    } finally {
      storage.close();
    }
  });

  it("does not flag realm drift when values agree", async () => {
    const storage = await createStorage();
    try {
      insertJingweiEntry(storage, {
        id: "char-linyuan",
        category: "characters",
        title: "林渊",
        fields: { realm: "结丹期" },
      });
      insertNarrativeFact(storage, fact({
        id: "fact-realm",
        subject: "林渊",
        predicate: "境界",
        object: "结丹期",
        category: "character_state",
      }));

      const findings = await detectRealmDrift(storage, { bookId: "book-1" });
      expect(findings).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("matches memory facts by jingwei aliases", async () => {
    const storage = await createStorage();
    try {
      insertJingweiEntry(storage, {
        id: "char-linyuan",
        category: "characters",
        title: "林渊",
        aliases: ["林小渊"],
        fields: { realm: "结丹期" },
      });
      insertNarrativeFact(storage, fact({
        id: "fact-realm",
        subject: "林小渊",
        predicate: "修为",
        object: "筑基期",
        category: "character_state",
      }));

      const findings = await detectRealmDrift(storage, { bookId: "book-1" });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.entity).toBe("林渊");
    } finally {
      storage.close();
    }
  });

  it("detects location facts pointing at destroyed jingwei locations", async () => {
    const storage = await createStorage();
    try {
      insertJingweiEntry(storage, {
        id: "loc-qingyun",
        category: "locations",
        title: "青云宗",
        fields: { status: "已毁灭" },
      });
      insertNarrativeFact(storage, fact({
        id: "fact-loc",
        subject: "林渊",
        predicate: "位于",
        object: "青云宗",
        category: "location",
      }));

      const findings = await detectOrphanLocation(storage, { bookId: "book-1" });
      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual(expect.objectContaining({
        kind: "orphan-location",
        entity: "林渊",
        memoryPredicate: "位于",
        memoryChapter: 10,
      }));
    } finally {
      storage.close();
    }
  });

  /**
   * 项目硬纪律：所有拦截与告警都必须带 explanation 三段式，前端只转述、不按 kind
   * 自造文案。检测器少给一段，作者看到的就是没有处置建议的干瘪告警。
   */
  it("gives every finding a three-part explanation the UI can quote verbatim", async () => {
    const storage = await createStorage();
    try {
      insertJingweiEntry(storage, {
        id: "char-linyuan",
        category: "characters",
        title: "林渊",
        fields: { realm: "结丹期" },
      });
      insertNarrativeFact(storage, fact({
        id: "fact-realm",
        subject: "林渊",
        predicate: "修为",
        object: "筑基期",
        category: "character_state",
      }));
      insertJingweiEntry(storage, {
        id: "loc-qingyun",
        category: "locations",
        title: "青云宗",
        fields: { status: "已毁灭" },
      });
      insertNarrativeFact(storage, fact({
        id: "fact-loc",
        subject: "林渊",
        predicate: "位于",
        object: "青云宗",
        category: "location",
      }));

      const result = await runConsistencyCheck(storage, { bookId: "book-1" });
      expect(result.findings.map((finding) => finding.kind)).toEqual(["realm-drift", "orphan-location"]);
      for (const finding of result.findings) {
        expect(finding.explanation.whatHappened.length).toBeGreaterThan(8);
        expect(finding.explanation.whyItMatters.length).toBeGreaterThan(8);
        expect(finding.explanation.suggestedAction.length).toBeGreaterThan(8);
      }
      // 解释要落到具体对象上，不能是「检测到一个需要关注的问题」这类兜底话。
      expect(result.findings[0]?.explanation.whatHappened).toContain("林渊");
      expect(result.findings[0]?.explanation.suggestedAction).toContain("结丹期");
      expect(result.findings[1]?.explanation.whatHappened).toContain("青云宗");
    } finally {
      storage.close();
    }
  });

  it("runs full check and returns summary", async () => {
    const storage = await createStorage();
    try {
      const result = await runConsistencyCheck(storage, { bookId: "book-1" });
      expect(result.bookId).toBe("book-1");
      expect(result.summary).toContain("未发现纰漏");
      expect(result.findings).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("degrades gracefully on legacy jingwei tables missing entry-repo columns", async () => {
    const storage = await createStorage();
    try {
      // 模拟旧表：删掉完整表，重建简化表（缺 aliases_json 等列）。
      storage.sqlite.exec("DROP TABLE story_jingwei_entry");
      storage.sqlite.exec(`
        CREATE TABLE story_jingwei_entry (
          id TEXT PRIMARY KEY NOT NULL,
          book_id TEXT NOT NULL,
          title TEXT NOT NULL,
          category TEXT,
          fields_json TEXT,
          status TEXT,
          deleted_at INTEGER
        );
      `);
      const result = await runConsistencyCheck(storage, { bookId: "book-1" });
      expect(result.findings).toEqual([]);
      expect(result.summary).toContain("未发现纰漏");
    } finally {
      storage.close();
    }
  });
});
