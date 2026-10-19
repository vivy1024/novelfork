/**
 * pipeline.write 的高风险待确认事件门禁（T-13；2026-10-15 起没有本书开关，存在就停写）。
 *
 * 用真实的隔离存储跑管线：只把 listHighRiskPendingNarrativeEvents 换成可控的包装（默认走真实实现），
 * 这样「查询抛错 → 阻断」「正常无高风险事件 → 放行」都真正走到门禁分支，而不是在取存储时就先抛错。
 * 放行只走 NarraFork 的通道：作者经 AskUserQuestion 选择后由 memory.events 的 approve / reject 处理，
 * 这里直接用真实的 memory.events 处理器模拟这一步。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { handleMemoryEvents } from "./lore-memory-boundary-handlers.js";
import { executePipelineWrite, type PipelineToolCallDispatcher } from "./pipeline-write-service.js";

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 拦截说明必须写明 NarraFork 通道里的处理流程，且不许出现「只提醒」「继续参数」这类旧口径。 */
function expectReleaseFlow(text: string | undefined): void {
  const value = text ?? "";
  expect(value).toContain("发生了什么");
  expect(value).toContain("为什么要看");
  expect(value).toContain("建议怎么做");
  expect(value).toContain("AskUserQuestion");
  expect(value).toContain("memory.events");
  expect(value).toContain("approve");
  expect(value).toContain("reject");
  expect(value).toContain("「待确认」面板");
  expect(value).toContain("不要换别的工具绕过");
  expect(value).not.toContain("只提醒");
  expect(value).not.toContain("本书设置");
}

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

  it("没有任何本书设置时，存在高风险待确认事件就停写；模型自己传 continueWithHighRiskPending 也不能放行", async () => {
    seedHighRiskPending(initStorage());

    // 跳过写前预检，直接验证管线自己的门禁：不看本书开关，也不读模型传入的继续参数。
    const result = await executePipelineWrite(
      { bookId: "book-1", skipContextGate: true, sceneSpec, content: CHAPTER_TEXT, continueWithHighRiskPending: true } as never,
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("high-risk-pending");
    expect(result.error).toContain("外人入山者死");
    expectReleaseFlow(result.explanation);
  });

  it("走写前预检时同样拦下，返回码仍是 high-risk-pending（不混成「近章记忆未就绪」）", async () => {
    seedHighRiskPending(initStorage());

    const result = await executePipelineWrite(
      { bookId: "book-1", sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("high-risk-pending");
    expect(result.error).toContain("外人入山者死");
    expectReleaseFlow(result.explanation);
  });

  it("旧书 book.json 残留 blockWriteOnHighRiskPending=false 时正常读取，照样停写", async () => {
    await writeBookJson({ settlement: { blockWriteOnHighRiskPending: false } });
    seedHighRiskPending(initStorage());

    const result = await executePipelineWrite(
      { bookId: "book-1", sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("high-risk-pending");
  });

  it.each(["approve", "reject"] as const)("作者选择后经 memory.events %s 处理掉，再写就放行", async (action) => {
    const storage = initStorage();
    seedHighRiskPending(storage);

    const blocked = await executePipelineWrite(
      { bookId: "book-1", sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );
    expect(blocked.ok).toBe(false);

    const handled = await handleMemoryEvents({ bookId: "book-1", action, eventId: "pending-high", bookRoot }, storage);
    expect(handled.ok).toBe(true);

    const result = await executePipelineWrite(
      { bookId: "book-1", sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );
    if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
    expect(result.ok).toBe(true);
    // 高风险待确认是硬门，不是成功结果里的提醒：highRiskPendingReminder 已从
    // PipelineWriteSuccess 移除（它从来没有被赋值过），断言它不被重新加回来。
    expect(result).not.toHaveProperty("highRiskPendingReminder");
  });

  it("T-29：agent 抽取的高风险草案未经作者确认，下一章写章被拦下", async () => {
    const storage = initStorage();

    // agent 抽取器提交一条高风险草案（世界规则，classifyNarrativeEventRisk 判 high）。
    const created = await handleMemoryEvents({
      bookId: "book-1",
      action: "create",
      source: "agent",
      chapterNumber: 1,
      eventType: "world_fact_introduced",
      subject: "山门",
      predicate: "规则",
      object: "外人入山者死",
      evidenceText: "守门人说外人入山者死。",
      confidence: 0.9,
    }, storage);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const draft = created.data.event as { id: string; status: string };
    expect(draft.status).toBe("pending");

    // 这条草案还没被作者确认，下一章就写不下去。
    const blocked = await executePipelineWrite(
      { bookId: "book-1", sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("high-risk-pending");
    expect(blocked.error).toContain("外人入山者死");

    // 作者批准后放行——证明拦的确实是「未确认」，不是永久堵死。
    const approved = await handleMemoryEvents({ bookId: "book-1", action: "approve", eventId: draft.id, bookRoot }, storage);
    expect(approved.ok).toBe(true);

    const result = await executePipelineWrite(
      { bookId: "book-1", sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );
    if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
    expect(result.ok).toBe(true);
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

  it("book.json 能解析但不是对象时阻断写章，正文一个字节都不动", async () => {
    // 与上一条的区别：`[]` 能被 JSON.parse 解析成功，所以 state.loadBookConfig 不抛错，
    // 「loadBookConfig 抛错 → isBookJsonUnreadable」那条早退路径根本走不到。
    // 只有写前预检的 book-config-unreadable 能发现它——若这个阻断只当软门放过，
    // 管线会拿一份不是配置的东西（没有字数目标、没有平台、没有门禁开关）继续写章。
    await writeFile(join(bookRoot, "book.json"), "[]", "utf-8");
    initStorage();
    const chapterPath = join(bookRoot, "chapters", "卷01", "0001-test.md");
    const before = await readFile(chapterPath, "utf-8");

    const result = await executePipelineWrite(
      { bookId: "book-1", sceneSpec, content: CHAPTER_TEXT },
      { root, bookRoot, logger: silentLogger, dispatchToolCall: settled },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("book-config-unreadable");
    expect(result.error).not.toContain("not found");
    expect(result.explanation ?? "").toContain("发生了什么");
    expect(result.explanation ?? "").toContain("建议怎么做");
    expect(await readFile(chapterPath, "utf-8")).toBe(before);
  });
});
