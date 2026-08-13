/**
 * 章后结算工具化的**行为**契约（任务 B）。
 *
 * pipeline-write-service.test.ts 里的源码断言只能证明代码这么写；这里证明运行时真的这么跑：
 * 1. 正文落盘成功后，管线确实发起一次 memory.settle_chapter 工具调用（面板可见的那一次）；
 * 2. 该工具调用发生在正文落盘**之后** —— 用调用时刻能否读到已落盘正文来证明，
 *    比源码里的字符串位置断言强：它排除了「代码顺序对、运行时顺序错」的情况；
 * 3. 结算失败时正文仍然保留，pipeline.write 仍然 ok，只在 settlementError 里如实报告。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeStorageDatabase,
  initializeStorageDatabase,
  runStorageMigrations,
} from "@vivy1024/novelfork-core";
import { afterEach, describe, expect, it } from "vitest";

import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { executePipelineWrite, type PipelineToolCallDispatcher } from "./pipeline-write-service.js";
import { handleChapterRead } from "./chapter-read.js";
import { SETTLE_CHAPTER_TOOL_NAME } from "./memory-settle-chapter.js";

const roots: string[] = [];

afterEach(async () => {
  closeStorageDatabase();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * 带 【地点】 标记行：mock LLM 抽取器靠这类标记识别事件草案（与 memory-settle-range
 * 的测试同一约定）。没有标记时结算仍会 completed，但抽取数为 0，就看不出「结算真的
 * 写了记忆」还是「空跑」。
 */
const CHAPTER_TEXT = `【地点】林舟抵达山门石阶。\n${"林舟沿石阶向上，青铜铃在风里发出清响。".repeat(150)}`;

/** mock LLM 抽取器：把【地点】标记翻译成事件草案（结算只接受 LLM 抽取）。 */
function markerExtractor(content: string) {
  return async () => {
    const drafts: Array<Record<string, unknown>> = [];
    for (const line of content.split("\n")) {
      const match = line.trim().match(/^【地点】(.+?)(?:抵达|来到|进入|到达)(.+)$/u);
      if (match) {
        drafts.push({
          eventType: "location_changed",
          subject: match[1]!.trim(),
          predicate: "抵达",
          object: match[2]!.trim().replace(/[。，].*$/u, ""),
          evidenceText: line.trim(),
          confidence: 0.9,
          source: "settle",
        });
      }
    }
    return drafts;
  };
}

const sceneSpec = {
  chapter: 4,
  title: "铃声之后",
  wordTarget: 3000,
  scenes: [{
    characters: ["林舟"],
    location: "山门石阶",
    conflict: "守门人阻止林舟入山",
    mood: "紧张",
    outcome: "林舟取得试炼资格",
    hooks_used: [],
    hooks_planted: [],
  }],
  constraints: [],
};

async function createBook(): Promise<{ projectRoot: string; bookRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "novelfork-settle-dispatch-"));
  roots.push(projectRoot);
  const bookRoot = join(projectRoot, "books", "trusted");
  const volume = join(bookRoot, "chapters", "卷01");
  await mkdir(volume, { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({
    id: "trusted",
    title: "Book trusted",
    platform: "other",
    genre: "fantasy",
    status: "active",
    targetChapters: 100,
    chapterWordCount: 3000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }), "utf8");
  await writeFile(join(volume, "0001-test.md"), "旧正文。".repeat(800), "utf8");
  await writeFile(join(bookRoot, "chapters", "index.json"), JSON.stringify([{
    number: 1,
    title: "第一章",
    fileName: "卷01/0001-test.md",
    wordCount: 3200,
    status: "accepted",
  }]), "utf8");
  return { projectRoot, bookRoot };
}

