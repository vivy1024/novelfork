import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  correctNarrativeFact,
  createManualNarrativeFact,
  queryFactsByEntity,
  queryNarrativeFactHistory,
  retireNarrativeFact,
} from "./fact-mutations.js";
import { createNarrativeEvent, persistNarrativeEvents } from "./events.js";
import { applyNarrativeEvents } from "./reducer.js";
import { queryCurrentNarrativeLedger } from "./ledger.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-fact-mutations-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("narrative fact mutations", () => {
  it("creates a manual fact visible in the current ledger", async () => {
    const storage = await createStorage();
    try {
      const result = createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "林渊",
        predicate: "修为",
        object: "结丹期",
        category: "character_state",
        validFromChapter: 40,
      });

      expect(result.ok).toBe(true);
      expect(result.fact?.sourceType).toBe("manual");
      const ledger = queryCurrentNarrativeLedger(storage, { bookId: "book-1" });
      expect(ledger.items.map((fact) => fact.object)).toContain("结丹期");
    } finally {
      storage.close();
    }
  });

  it("corrects a fact by closing the old value and writing a manual one", async () => {
    const storage = await createStorage();
    try {
      const created = createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "林渊",
        predicate: "修为",
        object: "筑基期",
        category: "character_state",
        validFromChapter: 30,
      });
      expect(created.ok).toBe(true);

      const corrected = correctNarrativeFact(storage, {
        bookId: "book-1",
        factId: created.fact!.id,
        object: "结丹期",
      });

      expect(corrected.ok).toBe(true);
      expect(corrected.superseded?.validUntilChapter).toBeTypeOf("number");
      expect(corrected.fact?.object).toBe("结丹期");
      expect(corrected.fact?.sourceType).toBe("manual");

      const ledger = queryCurrentNarrativeLedger(storage, { bookId: "book-1" });
      const slotFacts = ledger.items.filter((fact) => fact.subject === "林渊" && fact.predicate === "修为");
      expect(slotFacts).toHaveLength(1);
      expect(slotFacts[0]?.object).toBe("结丹期");
    } finally {
      storage.close();
    }
  });

  it("rejects correcting an already-closed fact", async () => {
    const storage = await createStorage();
    try {
      const created = createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "林渊",
        predicate: "修为",
        object: "筑基期",
        category: "character_state",
      });
      const retired = retireNarrativeFact(storage, { bookId: "book-1", factId: created.fact!.id });
      expect(retired.ok).toBe(true);

      const corrected = correctNarrativeFact(storage, { bookId: "book-1", factId: created.fact!.id, object: "结丹期" });
      expect(corrected.ok).toBe(false);
      expect(corrected.error).toBe("already-closed");
    } finally {
      storage.close();
    }
  });

  it("retires an open fact out of the current view", async () => {
    const storage = await createStorage();
    try {
      const created = createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "林渊",
        predicate: "位置",
        object: "青云宗",
        category: "location",
      });
      const retired = retireNarrativeFact(storage, { bookId: "book-1", factId: created.fact!.id });
      expect(retired.ok).toBe(true);

      const ledger = queryCurrentNarrativeLedger(storage, { bookId: "book-1" });
      expect(ledger.items).toHaveLength(0);
    } finally {
      storage.close();
    }
  });

  it("returns the full slot history including closed values", async () => {
    const storage = await createStorage();
    try {
      const first = createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "林渊",
        predicate: "修为",
        object: "练气期",
        category: "character_state",
        validFromChapter: 1,
      });
      const corrected = correctNarrativeFact(storage, { bookId: "book-1", factId: first.fact!.id, object: "筑基期" });

      const history = queryNarrativeFactHistory(storage, { bookId: "book-1", factId: corrected.fact!.id });
      expect(history).toHaveLength(2);
      expect(history.map((fact) => fact.object)).toEqual(["练气期", "筑基期"]);
      expect(history[0]?.validUntilChapter).toBeTypeOf("number");
      expect(history[1]?.validUntilChapter).toBeUndefined();
    } finally {
      storage.close();
    }
  });

  it("keeps the history chain when correcting subject or predicate", async () => {
    const storage = await createStorage();
    try {
      const first = createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "误写角色",
        predicate: "实力",
        object: "练气期",
        category: "character_state",
        validFromChapter: 1,
      });
      const corrected = correctNarrativeFact(storage, {
        bookId: "book-1",
        factId: first.fact!.id,
        subject: "林渊",
        predicate: "修为",
        object: "筑基期",
      });

      expect(corrected.ok).toBe(true);
      expect(corrected.fact).toMatchObject({ subject: "林渊", predicate: "修为", object: "筑基期" });
      const history = queryNarrativeFactHistory(storage, { bookId: "book-1", factId: corrected.fact!.id });
      expect(history.map((fact) => [fact.subject, fact.predicate, fact.object])).toEqual([
        ["误写角色", "实力", "练气期"],
        ["林渊", "修为", "筑基期"],
      ]);
    } finally {
      storage.close();
    }
  });

  it("groups open facts by entity", async () => {
    const storage = await createStorage();
    try {
      createManualNarrativeFact(storage, { bookId: "book-1", subject: "林渊", predicate: "修为", object: "结丹期", category: "character_state" });
      createManualNarrativeFact(storage, { bookId: "book-1", subject: "林渊", predicate: "位置", object: "青云宗", category: "location" });
      createManualNarrativeFact(storage, { bookId: "book-1", subject: "苏晴", predicate: "位置", object: "坊市", category: "location" });

      const groups = queryFactsByEntity(storage, { bookId: "book-1" });
      expect(groups).toHaveLength(2);
      const linyuan = groups.find((group) => group.entity === "林渊");
      expect(linyuan?.facts).toHaveLength(2);
    } finally {
      storage.close();
    }
  });

  it("keeps machine events pending when the slot holds a manual fact", async () => {
    const storage = await createStorage();
    try {
      // 作者纠正过「修为 = 结丹期」。
      createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "林渊",
        predicate: "修为",
        object: "结丹期",
        category: "character_state",
        validFromChapter: 40,
      });

      // 机器结算又抽出「修为 = 筑基期」——不得覆盖作者值，应降级 pending。
      const [machineEvent] = persistNarrativeEvents(storage, [createNarrativeEvent({
        bookId: "book-1",
        chapterNumber: 41,
        eventType: "character_state_changed",
        subject: "林渊",
        predicate: "修为",
        object: "筑基期",
        evidenceText: "林渊仍是筑基期。",
        confidence: 0.9,
        layer: "dynamic",
        source: "settle",
      })]);

      const result = applyNarrativeEvents(storage, "book-1", [machineEvent!]);
      expect(result.pendingEventIds).toEqual([machineEvent!.id]);
      expect(result.appliedEventIds).toEqual([]);

      const ledger = queryCurrentNarrativeLedger(storage, { bookId: "book-1" });
      const slotFacts = ledger.items.filter((fact) => fact.subject === "林渊" && fact.predicate === "修为");
      expect(slotFacts).toHaveLength(1);
      expect(slotFacts[0]?.object).toBe("结丹期");
    } finally {
      storage.close();
    }
  });

  it("lets machine events apply when they agree with the manual fact value", async () => {
    const storage = await createStorage();
    try {
      createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "林渊",
        predicate: "修为",
        object: "结丹期",
        category: "character_state",
        validFromChapter: 40,
      });

      const [sameValueEvent] = persistNarrativeEvents(storage, [createNarrativeEvent({
        bookId: "book-1",
        chapterNumber: 41,
        eventType: "character_state_changed",
        subject: "林渊",
        predicate: "修为",
        object: "结丹期",
        evidenceText: "林渊已是结丹期。",
        confidence: 0.9,
        layer: "dynamic",
        source: "settle",
      })]);

      const result = applyNarrativeEvents(storage, "book-1", [sameValueEvent!]);
      // 同值不触发 manual 保护；走正常去重路径（applied 或 skipped 均可，绝不能 pending）。
      expect(result.pendingEventIds).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
