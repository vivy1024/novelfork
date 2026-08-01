import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureNarrativeMemorySchema,
  insertNarrativeEvent,
} from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent } from "../engine/narrative-memory/types.js";
import type { CockpitState } from "./cockpit-service.js";

let activeStorage: StorageDatabase | undefined;

vi.mock("@vivy1024/novelfork-core", () => ({
  getStorageDatabase: () => {
    if (!activeStorage) throw new Error("test storage not initialized");
    return activeStorage;
  },
}));

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-write-preflight-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS book (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content_md TEXT,
      fields_json TEXT,
      related_chapter_numbers_json TEXT,
      category TEXT,
      sort_order INTEGER DEFAULT 0,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  storage.sqlite.prepare(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-1', '测试书', 0, 0)`).run();
  ensureNarrativeMemorySchema(storage);
  return storage;
}

function appliedEvent(partial: Partial<NarrativeEvent> & Pick<NarrativeEvent, "id" | "chapterNumber">): NarrativeEvent {
  return {
    id: partial.id,
    bookId: "book-1",
    chapterNumber: partial.chapterNumber,
    eventType: "timeline_advanced",
    subject: partial.subject ?? "主角",
    predicate: partial.predicate ?? "完成",
    object: partial.object ?? `第${partial.chapterNumber}章关键事件`,
    evidenceText: partial.evidenceText ?? `第${partial.chapterNumber}章发生了关键事件。`,
    confidence: 0.9,
    source: "settle",
    status: "applied",
    riskLevel: "low",
    createdAt: "2026-06-22T00:00:00.000Z",
    appliedAt: "2026-06-22T00:00:00.000Z",
  };
}

function cockpitState(input: {
  formalChapterCount?: number;
  focus?: string | null;
  enabledWritingSkillIds?: string[];
}): CockpitState {
  const formalChapterCount = input.formalChapterCount ?? 0;
  return {
    loadBookConfig: async () => ({
      id: "book-1",
      title: "测试书",
      genre: "xianxia",
      platform: "qidian",
      status: "writing",
      chapterWordCount: 3000,
      language: "zh",
      enabledWritingSkillIds: input.enabledWritingSkillIds ?? [],
    }) as any,
    loadChapterIndex: async () => Array.from({ length: formalChapterCount }, (_, i) => ({
      number: i + 1,
      title: `第${i + 1}章`,
      wordCount: 3000,
      status: "published",
    })) as any,
    bookDir: () => "/tmp/book-1",
  };
}

beforeEach(async () => {
  activeStorage = await createStorage();
});

afterEach(async () => {
  activeStorage?.close();
  activeStorage = undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("write.preflight", () => {
  it("allows clean open when book has no formal chapters", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "开篇写主角下山寻仇，先从客栈冲突切入。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 0, focus: null }),
    });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.formalChapterCount).toBe(0);
    expect(result.resolvedDirective).toContain("开篇写主角下山寻仇");
  });

  it("blocks missing directive when no focus is available", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 0 }),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === "missing-directive")).toBe(true);
  });

  it("uses focus default and sets needsUserConfirm", async () => {
    activeStorage!.sqlite.prepare(`
      INSERT INTO story_jingwei_entry (id, book_id, title, content_md, category, updated_at, deleted_at)
      VALUES ('focus-1', 'book-1', '当前焦点', '本章推进：药园试探小瓶秘密', 'focus', '2026-06-22T00:00:00.000Z', NULL)
    `).run();

    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 0 }),
    });

    expect(result.resolvedDirective).toContain("药园试探小瓶秘密");
    expect(result.needsUserConfirm).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("blocks empty-recent-progress when formal chapters exist but memory is empty", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 3 }),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === "empty-recent-progress")).toBe(true);
  });

  it("passes when formal chapters have applied memory events", async () => {
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-10", chapterNumber: 10 }));
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-11", chapterNumber: 11 }));

    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 11 }),
    });

    expect(result.ok).toBe(true);
    expect(result.recentChapters.length).toBeGreaterThan(0);
    expect(result.memoryHealth.timeline).toBe("ok");
    expect(result.warningItems.some((item) => item.code === "style-disabled")).toBe(true);
  });

  it("attaches human-readable explanation to blockers and warnings", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 3 }),
    });

    const blocker = result.blockers.find((item) => item.code === "empty-recent-progress");
    expect(blocker?.kind).toBe("persistent");
    expect(blocker?.explanation?.whatHappened).toBeTruthy();
    expect(blocker?.explanation?.suggestedAction).toContain("settle_range");

    const warning = result.warningItems.find((item) => item.code === "style-disabled");
    expect(warning?.kind).toBe("advisory");
    expect(warning?.explanation?.whyItMatters).toBeTruthy();
  });

  it("resolves the platform profile and warns on chapter target mismatch", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "开篇写主角下山寻仇，先从客栈冲突切入。",
      storage: activeStorage,
      cockpitState: {
        ...cockpitState({ formalChapterCount: 0 }),
        loadBookConfig: async () => ({
          id: "book-1",
          title: "测试书",
          platform: "tomato",
          genre: "xianxia",
          status: "writing",
          chapterWordCount: 9000,
          language: "zh",
          enabledWritingSkillIds: [],
        }) as never,
      },
    });

    expect(result.platform?.platform).toBe("fanqie");
    expect(result.platform?.label).toBe("番茄小说");
    expect(result.platform?.chapterTargetStatus).toBe("above-max");
    expect(result.warningItems.some((item) => item.code === "platform-target-mismatch")).toBe(true);
    expect(result.ok).toBe(true);
  });
});

describe("assertDirectiveReady", () => {
  it("requires acceptFocusDefault when only focus default is available", async () => {
    const { assertDirectiveReady } = await import("./write-preflight.js");
    const blocked = assertDirectiveReady({
      preflight: {
        ok: true,
        resolvedDirective: "按当前焦点推进：药园试探",
        needsUserConfirm: true,
        blockers: [],
      },
    });
    expect(blocked.ok).toBe(false);

    const accepted = assertDirectiveReady({
      acceptFocusDefault: true,
      preflight: {
        ok: true,
        resolvedDirective: "按当前焦点推进：药园试探",
        needsUserConfirm: true,
        blockers: [],
      },
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.directive).toContain("药园试探");
  });
});

describe("scene.spec hard gate descriptions", () => {
  it("requires write.preflight in tool registry description", async () => {
    const { NOVEL_SESSION_TOOL_DEFINITIONS } = await import("./tool-registry.js");
    const preflight = NOVEL_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === "write.preflight");
    const scene = NOVEL_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === "scene.spec");
    const pipeline = NOVEL_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === "pipeline.write");

    expect(preflight).toBeTruthy();
    expect(scene?.description).toContain("write.preflight");
    expect(pipeline?.description).toContain("write.preflight");
    expect(pipeline?.description).toContain("context-not-ready");
  });
});
