import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import * as coreModule from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { executeRuntimeDomainTool, type TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

let storage: StorageDatabase;
let testDir: string;
let binding: TrustedRuntimeBookBinding;

async function start(input: Record<string, unknown>) {
  const context = { runtimeProjectId: "p", projectRoot: testDir, projectType: "novel", enabledPluginIds: ["novel"], resourceBindings: {}, sessionId: "narrator-1" } as unknown as Parameters<typeof executeRuntimeDomainTool>[3];
  return (await executeRuntimeDomainTool("workflow_start_run", input, binding, context)) as { ok: boolean; error?: string; data?: Record<string, unknown> };
}

async function writeBook(extra: Record<string, unknown> = {}) {
  await writeFile(join(testDir, "book.json"), JSON.stringify({ id: "book-1", chapterWordCount: 2000, ...extra }), "utf8");
}

beforeEach(async () => {
  testDir = join(tmpdir(), `novelfork-start-default-${crypto.randomUUID()}`);
  await mkdir(testDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(testDir, "novelfork.db") });
  ensureNarrativeMemorySchema(storage);
  vi.spyOn(coreModule, "getStorageDatabase").mockImplementation(() => storage);
  binding = { bookId: "book-1", root: testDir };
});

afterEach(async () => {
  vi.restoreAllMocks();
  storage.close();
  await rm(testDir, { recursive: true, force: true });
});

describe("workflow_start_run 省略方案时用本书默认工作流", () => {
  it("有默认：按默认方案启动", async () => {
    await writeBook({ defaultWorkflowRecipeId: "zhihu-short-story" });
    const started = await start({ chapterNumber: 1 });
    expect(started.ok).toBe(true);
    const run = storage.sqlite.prepare<{ recipe_id: string }>("SELECT recipe_id FROM workflow_runs").get();
    expect(run?.recipe_id).toBe("zhihu-short-story");
  });

  it("没设默认：拒绝并说明", async () => {
    await writeBook();
    const started = await start({ chapterNumber: 1 });
    expect(started).toMatchObject({ ok: false, error: "default-workflow-missing" });
  });
});
