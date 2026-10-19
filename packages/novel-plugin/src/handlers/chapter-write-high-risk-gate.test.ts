/**
 * `chapter.write` 的高风险待确认门禁（T-13 / T-29 收口）。
 *
 * 为什么单独写这条：`pipeline.write` 有高风险待确认闸门，而 `chapter.write` 此前没有。
 * 模型的行动路径里两者都能覆盖既有章节正文，于是「被 pipeline 拦下 → 改用 chapter.write
 * 覆盖同一章」是一条真实的绕过路径（系统提示词禁止这么用，但那不是服务端闸门）。
 * 本文件把闸门钉在 `handleChapterWrite` 内，覆盖三种形态：确实存在高风险事件、
 * 读取本身失败（fail-closed）、以及无高风险事件时照常放行（防止闸门过度阻断）。
 *
 * 用真实隔离存储 + 真实事件行，只把高风险查询包一层以便注入「读取抛错」这一情形
 * （与 pipeline-write-high-risk-gate.test.ts 同一手法），这样断言走的是门禁分支本身，
 * 而不是在取存储时就先抛错。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
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
import { handleChapterWrite } from "./chapter-write.js";

let root: string;
let bookRoot: string;
let storage: StorageDatabase;

// 目标 1000 字的硬范围是 728–1272：取 120 次重复 = 1080 字，落在范围内。
const CHAPTER_ONE_OLD = "这是第一章旧正文。".repeat(120);
const CHAPTER_ONE_NEW = "这是第一章新正文。".repeat(120);

function storagePath(): string {
  return join(root, "novelfork.db");
}

async function writeBookJson(): Promise<void> {
  await writeFile(
    join(bookRoot, "book.json"),
    JSON.stringify({ id: "book-1", title: "测试书", chapterWordCount: 1000, language: "zh" }),
    "utf8",
  );
}

async function writeChapterOne(content: string): Promise<void> {
  const fileName = "卷01/0001_第一章.md";
  await writeFile(join(bookRoot, "chapters", fileName), content, "utf8");
  await writeFile(
    join(bookRoot, "chapters", "index.json"),
    JSON.stringify([{ number: 1, title: "第一章", fileName, wordCount: content.length, updatedAt: new Date().toISOString() }], null, 2),
    "utf8",
  );
}

function seedHighRiskPending(): void {
  storage.sqlite
    .prepare(
      `INSERT INTO narrative_event (
        id, book_id, chapter_number, event_type, subject, predicate, object,
        evidence_text, confidence, source, status, risk_level, created_at
      ) VALUES (
        'pending-high', 'book-1', 1, 'world_fact_introduced', '山门', '规则', '外人入山者死',
        '守门人说外人入山者死。', 0.6, 'settle', 'pending', 'high', '2026-08-07T00:00:00.000Z'
      )`,
    )
    .run();
}

/** 拦截说明必须交代 NarraFork 的放行通道，且不许回到「本书设置 / 继续参数」的旧口径。 */
function expectReleaseFlow(text: string | undefined): void {
  const value = text ?? "";
  expect(value).toContain("发生了什么");
  expect(value).toContain("为什么要看");
  expect(value).toContain("建议怎么做");
  expect(value).toContain("memory.events");
  expect(value).toContain("「待确认」面板");
  expect(value).not.toContain("本书设置");
}

beforeEach(async () => {
  gate.failQuery = false;
  gate.calls = 0;
  root = await mkdtemp(join(tmpdir(), "novelfork-chapter-write-gate-"));
  bookRoot = join(root, "books", "book-1");
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  await writeBookJson();
  await writeChapterOne(CHAPTER_ONE_OLD);
  storage = initializeStorageDatabase({ databasePath: storagePath() });
  runStorageMigrations(storage);
  ensureNarrativeMemorySchema(storage);
});

afterEach(async () => {
  closeStorageDatabase();
  await rm(root, { recursive: true, force: true });
});

describe("chapter.write 高风险待确认门禁", () => {
  it("存在高风险待确认事件时拒绝写入，正文原样保留", async () => {
    seedHighRiskPending();

    const result = await handleChapterWrite(
      { bookId: "book-1", chapterNumber: 1, content: CHAPTER_ONE_NEW },
      { bookRoot, storage },
    );

    expect(gate.calls).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("high-risk-pending");
    expect(result.summary).toContain("高风险待确认");
    // 事件正文依据在 explanation 里（summary 只报数量，不列内容）。
    expect(result.explanation).toContain("外人入山者死");
    expectReleaseFlow(result.explanation);

    // 闸门在写入之前：磁盘上的正文必须还是旧的那一版。
    const onDisk = await readFile(join(bookRoot, "chapters", "卷01", "0001_第一章.md"), "utf8");
    expect(onDisk).toBe(CHAPTER_ONE_OLD);
  });

  it("局部改写（purpose: revision）同样被拦下", async () => {
    seedHighRiskPending();

    const result = await handleChapterWrite(
      { bookId: "book-1", chapterNumber: 1, content: CHAPTER_ONE_NEW },
      { bookRoot, storage, purpose: "revision" },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("high-risk-pending");
  });

  it("高风险查询本身抛错时阻断（fail-closed），且不带任何继续参数可绕过", async () => {
    gate.failQuery = true;

    const result = await handleChapterWrite(
      { bookId: "book-1", chapterNumber: 1, content: CHAPTER_ONE_NEW },
      { bookRoot, storage },
    );

    expect(gate.calls).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("high-risk-pending");
    expect(result.summary).toContain("simulated high-risk query failure");
  });

  it("没有高风险待确认事件时照常写入（闸门不得过度阻断）", async () => {
    const result = await handleChapterWrite(
      { bookId: "book-1", chapterNumber: 1, content: CHAPTER_ONE_NEW },
      { bookRoot, storage },
    );

    if (!result.ok) throw new Error(`expected ok, got ${result.error}: ${result.summary}`);
    expect(result.ok).toBe(true);
    const onDisk = await readFile(join(bookRoot, "chapters", "卷01", "0001_第一章.md"), "utf8");
    expect(onDisk).toBe(CHAPTER_ONE_NEW);
  });

  it("已确认（非 pending）的高风险事件不阻断写入", async () => {
    storage.sqlite
      .prepare(
        `INSERT INTO narrative_event (
          id, book_id, chapter_number, event_type, subject, predicate, object,
          evidence_text, confidence, source, status, risk_level, created_at
        ) VALUES (
          'approved-high', 'book-1', 1, 'world_fact_introduced', '山门', '规则', '外人入山者死',
          '守门人说外人入山者死。', 0.6, 'settle', 'confirmed', 'high', '2026-08-07T00:00:00.000Z'
        )`,
      )
      .run();

    const result = await handleChapterWrite(
      { bookId: "book-1", chapterNumber: 1, content: CHAPTER_ONE_NEW },
      { bookRoot, storage },
    );

    if (!result.ok) throw new Error(`expected ok, got ${result.error}: ${result.summary}`);
    expect(result.ok).toBe(true);
  });
});
