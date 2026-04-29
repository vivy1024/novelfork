import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { createWritingModesRouter } from "./writing-modes.js";

const coreMocks = vi.hoisted(() => ({
  buildContinuationPrompt: vi.fn(() => "continuation-prompt"),
  buildExpansionPrompt: vi.fn(() => "expansion-prompt"),
  buildBridgePrompt: vi.fn(() => "bridge-prompt"),
  buildDialoguePrompt: vi.fn(() => "dialogue-prompt"),
  buildVariantPrompts: vi.fn((_i: unknown, _c: unknown, count: number) =>
    Array.from({ length: count }, (_, i) => `variant-prompt-${i}`),
  ),
  buildBranchPrompt: vi.fn(() => "branch-prompt"),
  parseFile: vi.fn(() => ({ chapters: [{ title: "Ch1", content: "text" }] })),
  mergeStyleProfiles: vi.fn(() => ({
    mergedFrom: 1,
    avgSentenceLength: { min: 18, max: 18, mean: 18 },
    vocabularyDiversity: { min: 0.7, max: 0.7, mean: 0.7 },
    dialogueRatio: { min: 0.3, max: 0.3, mean: 0.3 },
  })),
  detectStyleDrift: vi.fn(() => ({
    sentenceLengthDrift: 0.1,
    vocabularyDrift: 0.05,
    overallDrift: 0.075,
    isSignificant: false,
  })),
}));

vi.mock("@vivy1024/novelfork-core", () => ({
  ...coreMocks,
}));

function buildCtx(root = "/tmp/test"): Parameters<typeof createWritingModesRouter>[0] {
  return {
    state: {} as never,
    root,
    broadcast: vi.fn(),
    buildPipelineConfig: vi.fn(),
    getSessionLlm: vi.fn(),
    runStore: {} as never,
    getStartupSummary: vi.fn(() => null),
    setStartupSummary: vi.fn(),
    setStartupRecoveryRunner: vi.fn(),
  };
}

