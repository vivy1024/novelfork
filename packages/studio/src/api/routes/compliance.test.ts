import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createComplianceRouter } from "./compliance.js";

const tempDirs: string[] = [];

async function createRoute() {
  const root = join(tmpdir(), `novelfork-studio-compliance-route-${crypto.randomUUID()}`);
  tempDirs.push(root);
  const bookDir = join(root, "books", "book-1");
  const chaptersDir = join(bookDir, "chapters");
  await mkdir(chaptersDir, { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({
    id: "book-1",
    title: "合规测试书",
    platform: "qidian",
    genre: "xianxia",
    status: "active",
    targetChapters: 10,
    chapterWordCount: 3000,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  }), "utf-8");
  await writeFile(join(chaptersDir, "index.json"), JSON.stringify([
    {
      number: 1,
      title: "第1章 开始",
      status: "approved",
      wordCount: 1204,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
      detectionScore: 0.7,
    },
    {
      number: 2,
      title: "第2章 继续",
      status: "approved",
      wordCount: 1200,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
      detectionScore: 0.1,
    },
  ]), "utf-8");
  await writeFile(join(chaptersDir, "0001_start.md"), `# 第1章 开始\n\n法轮功${"字".repeat(1200)}`, "utf-8");
  await writeFile(join(chaptersDir, "0002_continue.md"), `# 第2章 继续\n\n${"字".repeat(1200)}`, "utf-8");

  const state = {
    bookDir(id: string) {
      return join(root, "books", id);
    },
    async loadBookConfig(id: string) {
      if (id !== "book-1") throw new Error("missing book");
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(join(bookDir, "book.json"), "utf-8"));
      return JSON.parse(raw) as Record<string, unknown>;
    },
    async loadChapterIndex(id: string) {
      if (id !== "book-1") throw new Error("missing book");
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(join(chaptersDir, "index.json"), "utf-8"));
      return JSON.parse(raw) as Array<Record<string, unknown>>;
    },
  };

  const app = createComplianceRouter({
    state,
    root,
    broadcast: vi.fn(),
    buildPipelineConfig: vi.fn(),
    getSessionLlm: vi.fn(),
    runStore: {} as never,
    getStartupSummary: () => null,
    setStartupSummary: vi.fn(),
    setStartupRecoveryRunner: vi.fn(),
  } as never);

  return { app };
}

async function postJson(app: { request: (url: string, init?: RequestInit) => Response | Promise<Response> }, path: string, body: unknown = {}) {
  return app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("compliance routes", () => {
  it("runs book compliance checks and generates disclosure", async () => {
    const { app } = await createRoute();

    const sensitiveResponse = await postJson(app, "/api/books/book-1/compliance/sensitive-scan", { platform: "qidian" });
    expect(sensitiveResponse.status).toBe(200);
    const sensitiveJson = await sensitiveResponse.json() as { result: { totalBlockCount: number; chapters: Array<{ hits: Array<{ word: string }> }> } };
    expect(sensitiveJson.result.totalBlockCount).toBeGreaterThan(0);
    expect(sensitiveJson.result.chapters[0]?.hits[0]?.word).toBe("法轮功");

    const aiRatioResponse = await postJson(app, "/api/books/book-1/compliance/ai-ratio", { platform: "qidian" });
    expect(aiRatioResponse.status).toBe(200);
    const aiRatioJson = await aiRatioResponse.json() as { report: { bookId: string; chapters: Array<{ isAboveThreshold: boolean }> } };
    expect(aiRatioJson.report.bookId).toBe("book-1");
    expect(aiRatioJson.report.chapters[0]?.isAboveThreshold).toBe(true);

    const formatResponse = await postJson(app, "/api/books/book-1/compliance/format-check", { platform: "qidian" });
    expect(formatResponse.status).toBe(200);
    const formatJson = await formatResponse.json() as { result: { warnCount: number; chapterCount: number } };
    expect(formatJson.result.chapterCount).toBe(2);
    expect(formatJson.result.warnCount).toBeGreaterThan(0);

    const readinessResponse = await postJson(app, "/api/books/book-1/compliance/publish-readiness", { platform: "qidian" });
    expect(readinessResponse.status).toBe(200);
    const readinessJson = await readinessResponse.json() as { report: { status: string; totalBlockCount: number; continuity: { status: string; reason: string } } };
    expect(readinessJson.report.status).toBe("blocked");
    expect(readinessJson.report.totalBlockCount).toBeGreaterThan(0);
    expect(readinessJson.report.continuity).toMatchObject({ status: "passed" });

    const disclosureResponse = await postJson(app, "/api/books/book-1/compliance/ai-disclosure", {
      platform: "qidian",
      aiUsageTypes: ["校对"],
      modelNames: ["test-model"],
      humanEditDescription: "人工复核。",
    });
    expect(disclosureResponse.status).toBe(200);
    const disclosureJson = await disclosureResponse.json() as { disclosure: { markdownText: string } };
    expect(disclosureJson.disclosure.markdownText).toContain("test-model");
  });

  it("passes chapter audit continuity facts into publish readiness", async () => {
    const { app } = await createRoute();

    const response = await postJson(app, "/api/books/book-1/compliance/publish-readiness", {
      platform: "generic",
    });

    expect(response.status).toBe(200);
    const json = await response.json() as {
      report: {
        continuity: {
          status: string;
          source?: string;
          checkedChapterCount?: number;
          issueCount?: number;
          score?: number;
        };
      };
    };
    expect(json.report.continuity).toMatchObject({
      status: "passed",
      source: "chapter-audit-issues",
      checkedChapterCount: 2,
      issueCount: 0,
      score: 1,
    });
  });

  it("lists dictionaries and accepts custom dictionary import", async () => {
    const { app } = await createRoute();

    const listResponse = await app.request("http://localhost/api/compliance/dictionaries");
    expect(listResponse.status).toBe(200);
    const listJson = await listResponse.json() as { dictionaries: Array<{ platform: string; wordCount: number }> };
    expect(listJson.dictionaries.some((dictionary) => dictionary.platform === "qidian")).toBe(true);

    const importResponse = await postJson(app, "/api/compliance/dictionaries/import", {
      words: [{ word: "自定义禁词", category: "custom", severity: "warn", platforms: ["generic"], suggestion: "替换" }],
    });
    expect(importResponse.status).toBe(200);
    const importJson = await importResponse.json() as { importedCount: number; dictionary: Array<{ word: string }> };
    expect(importJson.importedCount).toBe(1);
    expect(importJson.dictionary[0]?.word).toBe("自定义禁词");
  });
});
