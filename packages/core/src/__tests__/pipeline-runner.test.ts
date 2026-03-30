import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookConfig } from "../models/book.js";

const generateFoundationMock = vi.fn();
const writeFoundationFilesMock = vi.fn();

vi.mock("../agents/architect.js", () => ({
  ArchitectAgent: class {
    constructor(_ctx: unknown) {}

    generateFoundation = generateFoundationMock;
    writeFoundationFiles = writeFoundationFilesMock;
  },
}));

vi.mock("../agents/rules-reader.js", () => ({
  readGenreProfile: vi.fn(async () => ({
    profile: {
      numericalSystem: false,
    },
  })),
}));

describe("PipelineRunner.initBook", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-runner-"));
    await mkdir(join(projectRoot, "books"), { recursive: true });
    generateFoundationMock.mockReset();
    writeFoundationFilesMock.mockReset();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("does not leave a partial book directory behind when foundation generation fails", async () => {
    generateFoundationMock.mockImplementationOnce(() => {
      throw new Error("architect failed");
    });

    const { PipelineRunner } = await import("../pipeline/runner.js");
    const runner = new PipelineRunner({
      client: {} as never,
      model: "test-model",
      projectRoot,
    });

    const book: BookConfig = {
      id: "broken-book",
      title: "Broken Book",
      genre: "xuanhuan",
      platform: "qidian",
      status: "outlining",
      targetChapters: 10,
      chapterWordCount: 3000,
      language: "zh",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await expect(runner.initBook(book)).rejects.toThrow("architect failed");
    expect(generateFoundationMock).toHaveBeenCalledOnce();
    await expect(access(join(projectRoot, "books", book.id))).rejects.toThrow();
  });
});
