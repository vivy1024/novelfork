import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionToolExecutionInput } from "../../shared/agent-native-workspace.js";
import { createCandidateToolService, NOVEL_SESSION_TOOL_DEFINITIONS } from "@vivy1024/novelfork-novel-plugin/handlers";
import { createWritingResourceService } from "@vivy1024/novelfork-novel-plugin/engine";
import { closeStorageDatabase, getStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import { createSessionToolExecutor } from "./session-tool-executor.js";
import { clearPluginRegistrations, registerPluginTools } from "./session-tool-registry.js";

const tempDirs: string[] = [];

async function createBookRoot(): Promise<string> {
  const root = join(tmpdir(), `novelfork-candidate-tool-${crypto.randomUUID()}`);
  tempDirs.push(root);
  const bookDir = join(root, "books", "book-1");
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "book-1", title: "凡人修仙录" }), "utf-8");
  await writeFile(join(bookDir, "chapters", "0002-second.md"), "# 第二章\n\n正式正文不能被覆盖。", "utf-8");
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify([
    { number: 2, title: "第二章", status: "approved", wordCount: 12, fileName: "0002-second.md" },
  ], null, 2), "utf-8");
  // 初始化真实 SQLite 存储并跑迁移（候选稿持久化到 writing_resources 表）
  const databasePath = join(root, "novelfork.db");
  const storage = initializeStorageDatabase({ databasePath });
  runStorageMigrations(storage);
  return root;
}

function input(overrides: Partial<SessionToolExecutionInput> = {}): SessionToolExecutionInput {
  return {
    sessionId: "session-1",
    toolName: "candidate.create_chapter",
    permissionMode: "edit",
    input: {
      bookId: "book-1",
      chapterIntent: "写第二章候选稿，推进灵田争夺。",
      chapterNumber: 2,
      title: "第二章候选",
      pgiInstructions: "【本章作者指示（PGI）】\n- conflict-escalate:conflict-1：保持 escalating",
      content: "# 第二章候选\n\n候选正文。",
    },
    ...overrides,
  };
}

beforeEach(() => {
  clearPluginRegistrations();
  registerPluginTools(NOVEL_SESSION_TOOL_DEFINITIONS);
});

afterEach(async () => {
  clearPluginRegistrations();
  closeStorageDatabase();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

describe("candidate.create_chapter session tool", () => {
  it("creates a generated candidate with artifact refs without touching formal chapters", async () => {
    const root = await createBookRoot();
    const executor = createSessionToolExecutor({
      candidateService: createCandidateToolService({
        root,
        now: () => new Date("2026-05-03T06:00:00.000Z"),
        createCandidateId: () => "candidate-1",
      }),
    });

    const result = await executor.execute(input());

    expect(result).toMatchObject({
      ok: true,
      renderer: "candidate.created",
      summary: "已创建第 2 章候选稿：第二章候选。",
      data: {
        status: "candidate",
        candidate: {
          id: "candidate-1",
          bookId: "book-1",
          chapterNumber: 2,
          title: "第二章候选",
          source: "session-tool:candidate.create_chapter",
          metadata: {
            pgiInstructions: expect.stringContaining("本章作者指示"),
            nonDestructive: true,
          },
        },
      },
      artifact: {
        id: "candidate:book-1:candidate-1",
        kind: "candidate",
        renderer: "candidate.created",
        openInCanvas: true,
      },
    });
    // 候选稿现在持久化到 writing_resources 表（不再写文件）
    const resourceService = createWritingResourceService({ storage: getStorageDatabase() });
    const stored = resourceService.getById("candidate-1");
    expect(stored).toMatchObject({ id: "candidate-1", bookId: "book-1", status: "candidate", chapterNumber: 2 });
    expect(stored?.content).toContain("候选正文");
    const candidates = resourceService.list("book-1", { type: "candidate" });
    expect(candidates).toEqual([expect.objectContaining({ id: "candidate-1", status: "candidate" })]);
    // 正式章节文件不被触碰
    await expect(readFile(join(root, "books", "book-1", "chapters", "0002-second.md"), "utf-8"))
      .resolves.toBe("# 第二章\n\n正式正文不能被覆盖。");
  });

  it("requires content because generation happens in the outer Agent", async () => {
    const root = await createBookRoot();
    const executor = createSessionToolExecutor({
      candidateService: createCandidateToolService({ root, now: () => new Date("2026-05-03T06:00:00.000Z"), createCandidateId: () => "candidate-1" }),
    });

    const withoutContent = input({
      input: {
        bookId: "book-1",
        chapterIntent: "写第二章候选稿，推进灵田争夺。",
        chapterNumber: 2,
        title: "第二章候选",
      },
    });
    const result = await executor.execute(withoutContent);

    expect(result).toMatchObject({
      ok: false,
      renderer: "candidate.created",
      error: "invalid-tool-input",
      summary: expect.stringContaining("缺少必填字段 content"),
    });
    // 校验失败时不应写入任何候选稿
    const resourceService = createWritingResourceService({ storage: getStorageDatabase() });
    expect(resourceService.list("book-1", { type: "candidate" })).toEqual([]);
  });
});