/** 近章记忆种子：否则 write.preflight 会以 empty-recent-progress 挡在落盘之前。 */
function seedRecentProgress(storage: ReturnType<typeof initializeStorageDatabase>): void {
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (
      id, book_id, chapter_number, event_type, subject, predicate, object,
      evidence_text, confidence, source, status, risk_level, created_at, applied_at
    ) VALUES (
      'dispatch-seed', 'trusted', 1, 'timeline_advanced', '林舟', '抵达', '山门',
      '林舟抵达山门。', 0.9, 'settle', 'applied', 'low',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z'
    )
  `).run();
}

describe("pipeline.write 把章后结算发起为显式工具调用", () => {
  it("落盘成功后发起 memory.settle_chapter，且发起时正文已可读（顺序保证）", async () => {
    const { projectRoot, bookRoot } = await createBook();
    const storage = initializeStorageDatabase({ databasePath: join(projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    seedRecentProgress(storage);

    const calls: { toolName: string; input: Record<string, unknown>; chapterWasPersisted: boolean }[] = [];
    const dispatchToolCall: PipelineToolCallDispatcher = async ({ toolName, input }) => {
      // 结算被发起的**那一刻**去读正文：读得到即证明落盘已经完成。
      const read = await handleChapterRead({ bookId: "trusted", chapterNumber: 4 }, undefined, { bookRoot, storage });
      calls.push({
        toolName,
        input: input as Record<string, unknown>,
        chapterWasPersisted: read.ok && Boolean(read.data?.content?.includes("青铜铃")),
      });
      return { ok: true, summary: "章后结算完成。", data: { settlement: { status: "completed", chapterNumber: 4 } } };
    };

    const result = await executePipelineWrite(
      { bookId: "trusted", sceneSpec, content: CHAPTER_TEXT },
      { root: projectRoot, bookRoot, dispatchToolCall },
    );

    expect(result.ok).toBe(true);
    // 恰好一次结算调用，工具名正确。
    expect(calls).toHaveLength(1);
    expect(calls[0]?.toolName).toBe(SETTLE_CHAPTER_TOOL_NAME);
    // 顺序保证：结算发起时正文已经落盘。
    expect(calls[0]?.chapterWasPersisted).toBe(true);
    // 结算入参只带领域字段，书籍身份由可信绑定注入，不经模型/管线转手。
    expect(calls[0]?.input).toMatchObject({ chapterNumber: 4 });
    expect(calls[0]?.input.bookId).toBeUndefined();
    expect(calls[0]?.input.bookRoot).toBeUndefined();
    expect(calls[0]?.input.content).toBeUndefined();

    if (result.ok) {
      expect(result.settlementDispatch).toMatchObject({
        toolName: SETTLE_CHAPTER_TOOL_NAME,
        ok: true,
        dispatched: "tool-call",
      });
      expect(result.settlementError).toBeUndefined();
    }
  });

  it("结算工具调用失败时保留正文，pipeline.write 仍然成功并如实报告可重试", async () => {
    const { projectRoot, bookRoot } = await createBook();
    const storage = initializeStorageDatabase({ databasePath: join(projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    seedRecentProgress(storage);

    const dispatchToolCall: PipelineToolCallDispatcher = async () => ({
      ok: false,
      error: "settle-chapter-failed",
      summary: "抽取器不可用。",
    });

    const result = await executePipelineWrite(
      { bookId: "trusted", sceneSpec, content: CHAPTER_TEXT },
      { root: projectRoot, bookRoot, dispatchToolCall },
    );

    // 结算失败绝不能丢正文，也不能把整次写章判失败。
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settlementDispatch).toMatchObject({ ok: false, toolName: SETTLE_CHAPTER_TOOL_NAME });
      expect(result.settlementError).toContain("正文已保存");
      expect(result.settlementError).toContain(SETTLE_CHAPTER_TOOL_NAME);
      expect(result.settlementError).toContain("重试不会丢稿");
    }

    // 正文确实还在，且能读回来。
    const read = await handleChapterRead({ bookId: "trusted", chapterNumber: 4 }, undefined, { bookRoot, storage });
    expect(read.ok).toBe(true);
    expect(read.data?.content).toContain("青铜铃");
  });

  it("结算 dispatcher 抛异常也不影响已保存的正文", async () => {
    const { projectRoot, bookRoot } = await createBook();
    const storage = initializeStorageDatabase({ databasePath: join(projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    seedRecentProgress(storage);

    const dispatchToolCall: PipelineToolCallDispatcher = async () => {
      throw new Error("runtime tool bus down");
    };

    const result = await executePipelineWrite(
      { bookId: "trusted", sceneSpec, content: CHAPTER_TEXT },
      { root: projectRoot, bookRoot, dispatchToolCall },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settlementDispatch?.ok).toBe(false);
      expect(result.settlementError).toContain("runtime tool bus down");
    }
    const read = await handleChapterRead({ bookId: "trusted", chapterNumber: 4 }, undefined, { bookRoot, storage });
    expect(read.ok).toBe(true);
  });

  it("没有宿主 dispatcher 时退化为进程内结算，写章闭环不断且结算仍然发生", async () => {
    const { projectRoot, bookRoot } = await createBook();
    const storage = initializeStorageDatabase({ databasePath: join(projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    seedRecentProgress(storage);

    const result = await executePipelineWrite(
      { bookId: "trusted", sceneSpec, content: CHAPTER_TEXT },
      { root: projectRoot, bookRoot, llmExtractor: markerExtractor(CHAPTER_TEXT) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settlementDispatch).toMatchObject({
        toolName: SETTLE_CHAPTER_TOOL_NAME,
        ok: true,
        dispatched: "inline-fallback",
      });
      expect(result.narrativeSettlement?.status).toBe("completed");
    }

    // 回退路径同样真实写入叙事记忆，不是空跑。
    const settled = storage.sqlite
      .prepare("SELECT COUNT(*) AS c FROM narrative_event WHERE book_id = ? AND chapter_number = ?")
      .get("trusted", 4) as { c: number };
    expect(settled.c).toBeGreaterThan(0);

    // 正文落盘是结算的前置条件，二者都成立。
    const index = JSON.parse(await readFile(join(bookRoot, "chapters", "index.json"), "utf8")) as { number: number }[];
    expect(index.map((entry) => entry.number)).toContain(4);
  });
});
