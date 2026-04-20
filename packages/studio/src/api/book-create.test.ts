import { describe, expect, it, vi } from "vitest";
import {
  buildStudioBookConfig,
  buildStudioProjectInitRecord,
  normalizeStudioPlatform,
  normalizeStudioProjectInit,
  suggestStudioWorktreeName,
  waitForStudioBookReady,
} from "./book-create";

describe("normalizeStudioPlatform", () => {
  it("keeps supported chinese platform ids and folds unsupported values to other", () => {
    expect(normalizeStudioPlatform("tomato")).toBe("tomato");
    expect(normalizeStudioPlatform("qidian")).toBe("qidian");
    expect(normalizeStudioPlatform("feilu")).toBe("feilu");
    expect(normalizeStudioPlatform("royal-road")).toBe("other");
    expect(normalizeStudioPlatform(undefined)).toBe("other");
  });
});

describe("suggestStudioWorktreeName", () => {
  it("derives a stable worktree placeholder from the title", () => {
    expect(suggestStudioWorktreeName("测试书")).toBe("draft-测试书");
    expect(suggestStudioWorktreeName("My New Book!!!")).toBe("draft-my-new-book");
    expect(suggestStudioWorktreeName("")).toBe("draft-main");
  });
});

describe("normalizeStudioProjectInit", () => {
  it("fills project creation defaults for the first-round workflow", () => {
    expect(normalizeStudioProjectInit(undefined, "测试书")).toEqual({
      repositorySource: "new",
      workflowMode: "outline-first",
      templatePreset: "genre-default",
      gitBranch: "main",
      worktreeName: "draft-测试书",
    });
  });

  it("keeps only the repo fields relevant to the selected source", () => {
    expect(normalizeStudioProjectInit({
      repositorySource: "clone",
      workflowMode: "draft-first",
      templatePreset: "web-serial",
      repositoryPath: " D:/novels ",
      cloneUrl: " https://example.com/repo.git ",
      gitBranch: " feature/story ",
      worktreeName: " writer-room ",
    }, "Clone Book")).toEqual({
      repositorySource: "clone",
      workflowMode: "draft-first",
      templatePreset: "web-serial",
      cloneUrl: "https://example.com/repo.git",
      gitBranch: "feature/story",
      worktreeName: "writer-room",
    });
  });
});

describe("buildStudioBookConfig", () => {
  it("preserves supported platform selections from studio create requests", () => {
    const config = buildStudioBookConfig(
      {
        title: "测试书",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        chapterWordCount: 2500,
        targetChapters: 120,
      },
      "2026-03-30T00:00:00.000Z",
    );

    expect(config).toMatchObject({
      title: "测试书",
      genre: "xuanhuan",
      platform: "qidian",
      language: "zh",
      chapterWordCount: 2500,
      targetChapters: 120,
    });
  });

  it("normalizes unsupported platform ids to other for storage", () => {
    const config = buildStudioBookConfig(
      {
        title: "English Book",
        genre: "other",
        platform: "royal-road",
        language: "en",
      },
      "2026-03-30T00:00:00.000Z",
    );

    expect(config.platform).toBe("other");
    expect(config.language).toBe("en");
    expect(config.id).toBe("english-book");
  });
});

describe("buildStudioProjectInitRecord", () => {
  it("builds a persisted workflow init record from create payloads", () => {
    const record = buildStudioProjectInitRecord(
      {
        title: "测试书",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        projectInit: {
          repositorySource: "existing",
          repositoryPath: " D:/DESKTOP/openclaw ",
          workflowMode: "serial-ops",
          templatePreset: "web-serial",
          gitBranch: " main ",
          worktreeName: " drafting-room ",
        },
      },
      "2026-03-30T00:00:00.000Z",
    );

    expect(record).toEqual({
      title: "测试书",
      genre: "xuanhuan",
      platform: "qidian",
      language: "zh",
      repositorySource: "existing",
      repositoryPath: "D:/DESKTOP/openclaw",
      workflowMode: "serial-ops",
      templatePreset: "web-serial",
      gitBranch: "main",
      worktreeName: "drafting-room",
      createdAt: "2026-03-30T00:00:00.000Z",
    });
  });
});

describe("waitForStudioBookReady", () => {
  it("retries until the created book becomes readable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Book not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        book: { id: "new-book" },
        chapters: [],
        nextChapter: 1,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const wait = vi.fn(async () => {});

    const result = await waitForStudioBookReady("new-book", {
      fetchImpl,
      wait,
      maxAttempts: 2,
      retryDelayMs: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      book: { id: "new-book" },
      nextChapter: 1,
    });
  });

  it("throws a clear error when the book never becomes readable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Book not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(waitForStudioBookReady("missing-book", {
      fetchImpl,
      wait: async () => {},
      maxAttempts: 2,
      retryDelayMs: 1,
    })).rejects.toThrow('Book "missing-book" was not ready after 2 attempts.');
  });
});
