import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  sanitizeFtsQuery,
  searchContextCardsExact,
  type ExactContextCardMatch,
} from "./fts.js";
import type { NarrativeContextCard } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-fts-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function card(input: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "title" | "content">): NarrativeContextCard {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    sourceType: input.sourceType ?? "jingwei",
    sourceId: input.sourceId ?? input.id,
    channel: input.channel ?? "state",
    title: input.title,
    content: input.content,
    normal: input.normal,
    summary: input.summary,
    brief: input.brief ?? input.summary ?? input.content,
    tags: input.tags ?? [],
    entities: input.entities ?? [],
    priority: input.priority ?? 50,
    importance: input.importance ?? 50,
    accessCount: input.accessCount ?? 0,
    lastAccessedAt: input.lastAccessedAt,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    reason: input.reason ?? "test card",
    estimatedTokens: input.estimatedTokens ?? 20,
    score: input.score,
    scoreBreakdown: input.scoreBreakdown,
  };
}

function ids(matches: readonly ExactContextCardMatch[]) {
  return matches.map((match) => match.card.id);
}

describe("Narrative exact FTS/LIKE recall", () => {
  it("sanitizes FTS special characters into quoted terms", () => {
    expect(sanitizeFtsQuery("韩立 + 小瓶 (秘密)*")).toBe('"韩立" "小瓶" "秘密"');
    expect(sanitizeFtsQuery('" OR NEAR/1')).toBe('"OR" "NEAR" "1"');
    expect(sanitizeFtsQuery("   ")).toBe("");
  });

  it("matches ordinary keywords across title, brief, summary and content", async () => {
    const storage = await createStorage();
    try {
      const matches = searchContextCardsExact({
        storage,
        query: "小瓶",
        cards: [
          card({ id: "hanli", title: "韩立", content: "谨慎修炼。", brief: "持有小瓶" }),
          card({ id: "other", title: "墨大夫", content: "试探弟子。" }),
        ],
      });

      expect(ids(matches)).toEqual(["hanli"]);
      expect(matches[0]?.matchReason).toContain("小瓶");
    } finally {
      storage.close();
    }
  });

  it("matches names, aliases and tags through entity/tag fields", async () => {
    const storage = await createStorage();
    try {
      const matches = searchContextCardsExact({
        storage,
        query: "韩老魔",
        cards: [
          card({ id: "hanli", title: "韩立", content: "主角。", entities: ["韩老魔"], tags: ["主角"] }),
          card({ id: "bottle", title: "小瓶", content: "法宝。", tags: ["法宝"] }),
        ],
      });

      expect(ids(matches)).toEqual(["hanli"]);
      expect(matches[0]?.matchReason).toContain("entities");
    } finally {
      storage.close();
    }
  });

  it("falls back to LIKE when FTS is disabled", async () => {
    const storage = await createStorage();
    try {
      const matches = searchContextCardsExact({
        storage,
        query: "七玄门",
        forceLike: true,
        cards: [
          card({ id: "place", title: "门派", content: "七玄门是韩立早期所在。" }),
          card({ id: "style", title: "文风", content: "克制冷静。" }),
        ],
      });

      expect(ids(matches)).toEqual(["place"]);
      expect(matches[0]?.matchReason).toContain("LIKE");
    } finally {
      storage.close();
    }
  });
});
