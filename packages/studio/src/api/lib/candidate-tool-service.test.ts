import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import type { SessionToolExecutionInput } from "../../shared/agent-native-workspace.js";
import { createCandidateToolService } from "./candidate-tool-service.js";
import { createSessionToolExecutor } from "./session-tool-executor.js";

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
      guidedPlanId: "guided-state-1",
    },
    ...overrides,
  };
}

afterEach(async () => {
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
        generateContent: async ({ chapterIntent, pgiInstructions }) => `${chapterIntent}\n\n${pgiInstructions}\n\n候选正文。`,
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
            guidedPlanId: "guided-state-1",
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
    await expect(readFile(join(root, "books", "book-1", "generated-candidates", "candidate-1.md"), "utf-8"))
      .resolves.toContain("候选正文");
    const index = JSON.parse(await readFile(join(root, "books", "book-1", "generated-candidates", "index.json"), "utf-8")) as Array<Record<string, unknown>>;
    expect(index).toEqual([expect.objectContaining({ id: "candidate-1", targetChapterId: "2", status: "candidate" })]);
    await expect(readFile(join(root, "books", "book-1", "chapters", "0002-second.md"), "utf-8"))
      .resolves.toBe("# 第二章\n\n正式正文不能被覆盖。");
  });

  it("falls back to prompt preview when no real generation provider is configured", async () => {
    const root = await createBookRoot();
    const executor = createSessionToolExecutor({
      candidateService: createCandidateToolService({ root, now: () => new Date("2026-05-03T06:00:00.000Z"), createCandidateId: () => "candidate-1" }),
    });

    const result = await executor.execute(input());

    expect(result).toMatchObject({
      ok: false,
      renderer: "candidate.created",
      error: "unsupported-model",
      summary: "候选稿生成需要配置支持模型。",
      data: {
        status: "unsupported",
        promptPreview: expect.stringContaining("写第二章候选稿"),
      },
    });
    await expect(readFile(join(root, "books", "book-1", "generated-candidates", "index.json"), "utf-8")).rejects.toThrow();
  });
});
