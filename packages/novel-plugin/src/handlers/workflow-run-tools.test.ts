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
    expect(String(current.data!.brief)).toContain("当前工序（共 5 道）");
    expect(String(current.data!.brief)).toContain("▶ 工序 1：装配上下文与前置预检");

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

/** 宿主解析出的委派身份：子代理会话 + 领导者 + 模板（不来自模型输入）。 */
async function callAsSubagent(toolName: string, input: Record<string, unknown>, template: string, leader = "narrator-1") {
  const ctx = { ...context("sub-1"), delegatedBy: { narratorId: leader, template } } as Parameters<typeof executeRuntimeDomainTool>[3];
  const result = await executeRuntimeDomainTool(toolName, input, binding, ctx);
  if (!result) throw new Error(`${toolName} 没有被分派`);
  return result as { ok: boolean; error?: string; summary?: string; data?: Record<string, unknown> };
}

describe("工作流工具（内置子代理侧）", () => {
  const sceneSpec = {
    chapter: 3,
    title: "第三章",
    wordTarget: 2000,
    scenes: [{ characters: ["林舟"], location: "旧码头", conflict: "交货被截", mood: "紧", outcome: "货丢了", hooks_used: [], hooks_planted: [] }],
    constraints: [],
  };

  async function toDraft() {
    let run = await startRun();
    await call("workflow_submit_step_output", { runRevision: run.state.revision, kind: "other", payload: { summary: "ok" } });
    const current = await call("workflow_get_current_step", {});
    await call("workflow_submit_step_output", { runRevision: current.data!.runRevision, kind: "scene-spec", payload: { sceneSpec } });
    run = (await import("../engine/workflows/run-store.js")).getActiveWorkflowRunForNarrator(storage, "narrator-1")!;
    expect(run.state.currentStepId).toBe("step-draft");
    return run;
  }

  it("模板对应当前工序：可提交，返回只有摘要与候选 id，不回正文", async () => {
    const run = await toDraft();
    const view = await callAsSubagent("workflow_get_current_step", {}, "nf-writer");
    expect(view.data).toMatchObject({ template: "nf-writer", assignedSteps: [{ stepId: "step-draft", kind: "prose" }] });
    // 子代理取得上游蓝图原文
    expect(JSON.stringify(view.data!.upstream)).toContain("旧码头");
    expect(String(view.data!.brief)).toContain('stepId="step-draft"');

    const submitted = await callAsSubagent("workflow_submit_step_output", {
      runRevision: run.state.revision, stepId: "step-draft", kind: "prose", payload: { title: "截货", content: "林舟看着货船沉下去。" },
    }, "nf-writer");
    expect(submitted.ok).toBe(true);
    expect(submitted.data!.candidateId).toMatch(/.+/);
    expect(JSON.stringify(submitted)).not.toContain("林舟看着货船沉下去");
    // 领导者侧：运行推进到审校，正文仍是待定候选
    const leader = await call("workflow_get_current_step", {});
    expect(leader.data).toMatchObject({ currentStepId: "step-adversarial-audit" });
  });

  it("模板与当前工序不对应：拒绝提交并说明", async () => {
    const run = await toDraft();
    const wrongTemplate = await callAsSubagent("workflow_submit_step_output", {
      runRevision: run.state.revision, kind: "prose", payload: { content: "x" },
    }, "nf-continuity-auditor");
    expect(wrongTemplate).toMatchObject({ ok: false, error: "step-not-delegated" });
    const wrongStep = await callAsSubagent("workflow_submit_step_output", {
      runRevision: run.state.revision, stepId: "step-adversarial-audit", kind: "audit", payload: { passed: true, summary: "x" },
    }, "nf-writer");
    expect(wrongStep).toMatchObject({ ok: false, error: "step-not-delegated" });
  });

  it("领导者在别的书上的运行：子代理看不到", async () => {
    await startRun("narrator-1", "other-book");
    const view = await callAsSubagent("workflow_get_current_step", {}, "nf-writer");
    expect(view.data).toMatchObject({ runStatus: "none" });
  });

  it("审校子代理提交不通过：运行自动打回写正文", async () => {
    let run = await toDraft();
    await callAsSubagent("workflow_submit_step_output", {
      runRevision: run.state.revision, kind: "prose", payload: { content: "第一稿。" },
    }, "nf-writer");
    run = (await import("../engine/workflows/run-store.js")).getActiveWorkflowRunForNarrator(storage, "narrator-1")!;
    const audit = await callAsSubagent("workflow_submit_step_output", {
      runRevision: run.state.revision, kind: "audit", payload: { passed: false, summary: "冲突没升级", issues: [{ severity: "error", description: "第二场太平" }] },
    }, "nf-continuity-auditor");
    expect(audit.ok).toBe(true);
    const leader = await call("workflow_get_current_step", {});
    expect(leader.data).toMatchObject({ currentStepId: "step-draft" });
    expect(String(leader.data!.brief)).toContain("第二场太平");
    // 被打回后返修子代理也能接写正文这道工序
    const reviser = await callAsSubagent("workflow_get_current_step", {}, "nf-reviser");
    expect(reviser.data).toMatchObject({ assignedSteps: [{ stepId: "step-draft" }] });
  });
});

describe("pipeline.write 引用已确认候选落盘", () => {
  it("没有运行或正文未确认时拒绝，不会落盘", async () => {
    const none = await call("pipeline_write", { fromWorkflowRun: true });
    expect(none).toMatchObject({ ok: false, error: "no-active-run" });
    await startRun();
    const notApproved = await call("pipeline_write", { fromWorkflowRun: true });
    expect(notApproved).toMatchObject({ ok: false, error: "prose-not-approved" });
  });
});
