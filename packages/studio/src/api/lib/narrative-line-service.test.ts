import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  StateManager,
  createBibleCharacterArcRepository,
  createBibleCharacterRepository,
  createBibleConflictRepository,
  createBibleEventRepository,
  createBibleSettingRepository,
  createBookRepository,
  createStorageDatabase,
  runStorageMigrations,
} from "@vivy1024/novelfork-core";

import { createNarrativeLineService } from "./narrative-line-service.js";

const tempDirs: string[] = [];

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "novelfork-narrative-line-"));
  tempDirs.push(root);
  const state = new StateManager(root);
  const storage = createStorageDatabase({ databasePath: join(root, "novelfork.db") });
  runStorageMigrations(storage);
  await createBookRepository(storage).create({
    id: "book-1",
    name: "天墟试炼",
    bibleMode: "dynamic",
    currentChapter: 12,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
  });
  const service = createNarrativeLineService({
    state,
    storage,
    now: () => new Date("2026-05-03T00:00:00.000Z"),
  });
  return { root, state, storage, service };
}

async function createBookFiles(root: string, chapters: ReadonlyArray<{ number: number; title: string }> = []) {
  const bookDir = join(root, "books", "book-1");
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(bookDir, "story"), { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({
    id: "book-1",
    title: "天墟试炼",
    platform: "qidian",
    genre: "玄幻",
    status: "active",
    targetChapters: 100,
    chapterWordCount: 3000,
    language: "zh",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  }, null, 2), "utf-8");
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify(chapters.map((chapter) => ({
    ...chapter,
    status: "approved",
    wordCount: 3000,
    auditIssues: [],
    lengthWarnings: [],
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  })), null, 2), "utf-8");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("narrative-line-service", () => {
  it("returns an empty read-only snapshot for an empty book", async () => {
    const harness = await createHarness();
    try {
      await createBookFiles(harness.root);

      const snapshot = await harness.service.getSnapshot({ bookId: "book-1" });

      expect(snapshot).toMatchObject({
        bookId: "book-1",
        generatedAt: "2026-05-03T00:00:00.000Z",
        nodes: [],
        edges: [],
        warnings: [expect.objectContaining({ type: "chapter-drift", severity: "info" })],
      });
    } finally {
      harness.storage.close();
    }
  });

  it("builds chapter nodes, beats and sequential edges from chapter summaries", async () => {
    const harness = await createHarness();
    try {
      await createBookFiles(harness.root, [{ number: 1, title: "入山" }, { number: 2, title: "问心" }]);
      await writeFile(join(harness.root, "books", "book-1", "story", "chapter_summaries.md"), "# 章节摘要\n\n- 第1章：主角入山，青铜铃异动。\n- 第2章：问心阵失败，师兄递来线索。\n", "utf-8");

      const snapshot = await harness.service.getSnapshot({ bookId: "book-1" });

      expect(snapshot.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "chapter:book-1:1", type: "chapter", title: "第1章 入山", summary: "主角入山，青铜铃异动。" }),
        expect.objectContaining({ id: "chapter:book-1:2", type: "chapter", title: "第2章 问心", summary: "问心阵失败，师兄递来线索。" }),
      ]));
      expect(snapshot.beats).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "beat:book-1:1", chapterNumber: 1, nodeIds: ["chapter:book-1:1"] }),
      ]));
      expect(snapshot.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ fromNodeId: "chapter:book-1:1", toNodeId: "chapter:book-1:2", type: "causes", confidence: "inferred" }),
      ]));
    } finally {
      harness.storage.close();
    }
  });

  it("folds foreshadowing, payoff, conflicts and character arcs into nodes and warnings", async () => {
    const harness = await createHarness();
    try {
      await createBookFiles(harness.root, [
        { number: 1, title: "入山" },
        { number: 2, title: "问心" },
        { number: 12, title: "裂铃" },
      ]);
      await writeFile(join(harness.root, "books", "book-1", "story", "pending_hooks.md"), "# 待处理伏笔\n\n- [ ] 第1章：青铜铃为何自鸣\n", "utf-8");
      await createBibleEventRepository(harness.storage).create({
        id: "event-foreshadow-1",
        bookId: "book-1",
        name: "青铜铃自鸣",
        eventType: "foreshadow",
        chapterStart: 1,
        chapterEnd: null,
        summary: "青铜铃暗示旧神苏醒。",
        relatedCharacterIdsJson: "[]",
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        foreshadowState: "buried",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      });
      await createBibleEventRepository(harness.storage).create({
        id: "event-payoff-1",
        bookId: "book-1",
        name: "旧神回声",
        eventType: "payoff",
        chapterStart: 12,
        chapterEnd: null,
        summary: "旧神回声解释青铜铃。",
        relatedCharacterIdsJson: "[]",
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        foreshadowState: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      });
      await createBibleConflictRepository(harness.storage).create({
        id: "conflict-1",
        bookId: "book-1",
        name: "资源稀缺",
        type: "system-scarcity",
        scope: "main",
        priority: 1,
        stakes: "主角必须突破封锁。",
        protagonistSideJson: "[]",
        antagonistSideJson: "[]",
        rootCauseJson: JSON.stringify({ cause: "宗门资源垄断" }),
        evolutionPathJson: JSON.stringify([{ chapter: 1, state: "escalating", summary: "资源被克扣" }]),
        resolutionState: "escalating",
        resolutionChapter: null,
        relatedConflictIdsJson: "[]",
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      });
      await createBibleCharacterRepository(harness.storage).create({
        id: "char-1",
        bookId: "book-1",
        name: "林月",
        aliasesJson: "[]",
        roleType: "supporting",
        summary: "守铃人。",
        traitsJson: "{}",
        firstChapter: 1,
        lastChapter: null,
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      });
      await createBibleCharacterArcRepository(harness.storage).create({
        id: "arc-1",
        bookId: "book-1",
        characterId: "char-1",
        arcType: "成长",
        startingState: "凡人杂役",
        endingState: "独当一面",
        currentPosition: "学会保命",
        keyTurningPointsJson: "[]",
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      });
      await createBibleSettingRepository(harness.storage).create({
        id: "setting-1",
        bookId: "book-1",
        category: "world-rule",
        name: "旧神回声规则",
        content: "铃声会唤醒旧神残响。",
        nestedRefsJson: "[]",
        visibilityRuleJson: JSON.stringify({ type: "global" }),
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      });

      const snapshot = await harness.service.getSnapshot({ bookId: "book-1" });

      expect(snapshot.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "event:event-foreshadow-1", type: "foreshadow", chapterNumber: 1 }),
        expect.objectContaining({ id: "event:event-payoff-1", type: "payoff", chapterNumber: 12 }),
        expect.objectContaining({ id: "conflict:conflict-1", type: "conflict", title: "资源稀缺" }),
        expect.objectContaining({ id: "character-arc:arc-1", type: "character-arc" }),
        expect.objectContaining({ id: "setting:setting-1", type: "setting" }),
      ]));
      expect(snapshot.foreshadowThreads).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "foreshadow:event-foreshadow-1", status: "due", dueChapter: 11 }),
      ]));
      expect(snapshot.payoffLinks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "payoff:event-payoff-1", payoffNodeId: "event:event-payoff-1" }),
      ]));
      expect(snapshot.conflictThreads).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "conflict-thread:conflict-1", status: "escalating" }),
      ]));
      expect(snapshot.warnings.map((warning) => warning.type)).toEqual(expect.arrayContaining(["open-foreshadow", "missing-payoff", "stalled-conflict", "chapter-drift"]));
    } finally {
      harness.storage.close();
    }
  });

  it("previews narrative changes without writing, rejects without writing, and applies approved changes with audit metadata", async () => {
    const harness = await createHarness();
    try {
      await createBookFiles(harness.root, [{ number: 1, title: "入山" }]);
      const proposedNode = {
        id: "agent-node-1",
        bookId: "book-1",
        type: "event" as const,
        title: "林月守铃",
        summary: "林月第一次主动守住青铜铃。",
        chapterNumber: 1,
      };

      const preview = await harness.service.proposeChange({
        bookId: "book-1",
        summary: "补充林月守铃事件",
        nodes: [proposedNode],
        reason: "章节推进需要明确人物弧光节点。",
      });

      expect(preview).toMatchObject({
        bookId: "book-1",
        summary: "补充林月守铃事件",
        nodes: [expect.objectContaining({ id: "agent-node-1", title: "林月守铃" })],
      });
      await expect(harness.service.getSnapshot({ bookId: "book-1" })).resolves.not.toMatchObject({
        nodes: expect.arrayContaining([expect.objectContaining({ id: "agent-node-1" })]),
      });

      const rejected = await harness.service.applyChange({
        bookId: "book-1",
        preview,
        decision: "rejected",
        sessionId: "session-1",
      });
      expect(rejected).toMatchObject({ applied: false, reason: "rejected" });
      await expect(harness.service.getSnapshot({ bookId: "book-1" })).resolves.not.toMatchObject({
        nodes: expect.arrayContaining([expect.objectContaining({ id: "agent-node-1" })]),
      });

      const applied = await harness.service.applyChange({
        bookId: "book-1",
        preview,
        decision: "approved",
        sessionId: "session-1",
        confirmationId: "confirm-1",
      });
      expect(applied).toMatchObject({
        applied: true,
        audit: {
          approvedAt: "2026-05-03T00:00:00.000Z",
          sessionId: "session-1",
          confirmationId: "confirm-1",
          targetNodeIds: ["agent-node-1"],
          summary: "补充林月守铃事件",
        },
      });
      await expect(harness.service.getSnapshot({ bookId: "book-1" })).resolves.toMatchObject({
        nodes: expect.arrayContaining([expect.objectContaining({ id: "agent-node-1", title: "林月守铃" })]),
      });
      const persisted = JSON.parse(await readFile(join(harness.root, "books", "book-1", "story", "narrative_line.json"), "utf-8")) as { appliedMutations: Array<{ sessionId: string }> };
      expect(persisted.appliedMutations).toEqual([expect.objectContaining({ sessionId: "session-1" })]);
    } finally {
      harness.storage.close();
    }
  });
});
