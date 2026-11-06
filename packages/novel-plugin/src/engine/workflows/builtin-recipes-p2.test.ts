/**
 * 「精修一章」与「大纲推演」两个内置方案：结构、按图推进、落盘与大纲候选的规则。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildDelegatedStepBrief, buildWorkflowRunBrief } from "./run-brief";
import {
  approveWorkflowStep,
  getApprovedProse,
  getWorkflowRunDetail,
  startWorkflowRun,
  submitWorkflowStepOutput,
  validateWorkflowCandidate,
} from "./run-service";
import { getActiveWorkflowRunForNarrator, type WorkflowRunRecord } from "./run-store";
import {
  NOVEL_BUILTIN_WORKFLOWS,
  OUTLINE_FORECAST_RECIPE,
  REFINE_CHAPTER_RECIPE,
} from "./novel-workflows";
import {
  buildStepTemplates,
  createRunState,
  transition,
  writesChapter,
  type WorkflowRunAction,
  type WorkflowRunState,
} from "./run-state-machine";
import { checkWorkflowGraph, stepNodes } from "./workflow-graph";
import { delegatedStepIdsFor } from "../../handlers/workflow-run-tools";

const failNote = { what: "审校未通过", why: "第三段读者会走神", action: "按意见修改" };

function run(recipe: typeof REFINE_CHAPTER_RECIPE) {
  const created = createRunState(recipe);
  if (!created.ok) throw new Error(created.explanation.what);
  let state: WorkflowRunState = created.state;
  return {
    get state() {
      return state;
    },
    status: (stepId: string) => state.steps.find((step) => step.stepId === stepId)!.status,
    apply(action: WorkflowRunAction) {
      const result = transition(recipe, state, action);
      if (!result.ok) throw new Error(`${result.code}: ${result.explanation.what}`);
      state = result.state;
    },
  };
}

describe("新内置方案的结构", () => {
  it.each([REFINE_CHAPTER_RECIPE, OUTLINE_FORECAST_RECIPE])("$id 已发布、结构合法、登记在内置方案里", (recipe) => {
    expect(recipe.status).toBe("published");
    expect(checkWorkflowGraph(recipe)).toEqual([]);
    expect(NOVEL_BUILTIN_WORKFLOWS).toContain(recipe);
  });

  it("所有内置方案的落盘工序失败时都停下（不能跳过）", () => {
    for (const recipe of NOVEL_BUILTIN_WORKFLOWS) {
      for (const node of stepNodes(recipe)) {
        if (writesChapter({ tools: node.tools ?? [] })) expect(node.onFailure, `${recipe.id} / ${node.id}`).toBe("stop");
      }
    }
  });

  it("大纲推演不写正文：没有写正文的工序，也不给落盘工具", () => {
    const steps = buildStepTemplates(OUTLINE_FORECAST_RECIPE);
    expect(steps.some((step) => step.expectedOutput === "prose")).toBe(false);
    expect(steps.some((step) => writesChapter(step))).toBe(false);
    expect(steps.find((step) => step.stepId === "step-outline")).toMatchObject({ expectedOutput: "outline", requiresApproval: true });
  });
});

describe("精修一章：按图推进", () => {
  it("三路审校并行；不通过也不打回，汇合后交返修；返修需作者确认后才进入落盘", () => {
    const r = run(REFINE_CHAPTER_RECIPE);
    r.apply({ type: "submit", stepId: "step-context" });
    expect(["step-reader", "step-style", "step-deai"].map(r.status)).toEqual(["running", "running", "running"]);
    r.apply({ type: "submit", stepId: "step-reader", audit: { passed: false, note: failNote } });
    expect(r.status("step-reader")).toBe("done");
    expect(r.status("step-revise")).toBe("pending");
    r.apply({ type: "submit", stepId: "step-style", audit: { passed: true, note: failNote } });
    r.apply({ type: "submit", stepId: "step-deai", audit: { passed: false, note: failNote } });
    expect(r.status("step-revise")).toBe("running");
    r.apply({ type: "submit", stepId: "step-revise" });
    expect(r.status("step-revise")).toBe("awaiting_approval");
    expect(r.status("step-settlement")).toBe("pending");
    r.apply({ type: "approve", stepId: "step-revise" });
    expect(r.status("step-settlement")).toBe("running");
  });

  it("落盘工序受阻不能跳过", () => {
    const r = run(REFINE_CHAPTER_RECIPE);
    r.apply({ type: "submit", stepId: "step-context" });
    for (const id of ["step-reader", "step-style", "step-deai"]) r.apply({ type: "submit", stepId: id, audit: { passed: true, note: failNote } });
    r.apply({ type: "submit", stepId: "step-revise" });
    r.apply({ type: "approve", stepId: "step-revise" });
    r.apply({ type: "block", stepId: "step-settlement", explanation: failNote });
    expect(r.state.status).toBe("blocked");
    const skipped = transition(REFINE_CHAPTER_RECIPE, r.state, { type: "skip", stepId: "step-settlement" });
    expect(skipped.ok).toBe(false);
  });
});

describe("大纲推演：按图推进", () => {
  it("市场分析做不出来时跳过，不挡大纲推演；大纲候选要作者确认后才进入调整卷纲", () => {
    const r = run(OUTLINE_FORECAST_RECIPE);
    r.apply({ type: "submit", stepId: "step-context" });
    r.apply({ type: "block", stepId: "step-market", explanation: { what: "没有榜单快照", why: "还没抓过榜单", action: "先抓取榜单" } });
    expect(r.status("step-market")).toBe("skipped");
    expect(r.status("step-outline")).toBe("running");
    r.apply({ type: "submit", stepId: "step-outline" });
    expect(r.status("step-outline")).toBe("awaiting_approval");
    expect(r.status("step-apply")).toBe("pending");
    r.apply({ type: "approve", stepId: "step-outline" });
    expect(r.status("step-apply")).toBe("running");
  });
});

describe("大纲候选校验", () => {
  const context = { chapterNumber: 12 };

  it("缺 summary、没有章或章号不是正整数时拒绝，并说明结构", () => {
    for (const payload of [
      { chapters: [{ chapter: 12 }] },
      { summary: "调整", chapters: [] },
      { summary: "调整", chapters: [{ chapter: 12 }, { goal: "缺章号" }] },
      { summary: "调整", chapters: [{ chapter: 0 }] },
    ]) {
      const result = validateWorkflowCandidate("outline", payload, context);
      expect(result.ok, JSON.stringify(payload)).toBe(false);
      if (!result.ok) expect(result.explanation.action).toContain("chapters");
    }
  });

  it("一次推演过多章时拒绝", () => {
    const chapters = Array.from({ length: 31 }, (_, index) => ({ chapter: 12 + index }));
    expect(validateWorkflowCandidate("outline", { summary: "太远", chapters }, context).ok).toBe(false);
  });

  it("合格时按章号排序并给出范围", () => {
    const result = validateWorkflowCandidate("outline", {
      summary: "第 14 章回收黑戒伏笔",
      chapters: [{ chapter: 14, goal: "回收" }, { chapter: 12, goal: "铺垫" }],
      risks: ["与卷纲第二卷节奏冲突", 3],
    }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.validation).toEqual({ chapterCount: 2, fromChapter: 12, toChapter: 14 });
    expect((result.value.payload as { chapters: Array<{ chapter: number }> }).chapters.map((item) => item.chapter)).toEqual([12, 14]);
    expect((result.value.payload as { risks: string[] }).risks).toEqual(["与卷纲第二卷节奏冲突"]);
  });
});

// ─── 服务端：真实迁移链上的运行 ─────────────────────────────────────────────

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function setup(): Promise<{ storage: StorageDatabase; bookRoot: string }> {
  const dir = join(tmpdir(), `novelfork-workflow-p2-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = Date.now();
  storage.sqlite.exec(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-1', '测试书', ${now}, ${now});`);
  return { storage, bookRoot: join(dir, "book") };
}

afterEach(async () => {
  storages.splice(0).forEach((storage) => storage.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function ok<T>(result: { ok: true; data: T } | { ok: false; code: string; explanation: { what: string } }): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.explanation.what}`);
  return result.data;
}

describe("新方案的服务端运行", () => {
  it("大纲推演：kind 必须是 outline（与工序一致），提交后等作者确认，确认不改任何权威源", async () => {
    const { storage, bookRoot } = await setup();
    let current: WorkflowRunRecord = ok(await startWorkflowRun({ storage, bookId: "book-1", bookRoot, recipeId: "outline-forecast", chapterNumber: 12, narratorId: "leader" }));
    const submit = (stepId: string, kind: string, payload: unknown, allowedStepIds?: string[]) =>
      submitWorkflowStepOutput({ storage, narratorId: "leader", runRevision: current.state.revision, stepId, kind, payload, ...(allowedStepIds ? { allowedStepIds } : {}) });
    current = ok(submit("step-context", "other", { summary: "读完卷纲" }));
    expect(delegatedStepIdsFor(current, "nf-market-analyst")).toEqual(["step-market"]);
    current = ok(submit("step-market", "other", { summary: "系统流饱和，宗门经营是空白" }, ["step-market"]));

    expect(delegatedStepIdsFor(current, "nf-outline-planner")).toEqual(["step-outline"]);
    const brief = buildDelegatedStepBrief(current, "nf-outline-planner", ["step-outline"]);
    expect(brief).toContain('kind="outline"');
    // 与现有闸门一致：交错类别被拒
    const mismatch = submit("step-outline", "other", { summary: "x" }, ["step-outline"]);
    expect(mismatch).toMatchObject({ ok: false, code: "kind-mismatch" });
    // 不是分给它的工序被拒
    expect(submit("step-outline", "outline", { summary: "x", chapters: [{ chapter: 12 }] }, ["step-market"])).toMatchObject({ ok: false, code: "step-not-delegated" });
    current = ok(submit("step-outline", "outline", { summary: "13 章回收黑戒", chapters: [{ chapter: 12, goal: "铺垫" }, { chapter: 13, goal: "回收" }] }, ["step-outline"]));
    expect(current.state.status).toBe("awaiting_approval");
    expect(buildWorkflowRunBrief(current)).toContain("大纲候选已提交");

    const scenesBefore = storage.sqlite.prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM narrative_scene`).get()!.count;
    current = ok(approveWorkflowStep({ storage, runId: current.id, expectedRevision: current.state.revision, stepId: "step-outline" }));
    expect(storage.sqlite.prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM narrative_scene`).get()!.count).toBe(scenesBefore);
    const outline = getWorkflowRunDetail(storage, current.id)!.candidates.find((candidate) => candidate.kind === "outline")!;
    expect(outline.decision).toBe("approved");
    expect(outline.committedRef ?? null).toBeNull();
    expect(current.state.steps.find((step) => step.stepId === "step-apply")!.status).toBe("running");
    expect(buildWorkflowRunBrief(current)).toContain("outline_volume");
  });

  it("精修一章：三份审校各归其主，返修正文经作者确认后成为落盘版本", async () => {
    const { storage, bookRoot } = await setup();
    let current: WorkflowRunRecord = ok(await startWorkflowRun({ storage, bookId: "book-1", bookRoot, recipeId: "refine-chapter", chapterNumber: 3, narratorId: "leader" }));
    const submit = (stepId: string, kind: string, payload: unknown, allowedStepIds: string[]) =>
      submitWorkflowStepOutput({ storage, narratorId: "leader", runRevision: current.state.revision, stepId, kind, payload, allowedStepIds });
    current = ok(submitWorkflowStepOutput({ storage, narratorId: "leader", runRevision: current.state.revision, stepId: "step-context", kind: "other", payload: { summary: "本章已读" } }));
    for (const [template, stepId] of [["nf-reader-critic", "step-reader"], ["nf-style-keeper", "step-style"], ["nf-deai-auditor", "step-deai"]] as const) {
      expect(delegatedStepIdsFor(current, template)).toEqual([stepId]);
      current = ok(submit(stepId, "audit", { passed: false, summary: `${template} 的意见`, issues: [{ severity: "warning", description: "第二段" }] }, [stepId]));
    }
    expect(delegatedStepIdsFor(current, "nf-reviser")).toEqual(["step-revise"]);
    expect(buildWorkflowRunBrief(current)).toContain('subagent_type="nf-reviser"');
    current = ok(submit("step-revise", "prose", { title: "第三章", content: "改好的正文。" }, ["step-revise"]));
    expect(current.state.status).toBe("awaiting_approval");
    current = ok(approveWorkflowStep({ storage, runId: current.id, expectedRevision: current.state.revision, stepId: "step-revise" }));
    expect(getApprovedProse(storage, getActiveWorkflowRunForNarrator(storage, "leader")!)?.content).toBe("改好的正文。");
    const settleBrief = buildWorkflowRunBrief(current)!;
    expect(settleBrief).toContain("chapter_write");
    expect(settleBrief).toContain("approvedProse");
  });
});
