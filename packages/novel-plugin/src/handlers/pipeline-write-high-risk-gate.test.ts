/**
 * pipeline.write 的高风险待确认事件门禁（T-13）。
 *
 * 用真实的隔离存储跑管线：只把 listHighRiskPendingNarrativeEvents 换成可控的包装（默认走真实实现），
 * 这样「查询抛错 → 阻断」「正常无高风险事件 → 放行」都真正走到门禁分支，而不是在取存储时就先抛错。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ failQuery: false, calls: 0 }));

vi.mock("../engine/narrative-memory/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine/narrative-memory/storage.js")>();
  return {
    ...actual,
    listHighRiskPendingNarrativeEvents: (...args: Parameters<typeof actual.listHighRiskPendingNarrativeEvents>) => {
      gate.calls += 1;
      if (gate.failQuery) throw new Error("simulated high-risk query failure");
      return actual.listHighRiskPendingNarrativeEvents(...args);
    },
  };
});

import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { executePipelineWrite, type PipelineToolCallDispatcher } from "./pipeline-write-service.js";

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const AUTHOR_ACTION = "请作者在待确认里处理高风险事件后再写";

let root: string;
let bookRoot: string;

const CHAPTER_TEXT = "林舟沿石阶向上，青铜铃在风里发出清响。".repeat(160);

const sceneSpec = {
  chapter: 2,
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

const settled: PipelineToolCallDispatcher = async () => ({
  ok: true,
  summary: "章后结算完成。",
  data: { settlement: { status: "completed", chapterNumber: 2 } },
});

async function writeBookJson(narrativeMemory?: Record<string, unknown>): Promise<void> {
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({
    id: "book-1",
    title: "测试书",
    platform: "other",
    genre: "fantasy",
    status: "active",
    targetChapters: 100,
    chapterWordCount: 3000,
    language: "zh",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(narrativeMemory ? { narrativeMemory } : {}),
  }), "utf-8");
}

/** 初始化隔离存储：第 1 章已有正式稿与近章记忆，写前预检不会以 empty-recent-progress 挡住。 */
function initStorage() {
  const storage = initializeStorageDatabase({ databasePath: join(root, "novelfork.db") });
  runStorageMigrations(storage);
  ensureNarrativeMemorySchema(storage);
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (
      id, book_id, chapter_number, event_type, subject, predicate, object,
      evidence_text, confidence, source, status, risk_level, created_at, applied_at
    ) VALUES (
      'seed-progress', 'book-1', 1, 'timeline_advanced', '林舟', '抵达', '山门',
      '林舟抵达山门。', 0.9, 'settle', 'applied', 'low',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z'
    )
  `).run();
  return storage;
}

function seedHighRiskPending(storage: ReturnType<typeof initializeStorageDatabase>): void {
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (
      id, book_id, chapter_number, event_type, subject, predicate, object,
      evidence_text, confidence, source, status, risk_level, created_at
    ) VALUES (
      'pending-high', 'book-1', 1, 'world_fact_introduced', '山门', '规则', '外人入山者死',
      '守门人说外人入山者死。', 0.6, 'settle', 'pending', 'high', '2026-08-07T00:00:00.000Z'
    )
  `).run();
}

beforeEach(async () => {
  gate.failQuery = false;
  gate.calls = 0;
  root = await mkdtemp(join(tmpdir(), "novelfork-t13-gate-"));
  bookRoot = join(root, "books", "book-1");
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  await writeBookJson();
  await writeFile(join(bookRoot, "chapters", "卷01", "0001-test.md"), "旧正文。".repeat(800), "utf-8");
  await writeFile(join(bookRoot, "chapters", "index.json"), JSON.stringify([{
    number: 1, title: "第一章", fileName: "卷01/0001-test.md", wordCount: 3200, status: "accepted",
  }]), "utf-8");
});

afterEach(async () => {
  closeStorageDatabase();
  await rm(root, { recursive: true, force: true });
});

describe("pipeline.write 高风险待确认门禁（T-13）", () => {
  it("高风险待确认查询本身抛错时阻断写章（fail-closed），且确实走到了门禁分支", async () => {
    initStorage();
    gate.failQuery = true;

    const result = await executePipelineWrite(
      { bookId: "book-1", skipContextGate: true, sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );

    expect(gate.calls).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("high-risk-pending");
    expect(result.error).toContain("simulated high-risk query failure");
    expect(result.explanation ?? "").toContain("发生了什么");
    expect(result.explanation ?? "").toContain("建议怎么做");
  });

  it("正常情况下没有高风险待确认事件时放行，章节照常保存", async () => {
    initStorage();

    const result = await executePipelineWrite(
      { bookId: "book-1", sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );

    expect(gate.calls).toBeGreaterThan(0);
    if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
    expect(result.ok).toBe(true);
  });

  it("本书设为有高风险待确认就停写时，模型自己传 continueWithHighRiskPending 也不能放行（D1）", async () => {
    await writeBookJson({ settlement: { blockWriteOnHighRiskPending: true } });
    seedHighRiskPending(initStorage());

    // 跳过写前预检，直接验证管线自己的门禁不再读取模型传入的继续参数。
    const result = await executePipelineWrite(
      { bookId: "book-1", skipContextGate: true, sceneSpec, content: CHAPTER_TEXT, continueWithHighRiskPending: true } as never,
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("high-risk-pending");
    expect(result.explanation ?? "").toContain(AUTHOR_ACTION);
    expect(result.error).toContain("外人入山者死");
  });

  it("走写前预检时同样拦下，拦截说明写明需要作者处理", async () => {
    await writeBookJson({ settlement: { blockWriteOnHighRiskPending: true } });
    seedHighRiskPending(initStorage());

    const result = await executePipelineWrite(
      { bookId: "book-1", sceneSpec, content: CHAPTER_TEXT, continueWithHighRiskPending: true } as never,
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("context-not-ready");
    expect(result.explanation ?? "").toContain(AUTHOR_ACTION);
  });

  it("book.json 损坏时返回 book-config-unreadable，不说成书不存在", async () => {
    await writeFile(join(bookRoot, "book.json"), "{ this is not valid json", "utf-8");

    const result = await executePipelineWrite(
      { bookId: "book-1", skipContextGate: true, sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("book-config-unreadable");
    expect(result.error).toContain("无法解析");
    expect(result.error).not.toContain("not found");
    expect(result.explanation ?? "").toContain("发生了什么");
    expect(result.explanation ?? "").toContain("建议怎么做");
  });

  it("book.json 缺失时仍是 book-not-found（对照）", async () => {
    await rm(join(bookRoot, "book.json"), { force: true });

    const result = await executePipelineWrite(
      { bookId: "book-1", skipContextGate: true, sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("book-not-found");
  });
});
