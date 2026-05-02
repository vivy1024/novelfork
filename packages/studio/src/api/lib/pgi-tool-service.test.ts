import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import {
  createBibleConflictRepository,
  createBibleEventRepository,
  createBookRepository,
  createStorageDatabase,
  runStorageMigrations,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import type { SessionToolExecutionInput } from "../../shared/agent-native-workspace.js";
import { createPGIToolService } from "./pgi-tool-service.js";
import { createSessionToolExecutor } from "./session-tool-executor.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-pgi-tools-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "dynamic",
    currentChapter: 10,
    createdAt: new Date("2026-05-03T00:00:00.000Z"),
    updatedAt: new Date("2026-05-03T00:00:00.000Z"),
  });
  return storage;
}

function input(overrides: Partial<SessionToolExecutionInput> = {}): SessionToolExecutionInput {
  return {
    sessionId: "session-1",
    toolName: "pgi.generate_questions",
    input: { bookId: "book-1", chapterNumber: 10, chapterIntent: "推进灵田争夺", maxQuestions: 5 },
    permissionMode: "read",
    ...overrides,
  };
}

async function seedHeuristicData(storage: StorageDatabase): Promise<void> {
  await createBibleConflictRepository(storage).create({
    id: "conflict-1",
    bookId: "book-1",
    name: "灵田争夺",
    type: "system-scarcity",
    scope: "main",
    priority: 1,
    protagonistSideJson: "[]",
    antagonistSideJson: "[]",
    stakes: "主角会失去修炼资源。",
    rootCauseJson: "{}",
    evolutionPathJson: JSON.stringify([{ chapter: 5, state: "escalating", summary: "冲突升级" }]),
    resolutionState: "escalating",
    resolutionChapter: 20,
    relatedConflictIdsJson: "[]",
    visibilityRuleJson: JSON.stringify({ type: "global" }),
    createdAt: new Date("2026-05-03T00:00:00.000Z"),
    updatedAt: new Date("2026-05-03T00:00:00.000Z"),
  });
  await createBibleEventRepository(storage).create({
    id: "event-1",
    bookId: "book-1",
    name: "师父玉符",
    eventType: "foreshadow",
    chapterStart: 3,
    chapterEnd: 11,
    summary: "玉符将在中段回收。",
    relatedCharacterIdsJson: "[]",
    visibilityRuleJson: JSON.stringify({ type: "tracked" }),
    foreshadowState: "buried",
    createdAt: new Date("2026-05-03T00:00:00.000Z"),
    updatedAt: new Date("2026-05-03T00:00:00.000Z"),
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

describe("PGI session tools", () => {
  it("generates pre-generation questions with heuristic reasons for escalating conflicts and due foreshadows", async () => {
    const storage = await createStorage();
    try {
      await seedHeuristicData(storage);
      const executor = createSessionToolExecutor({ pgiService: createPGIToolService({ storage }) });

      const result = await executor.execute(input());

      expect(result).toMatchObject({
        ok: true,
        renderer: "pgi.questions",
        summary: "已生成 2 个生成前追问。",
        data: {
          status: "available",
          bookId: "book-1",
          chapterNumber: 10,
          chapterIntent: "推进灵田争夺",
          heuristicsTriggered: ["conflict-escalating", "foreshadow-due"],
          questions: [
            expect.objectContaining({ id: "conflict-escalate:conflict-1", reason: expect.stringContaining("escalating 矛盾"), source: "pgi" }),
            expect.objectContaining({ id: "foreshadow-payoff:event-1", reason: expect.stringContaining("临近回收伏笔"), source: "pgi" }),
          ],
        },
      });
    } finally {
      storage.close();
    }
  });

  it("returns a no-questions PGI audit state instead of fake prompts when no heuristic fires", async () => {
    const storage = await createStorage();
    try {
      const executor = createSessionToolExecutor({ pgiService: createPGIToolService({ storage }) });

      const result = await executor.execute(input({ input: { bookId: "book-1", chapterNumber: 1, maxQuestions: 5 } }));

      expect(result).toMatchObject({
        ok: true,
        renderer: "pgi.questions",
        summary: "暂无需要澄清的生成前追问。",
        data: { status: "empty", questions: [], heuristicsTriggered: [] },
        pgi: { used: false, skippedReason: "no-questions", questions: [], heuristicsTriggered: [] },
      });
    } finally {
      storage.close();
    }
  });

  it("records answers and exposes PGI metadata for session messages and candidate metadata", async () => {
    const storage = await createStorage();
    try {
      const executor = createSessionToolExecutor({ pgiService: createPGIToolService({ storage }) });

      const result = await executor.execute(input({
        toolName: "pgi.record_answers",
        permissionMode: "edit",
        input: {
          bookId: "book-1",
          sessionId: "session-1",
          questions: [{ id: "conflict-escalate:conflict-1", prompt: "本章要推到 climax 吗？", reason: "检测到 escalating 矛盾" }],
          answers: [{ questionId: "conflict-escalate:conflict-1", answer: "保持 escalating，但增加资源代价" }],
        },
      }));

      expect(result).toMatchObject({
        ok: true,
        renderer: "pgi.answers",
        summary: "已记录 1 条 PGI 回答。",
        pgi: {
          used: true,
          answers: { "conflict-escalate:conflict-1": "保持 escalating，但增加资源代价" },
          questions: [expect.objectContaining({ id: "conflict-escalate:conflict-1", reason: "检测到 escalating 矛盾" })],
        },
        data: {
          status: "recorded",
          candidateMetadataPatch: {
            pgi: {
              used: true,
              answers: { "conflict-escalate:conflict-1": "保持 escalating，但增加资源代价" },
            },
          },
        },
      });
    } finally {
      storage.close();
    }
  });

  it("records skipped PGI and formats answers as writer-ready instructions", async () => {
    const storage = await createStorage();
    try {
      const executor = createSessionToolExecutor({ pgiService: createPGIToolService({ storage }) });

      const skipped = await executor.execute(input({
        toolName: "pgi.record_answers",
        permissionMode: "edit",
        input: { bookId: "book-1", sessionId: "session-1", skippedReason: "user-skipped", answers: [] },
      }));
      const formatted = await executor.execute(input({
        toolName: "pgi.format_answers_for_prompt",
        input: {
          bookId: "book-1",
          answers: [{ questionId: "conflict-escalate:conflict-1", answer: "保持 escalating，但本章给出一次小胜" }],
        },
      }));

      expect(skipped).toMatchObject({
        ok: true,
        renderer: "pgi.answers",
        summary: "已记录 PGI 跳过状态：user-skipped。",
        pgi: { used: false, skippedReason: "user-skipped" },
        data: { status: "skipped", candidateMetadataPatch: { pgi: { used: false, skippedReason: "user-skipped" } } },
      });
      expect(formatted).toMatchObject({
        ok: true,
        renderer: "pgi.promptInstructions",
        summary: "已格式化 PGI 作者指示。",
        data: {
          status: "available",
          instructions: expect.stringContaining("【本章作者指示（PGI）】"),
        },
      });
      expect((formatted.data as { instructions: string }).instructions).toContain("保持 escalating，但本章给出一次小胜");
    } finally {
      storage.close();
    }
  });
});
