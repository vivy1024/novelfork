import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import * as coreModule from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startWorkflowRun } from "../engine/workflows/run-service.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { executeRuntimeDomainTool, type TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

let storage: StorageDatabase;
let testDir: string;
let binding: TrustedRuntimeBookBinding;

function context(sessionId?: string) {
  return {
    runtimeProjectId: "project-1",
    projectRoot: testDir,
    projectType: "novel",
    enabledPluginIds: ["novel"],
    resourceBindings: {},
    ...(sessionId ? { sessionId } : {}),
  } as unknown as Parameters<typeof executeRuntimeDomainTool>[3];
}

async function call(toolName: string, input: Record<string, unknown>, sessionId = "narrator-1") {
  const result = await executeRuntimeDomainTool(toolName, input, binding, context(sessionId));
  if (!result) throw new Error(`${toolName} 没有被分派`);
  return result as { ok: boolean; error?: string; summary?: string; data?: Record<string, unknown> };
}

beforeEach(async () => {
  testDir = join(tmpdir(), `novelfork-workflow-tools-${crypto.randomUUID()}`);
  await mkdir(testDir, { recursive: true });
  await writeFile(join(testDir, "book.json"), JSON.stringify({ id: "book-1", chapterWordCount: 2000 }), "utf8");
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

async function startRun(narratorId = "narrator-1", bookId = "book-1") {
  const result = await startWorkflowRun({
    storage,
    bookId,
    bookRoot: testDir,
    recipeId: "fanqie-xuanhuan-serial",
    chapterNumber: 3,
    narratorId,
  });
  if (!result.ok) throw new Error(result.explanation.what);
  return result.data;
}

describe("工作流工具（叙述者侧）", () => {
  it("没有运行时 get_current_step 返回 none，提交则被拒并说明", async () => {
    const current = await call("workflow.get_current_step", {});
    expect(current.ok).toBe(true);
    expect(current.data).toMatchObject({ runStatus: "none", brief: null });
    const submit = await call("workflow_submit_step_output", { runRevision: 0, kind: "other", payload: { summary: "x" } });
    expect(submit).toMatchObject({ ok: false, error: "no-active-run" });
  });

  it("按会话定位运行，返回进度卡数据与简报；提交后返回下一道工序简报", async () => {
    const run = await startRun();
    const current = await call("workflow_get_current_step", {});
    expect(current.data).toMatchObject({
      runId: run.id,
      runRevision: 0,
      status: "running",
      currentStepId: "step-context",
      totalStepCount: 5,
    });
    expect(String(current.data!.brief)).toContain("当前工序 1/5");

    const submitted = await call("workflow_submit_step_output", { runRevision: 0, kind: "other", payload: { summary: "上下文就绪" } });
    expect(submitted.ok).toBe(true);
    expect(submitted.summary).toContain("生成镜头蓝图");
    expect(submitted.data).toMatchObject({ runRevision: 1, currentStepId: "step-blueprint" });
    expect(String(submitted.data!.brief)).toContain('kind="scene-spec"');
  });

  it("版本过期时拒绝并附上最新视图，模型可据此重新对齐", async () => {
    await startRun();
    const stale = await call("workflow_submit_step_output", { runRevision: 9, kind: "other", payload: { summary: "x" } });
    expect(stale.ok).toBe(false);
    expect(stale.error).toBe("revision-conflict");
    expect(stale.data).toMatchObject({ runRevision: 0, currentStepId: "step-context" });
  });

  it("别的叙述者、别的书的运行都看不到", async () => {
    await startRun("narrator-2");
    expect((await call("workflow_get_current_step", {})).data).toMatchObject({ runStatus: "none" });
    await startRun("narrator-1", "other-book");
    expect((await call("workflow_get_current_step", {})).data).toMatchObject({ runStatus: "none" });
  });

  it("缺少会话标识时拒绝执行", async () => {
    const result = await executeRuntimeDomainTool("workflow_get_current_step", {}, binding, context());
    expect(result).toMatchObject({ ok: false, error: "missing-session" });
  });

  it("报告阻塞需要三段说明；stop 策略下运行进入受阻", async () => {
    await startRun();
    const bad = await call("workflow_report_blocker", { runRevision: 0, what: "缺上下文", why: "", action: "" });
    expect(bad.ok).toBe(false);
    const blocked = await call("workflow_report_blocker", { runRevision: 0, what: "缺上下文", why: "当前聚焦为空", action: "请作者补写当前聚焦" });
    expect(blocked.ok).toBe(true);
    expect(blocked.data).toMatchObject({ runStatus: "blocked", status: "failed" });
    expect(blocked.summary).toContain("等待作者");
  });
});