describe("writing-modes router", () => {
  const router = createWritingModesRouter(buildCtx());

  async function request(method: string, path: string, body?: unknown) {
    return requestWithRouter(router, method, path, body);
  }

  async function requestWithRouter(targetRouter: ReturnType<typeof createWritingModesRouter>, method: string, path: string, body?: unknown) {
    const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body) init.body = JSON.stringify(body);
    const res = await targetRouter.request(new Request(`http://localhost${path}`, init));
    const text = await res.text();
    const json = text.trim().startsWith("{") || text.trim().startsWith("[") ? JSON.parse(text) : { error: text };
    return { status: res.status, json: json as Record<string, any> };
  }

  it("POST /api/books/:bookId/inline-write — continuation", async () => {
    const { status, json } = await request("POST", "/api/books/book1/inline-write", {
      mode: "continuation",
      selectedText: "他拔出了剑。",
      beforeText: "前文...",
      chapterNumber: 3,
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      mode: "prompt-preview",
      writingMode: "continuation",
      promptPreview: "continuation-prompt",
      prompt: "continuation-prompt",
    });
  });

  it("POST /api/books/:bookId/inline-write — invalid mode", async () => {
    const { status } = await request("POST", "/api/books/book1/inline-write", { mode: "invalid" });
    expect(status).toBe(400);
  });

  it("POST /api/books/:bookId/dialogue/generate", async () => {
    const { status, json } = await request("POST", "/api/books/book1/dialogue/generate", {
      characters: [{ name: "林月" }],
      scene: "山门前",
      purpose: "争论",
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      mode: "prompt-preview",
      promptPreview: "dialogue-prompt",
      prompt: "dialogue-prompt",
    });
  });

  it("POST /api/books/:bookId/dialogue/generate — no characters", async () => {
    const { status } = await request("POST", "/api/books/book1/dialogue/generate", {
      scene: "山门前",
    });
    expect(status).toBe(400);
  });

  it("POST /api/books/:bookId/variants/generate", async () => {
    const { status, json } = await request("POST", "/api/books/book1/variants/generate", {
      selectedText: "原文",
      count: 3,
    });
    expect(status).toBe(200);
    expect(json.mode).toBe("prompt-preview");
    expect(json.promptPreviews).toHaveLength(3);
    expect(json.prompts).toHaveLength(3);
    expect(json.count).toBe(3);
  });

  it("POST /api/books/:bookId/outline/branch", async () => {
    const { status, json } = await request("POST", "/api/books/book1/outline/branch", {
      outline: [{ id: "n1", title: "开端", summary: "..." }],
      hooks: [],
      state: "当前状态",
      summaries: [],
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      mode: "prompt-preview",
      promptPreview: "branch-prompt",
      prompt: "branch-prompt",
    });
  });

  it("POST /api/books/:bookId/outline/branch/:branchId/expand", async () => {
    const { status, json } = await request("POST", "/api/books/book1/outline/branch/b1/expand", {
      title: "分支一",
      description: "描述",
      chapters: [],
    });
    expect(status).toBe(200);
    expect(json.branchId).toBe("b1");
    expect(json.mode).toBe("prompt-preview");
    expect(json.promptPreview).toContain("大纲分支扩展任务");
  });

  it("POST /api/books/:bookId/writing-modes/apply — writes generated content to a candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-writing-modes-"));
    const testRouter = createWritingModesRouter(buildCtx(root));

    const { status, json } = await requestWithRouter(testRouter, "POST", "/api/books/book1/writing-modes/apply", {
      target: "candidate",
      title: "续写候选",
      content: "他推门而入，风雪随之涌进。",
      sourceMode: "inline-continuation",
      chapterNumber: 3,
      provider: "openai-compatible",
      model: "gpt-5.4",
      runId: "run-candidate-1",
      requestId: "req-candidate-1",
      metadata: { endpoint: "/api/books/book1/inline-write" },
    });

    expect(status).toBe(201);
    expect(json).toMatchObject({ target: "candidate", status: "candidate" });
    expect(json.resourceId).toEqual(expect.any(String));
    expect(json.metadata).toMatchObject({
      bookId: "book1",
      sourceMode: "inline-continuation",
      chapterNumber: 3,
      provider: "openai-compatible",
      model: "gpt-5.4",
      runId: "run-candidate-1",
      requestId: "req-candidate-1",
      endpoint: "/api/books/book1/inline-write",
    });

    const index = JSON.parse(await readFile(join(root, "books", "book1", "generated-candidates", "index.json"), "utf-8")) as Array<{ id: string; title: string; targetChapterId?: string; metadata?: Record<string, unknown> }>;
    expect(index).toMatchObject([{ id: json.resourceId, title: "续写候选", targetChapterId: "3", metadata: expect.objectContaining({ provider: "openai-compatible", model: "gpt-5.4", runId: "run-candidate-1" }) }]);
    await expect(readFile(join(root, "books", "book1", "generated-candidates", `${json.resourceId}.md`), "utf-8"))
      .resolves.toBe("他推门而入，风雪随之涌进。");
  });

  it("POST /api/books/:bookId/writing-modes/apply — writes generated content to a draft", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-writing-modes-"));
    const testRouter = createWritingModesRouter(buildCtx(root));

    const { status, json } = await requestWithRouter(testRouter, "POST", "/api/books/book1/writing-modes/apply", {
      target: "draft",
      title: "对话草稿",
      content: "林月：\"你终于来了。\"",
      sourceMode: "dialogue-generator",
    });

    expect(status).toBe(201);
    expect(json).toMatchObject({ target: "draft", status: "draft" });
    expect(json.resourceId).toEqual(expect.stringMatching(/^draft-/));
    const drafts = JSON.parse(await readFile(join(root, "books", "book1", "drafts", "index.json"), "utf-8")) as Array<{ id: string; title: string; wordCount: number }>;
    expect(drafts).toMatchObject([{ id: json.resourceId, title: "对话草稿", wordCount: 11 }]);
    await expect(readFile(join(root, "books", "book1", "drafts", `${json.resourceId}.md`), "utf-8"))
      .resolves.toBe("林月：\"你终于来了。\"");
  });

  it("POST /api/books/:bookId/writing-modes/apply — converts chapter insert/replace into non-destructive candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-writing-modes-"));
    const chapterDir = join(root, "books", "book1", "chapters");
    await mkdir(chapterDir, { recursive: true });
    await writeFile(join(chapterDir, "0003_old.md"), "旧正文", "utf-8");
    const testRouter = createWritingModesRouter(buildCtx(root));

    const { status, json } = await requestWithRouter(testRouter, "POST", "/api/books/book1/writing-modes/apply", {
      target: "chapter-replace",
      title: "替换候选",
      content: "新正文",
      sourceMode: "variant-compare",
      chapterNumber: 3,
    });

    expect(status).toBe(201);
    expect(json).toMatchObject({ target: "candidate", requestedTarget: "chapter-replace", status: "candidate" });
    expect(json.metadata).toMatchObject({ nonDestructive: true, chapterNumber: 3 });
    await expect(readFile(join(chapterDir, "0003_old.md"), "utf-8")).resolves.toBe("旧正文");
  });

  it("POST /api/books/:bookId/writing-modes/apply — rejects empty generated content", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-writing-modes-"));
    const testRouter = createWritingModesRouter(buildCtx(root));

    const { status, json } = await requestWithRouter(testRouter, "POST", "/api/books/book1/writing-modes/apply", {
      target: "candidate",
      content: "   ",
    });

    expect(status).toBe(400);
    expect(json).toMatchObject({ error: "Generated content is required." });
  });

  it("POST /api/works/import", async () => {
    const { status, json } = await request("POST", "/api/works/import", {
      content: "第一章\n正文",
      filename: "novel.txt",
    });
    expect(status).toBe(200);
    expect(json.chapters).toHaveLength(1);
  });

  it("POST /api/works/import — empty content", async () => {
    const { status } = await request("POST", "/api/works/import", { content: "", filename: "a.txt" });
    expect(status).toBe(400);
  });

  it("GET /api/style/personal-profile", async () => {
    const profiles = JSON.stringify([{ avgSentenceLength: 18, sentenceLengthStdDev: 5, vocabularyDiversity: 0.7, dialogueRatio: 0.3 }]);
    const { status, json } = await request("GET", `/api/style/personal-profile?profiles=${encodeURIComponent(profiles)}`);
    expect(status).toBe(200);
    expect(json.profile.mergedFrom).toBe(1);
  });

  it("GET /api/style/personal-profile — missing param", async () => {
    const { status } = await request("GET", "/api/style/personal-profile");
    expect(status).toBe(400);
  });

  it("POST /api/books/:bookId/style/drift-check", async () => {
    const profile = { avgSentenceLength: 20, sentenceLengthStdDev: 5, vocabularyDiversity: 0.7, dialogueRatio: 0.3 };
    const { status, json } = await request("POST", "/api/books/book1/style/drift-check", {
      current: profile,
      base: profile,
    });
    expect(status).toBe(200);
    expect(json.drift.isSignificant).toBe(false);
  });

  it("POST /api/books/:bookId/style/drift-check — missing profiles", async () => {
    const { status } = await request("POST", "/api/books/book1/style/drift-check", {});
    expect(status).toBe(400);
  });
});
