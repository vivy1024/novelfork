import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildWorkflowRunBrief } from "./run-brief";
import {
  approveWorkflowStep,
  cancelWorkflowRun,
  findApprovedProseMismatch,
  getApprovedProse,
  getWorkflowRunDetail,
  rejectWorkflowStep,
  reportWorkflowBlocker,
  retryWorkflowStep,
  startWorkflowRun,
  submitWorkflowStepOutput,
} from "./run-service";
import { getActiveWorkflowRunForNarrator, type WorkflowRunRecord } from "./run-store";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function setup(): Promise<{ storage: StorageDatabase; bookRoot: string }> {
  const dir = join(tmpdir(), `novelfork-workflow-run-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  // 走磁盘上的编号迁移：顺带验证 0037 能在真实迁移链上建表。
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = Date.now();
  storage.sqlite.exec(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-1', '测试书', ${now}, ${now});`);
  // 没有 story/workflow_recipes.json 时回退到内置方案。
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

function sceneCount(storage: StorageDatabase, chapter: number): number {
  return storage.sqlite
    .prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM narrative_scene WHERE book_id = 'book-1' AND chapter_number = ?`)
    .get(chapter)!.count;
}

const sceneSpec = {
  chapter: 7,
  title: "第七章",
  wordTarget: 3000,
  scenes: [
    { characters: ["萧炎"], location: "后山", conflict: "被围", mood: "紧张", outcome: "突围", hooks_used: [], hooks_planted: ["黑戒微光"] },
    { characters: ["萧炎", "药老"], location: "山洞", conflict: "伤势", mood: "低沉", outcome: "疗伤", hooks_used: ["黑戒微光"], hooks_planted: [] },
  ],
  constraints: [],
};

async function startFanqie(storage: StorageDatabase, bookRoot: string): Promise<WorkflowRunRecord> {
  return ok(await startWorkflowRun({
    storage,
    bookId: "book-1",
    bookRoot,
    recipeId: "fanqie-xuanhuan-serial",
    chapterNumber: 7,
    narratorId: "narrator-1",
  }));
}

describe("创作工作流运行：服务端到端", () => {
  it("完整走一趟：蓝图落场景、正文钉住、审查打回再批准、终审后完成", async () => {
    const { storage, bookRoot } = await setup();
    let run = await startFanqie(storage, bookRoot);
    expect(run.state.currentStepId).toBe("step-context");
    expect(buildWorkflowRunBrief(run)).toContain("workflow_submit_step_output");

    // 1. 上下文工序交小结，自动进入蓝图。
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "other", payload: { summary: "上下文就绪" } }));
    expect(run.state.currentStepId).toBe("step-blueprint");

    // 2. 蓝图：章号不对被拒，权威源零变化；对了才落成场景。
    const wrongChapter = submitWorkflowStepOutput({
      storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "scene-spec",
      payload: { sceneSpec: { ...sceneSpec, chapter: 8 } },
    });
    expect(wrongChapter.ok).toBe(false);
    expect(sceneCount(storage, 7)).toBe(0);
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "scene-spec", payload: { sceneSpec } }));
    expect(sceneCount(storage, 7)).toBe(2);
    expect(run.state.currentStepId).toBe("step-draft");

    // 3. 正文：无需确认，提交即作为「已批准正文」钉住。
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose", payload: { title: "突围", content: "萧炎一路杀出后山。" } }));
    expect(getApprovedProse(storage, run)).toEqual({ title: "突围", content: "萧炎一路杀出后山。" });
    expect(run.state.currentStepId).toBe("step-adversarial-audit");

    // 4. 审查需要确认：打回后意见进入下一次简报，重交后批准。
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "audit", payload: { passed: false, summary: "节奏拖沓", issues: [] } }));
    expect(run.state.status).toBe("awaiting_approval");
    expect(buildWorkflowRunBrief(run)).toContain("停止产出");
    run = ok(rejectWorkflowStep({ storage, runId: run.id, stepId: "step-adversarial-audit", expectedRevision: run.state.revision, note: "问题清单太空，逐条列出" }));
    expect(buildWorkflowRunBrief(run)).toContain("问题清单太空");
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "audit", payload: { passed: true, summary: "可以放行", issues: [{ severity: "info", description: "第三段略长" }] } }));
    run = ok(approveWorkflowStep({ storage, runId: run.id, stepId: "step-adversarial-audit", expectedRevision: run.state.revision }));
    expect(run.state.currentStepId).toBe("step-settlement");

    // 5. 落盘守卫：写入内容必须与已批准正文一致。
    expect(findApprovedProseMismatch(storage, run, "pipeline.write", { content: "另一份正文" })).not.toBeNull();
    expect(findApprovedProseMismatch(storage, run, "pipeline.write", { content: "  萧炎一路杀出后山。\r\n" })).toBeNull();
    expect(findApprovedProseMismatch(storage, run, "lore.write", { content: "随便" })).toBeNull();

    // 6. 最后一道因 requireFinalApproval 需要终审。
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "other", payload: { summary: "已落盘并结算" } }));
    expect(run.state.status).toBe("awaiting_approval");
    run = ok(approveWorkflowStep({ storage, runId: run.id, stepId: "step-settlement", expectedRevision: run.state.revision }));
    expect(run.state.status).toBe("done");
    expect(buildWorkflowRunBrief(run)).toBeNull();
    expect(getActiveWorkflowRunForNarrator(storage, "narrator-1")).toBeNull();

    const detail = getWorkflowRunDetail(storage, run.id)!;
    expect(detail.candidates.map((c) => [c.kind, c.decision])).toEqual([
      ["other", "approved"],
      ["scene-spec", "approved"],
      ["prose", "approved"],
      ["audit", "rejected"],
      ["audit", "approved"],
      ["other", "approved"],
    ]);
    expect(detail.candidates[1]!.committedRef).toBe("narrative_scene:chapter-7:2");
    // 事件按 seq 连续递增，可用于增量拉取。
    expect(detail.events.map((e) => e.seq)).toEqual(detail.events.map((_, i) => i + 1));
    expect(getWorkflowRunDetail(storage, run.id, detail.events.length - 1)!.events).toHaveLength(1);
  });

  it("同一叙述者不能同时有两个进行中的运行", async () => {
    const { storage, bookRoot } = await setup();
    await startFanqie(storage, bookRoot);
    const second = await startWorkflowRun({ storage, bookId: "book-1", bookRoot, recipeId: "fanqie-xuanhuan-serial", chapterNumber: 8, narratorId: "narrator-1" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
  });

  it("版本过期的提交被 409 拒绝，运行保持原样", async () => {
    const { storage, bookRoot } = await setup();
    const run = await startFanqie(storage, bookRoot);
    const stale = submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision + 5, kind: "other", payload: { summary: "x" } });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.status).toBe(409);
      expect(stale.code).toBe("revision-conflict");
    }
    expect(getActiveWorkflowRunForNarrator(storage, "narrator-1")!.state.revision).toBe(run.state.revision);
  });

  it("交错类别、空 payload、没有运行时都给出可执行的说明", async () => {
    const { storage, bookRoot } = await setup();
    expect(submitWorkflowStepOutput({ storage, narratorId: "nobody", runRevision: 0, kind: "other", payload: { summary: "x" } }).ok).toBe(false);
    const run = await startFanqie(storage, bookRoot);
    const wrongKind = submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose", payload: { content: "x" } });
    expect(!wrongKind.ok && wrongKind.explanation.action).toContain('kind="other"');
    const empty = submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "other", payload: { summary: "  " } });
    expect(empty.ok).toBe(false);
  });

  it("报告阻塞：stop 策略受阻，作者重试后继续；取消后结束", async () => {
    const { storage, bookRoot } = await setup();
    let run = await startFanqie(storage, bookRoot);
    const incomplete = reportWorkflowBlocker({ storage, narratorId: "narrator-1", runRevision: run.state.revision, explanation: { what: "缺上下文", why: "", action: "补" } });
    expect(incomplete.ok).toBe(false);
    run = ok(reportWorkflowBlocker({ storage, narratorId: "narrator-1", runRevision: run.state.revision, explanation: { what: "缺上下文", why: "当前聚焦未填写", action: "请作者补写当前聚焦" } }));
    expect(run.state.status).toBe("blocked");
    expect(buildWorkflowRunBrief(run)).toContain("当前聚焦未填写");
    run = ok(retryWorkflowStep({ storage, runId: run.id, expectedRevision: run.state.revision }));
    expect(run.state.status).toBe("running");
    run = ok(cancelWorkflowRun({ storage, runId: run.id, expectedRevision: run.state.revision }));
    expect(run.state.status).toBe("cancelled");
    expect(getActiveWorkflowRunForNarrator(storage, "narrator-1")).toBeNull();
  });

  it("打回必须写意见", async () => {
    const { storage, bookRoot } = await setup();
    const run = await startFanqie(storage, bookRoot);
    const result = rejectWorkflowStep({ storage, runId: run.id, stepId: "step-context", expectedRevision: run.state.revision, note: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("note-required");
  });

  it("找不到方案时 404 并说明怎么办", async () => {
    const { storage, bookRoot } = await setup();
    const result = await startWorkflowRun({ storage, bookId: "book-1", bookRoot, recipeId: "nope", chapterNumber: 1, narratorId: "n" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
