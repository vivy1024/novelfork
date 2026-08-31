import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  findDuplicateJingweiEntries,
  insertDissectionStaging,
  isInvalidEntityTitle,
  listDissectionStaging,
  updateDissectionStagingStatus,
} from "./dissection-staging.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("dissection staging gates", () => {
  it("rejects pronouns, verb phrases and sentence fragments", () => {
    expect(isInvalidEntityTitle("你爸", "characters")).toBe("pronoun");
    expect(isInvalidEntityTitle("他低头", "characters")).toBe("verb-phrase");
    expect(isInvalidEntityTitle("年男人站在雪山", "characters")).toBe("sentence-fragment");
    expect(isInvalidEntityTitle("韩立", "characters")).toBeUndefined();
  });

  it("writes needs-review candidates with AI disabled and requires evidence", async () => {
    const dir = join(tmpdir(), `novelfork-staging-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    tempDirs.push(dir);
    const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
    try {
      expect(() => insertDissectionStaging(storage, {
        bookId: "book-1",
        kind: "characters",
        category: "characters",
        proposedTitle: "韩立",
        sourceRefs: [],
        classificationReason: "规则抽取",
        contentMd: "韩立",
      })).toThrow(/missing-evidence/);

      const record = insertDissectionStaging(storage, {
        bookId: "book-1",
        kind: "characters",
        category: "characters",
        proposedTitle: "韩立",
        sourceRefs: [{ chapterNumber: 1, excerpt: "韩立冷声道。" }],
        classificationReason: "规则抽取人名",
        contentMd: "- 身份：主角",
      });
      expect(record.status).toBe("needs-review");
      expect(record.participatesInAi).toBe(false);
      expect(listDissectionStaging(storage, "book-1")).toHaveLength(1);
      const accepted = updateDissectionStagingStatus(storage, "book-1", record.id, "accepted");
      expect(accepted?.status).toBe("accepted");
      expect(accepted?.participatesInAi).toBe(false);
    } finally {
      storage.close();
    }
  });

  it("deduplicates repeated pending candidates by entry key", async () => {
    const dir = join(tmpdir(), `novelfork-staging-dedupe-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    tempDirs.push(dir);
    const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
    try {
      const input = {
        bookId: "book-1",
        kind: "characters" as const,
        category: "characters",
        proposedTitle: "韩立",
        sourceRefs: [{ chapterNumber: 1, excerpt: "第一处证据" }],
        classificationReason: "规则抽取人名",
        contentMd: "- 身份：主角",
      };
      const first = insertDissectionStaging(storage, input);
      const second = insertDissectionStaging(storage, {
        ...input,
        proposedTitle: "韩立",
        sourceRefs: [{ chapterNumber: 2, excerpt: "第二处证据" }],
      });

      expect(second.id).toBe(first.id);
      expect(listDissectionStaging(storage, "book-1")).toHaveLength(1);
    } finally {
      storage.close();
    }
  });

  it("suggests merge on title or alias hit", () => {
    const dupes = findDuplicateJingweiEntries(
      [{ id: "e1", title: "韩立", aliases: ["厉飞雨的师兄"], category: "characters" }],
      { title: "厉飞雨的师兄", category: "characters" },
    );
    expect(dupes).toEqual([{ entryId: "e1", title: "韩立", reason: "alias" }]);
  });
});
