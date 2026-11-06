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
  skipWorkflowStep,
  startWorkflowRun,
  submitWorkflowStepOutput,
} from "./run-service";
import {
  compactFinishedWorkflowProseCandidates,
  getActiveWorkflowRunForNarrator,
  isCompactedProsePayload,
  type WorkflowRunRecord,
} from "./run-store";
import { proseSha256 } from "../writing-resource/prose-digest";

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

    // 3. 正文：提交后只是待定候选，审校与作者确认前不算批准，更不能落盘。
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose", payload: { title: "突围", content: "萧炎一路杀出后山。" } }));
    expect(getApprovedProse(storage, run)).toBeNull();
    expect(run.state.currentStepId).toBe("step-adversarial-audit");
    expect(findApprovedProseMismatch(storage, run, "pipeline.write", { content: "萧炎一路杀出后山。" })?.what).toContain("还没有经作者确认");

    // 4. 审校不通过：自动打回写正文的工序，意见进入下一次简报（不经作者）。
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "audit", payload: { passed: false, summary: "节奏拖沓", issues: [{ severity: "error", description: "第二场冲突没有升级" }] } }));
    expect(run.state.currentStepId).toBe("step-draft");
    expect(buildWorkflowRunBrief(run)).toContain("第二场冲突没有升级");
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose", payload: { title: "突围", content: "萧炎一路杀出后山。追兵更近了。" } }));

    // 审校通过后等作者确认；作者先打回审校本身（要求逐条列问题），重交后批准。
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "audit", payload: { passed: true, summary: "可以放行", issues: [] } }));
    expect(run.state.status).toBe("awaiting_approval");
    expect(buildWorkflowRunBrief(run)).toContain("停止产出");
    run = ok(approveWorkflowStep({ storage, runId: run.id, stepId: "step-adversarial-audit", expectedRevision: run.state.revision }));
    expect(run.state.currentStepId).toBe("step-settlement");
    // 作者在审校处放行，等于确认了它审过的那份正文。
    expect(getApprovedProse(storage, run)).toEqual({ title: "突围", content: "萧炎一路杀出后山。追兵更近了。" });

    // 5. 落盘守卫：写入内容必须与已批准正文一致；按引用落盘（不传正文）放行。
    expect(findApprovedProseMismatch(storage, run, "pipeline.write", { content: "另一份正文" })).not.toBeNull();
    expect(findApprovedProseMismatch(storage, run, "pipeline.write", { content: "  萧炎一路杀出后山。追兵更近了。\r\n" })).toBeNull();
    expect(findApprovedProseMismatch(storage, run, "pipeline.write", { fromWorkflowRun: true })).toBeNull();
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
      ["prose", "rejected"],
      ["audit", "approved"],
      ["prose", "approved"],
      ["audit", "approved"],
      ["other", "approved"],
    ]);
    expect(detail.events.some((event) => event.type === "step_auto_returned")).toBe(true);
    expect(detail.candidates[1]!.committedRef).toBe("narrative_scene:chapter-7:2");
    // 事件按 seq 连续递增，可用于增量拉取。
    expect(detail.events.map((e) => e.seq)).toEqual(detail.events.map((_, i) => i + 1));
    expect(getWorkflowRunDetail(storage, run.id, detail.events.length - 1)!.events).toHaveLength(1);

    // 7. 运行结束后正文候选只留摘要与指纹（落盘工序已完成，章节文件是权威）；存量压缩无事可做。
    const prose = detail.candidates.filter((c) => c.kind === "prose");
    for (const candidate of prose) {
      expect(isCompactedProsePayload(candidate.payload)).toBe(true);
      expect(JSON.stringify(candidate.payload)).not.toContain("\"content\"");
    }
    expect((prose[1]!.payload as { compacted: { sha256: string } }).compacted.sha256).toBe(proseSha256("萧炎一路杀出后山。追兵更近了。"));
    expect(compactFinishedWorkflowProseCandidates(storage).candidates).toEqual({ approved: 0, rejected: 0, pending: 0 });
  });

  it("运行进行中正文候选保留全文；取消后作废版压缩、已批准未落盘的保留；存量压缩可预演", async () => {
    const { storage, bookRoot } = await setup();
    let run = await startFanqie(storage, bookRoot);
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "other", payload: { summary: "上下文就绪" } }));
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "scene-spec", payload: { sceneSpec } }));
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose", payload: { title: "突围", content: "第一版正文。" } }));
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "audit", payload: { passed: false, summary: "重写", issues: [] } }));
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose", payload: { title: "突围", content: "第二版正文。" } }));
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "audit", payload: { passed: true, summary: "可以", issues: [] } }));
    run = ok(approveWorkflowStep({ storage, runId: run.id, stepId: "step-adversarial-audit", expectedRevision: run.state.revision }));
    // 进行中：落盘闸门仍能拿到全文。
    expect(getApprovedProse(storage, run)).toEqual({ title: "突围", content: "第二版正文。" });
    expect(findApprovedProseMismatch(storage, run, "pipeline.write", { content: "另一份" })).not.toBeNull();
    expect(compactFinishedWorkflowProseCandidates(storage).candidates).toEqual({ approved: 0, rejected: 0, pending: 0 });

    run = ok(cancelWorkflowRun({ storage, runId: run.id, expectedRevision: run.state.revision }));
    const prose = getWorkflowRunDetail(storage, run.id)!.candidates.filter((c) => c.kind === "prose");
    expect(prose.map((c) => c.decision)).toEqual(["rejected", "approved"]);
    expect(isCompactedProsePayload(prose[0]!.payload)).toBe(true);
    // 取消时已批准的正文没落盘过：它可能是唯一一份，保留全文。
    expect(prose[1]!.payload).toEqual({ title: "突围", content: "第二版正文。" });

    // 存量预演：模拟老库里结束运行的被打回正文仍带全文。
    storage.sqlite
      .prepare(`UPDATE workflow_run_candidates SET payload_json = ? WHERE id = ?`)
      .run(JSON.stringify({ title: "突围", content: "第一版正文。".repeat(100) }), prose[0]!.id);
    const preview = compactFinishedWorkflowProseCandidates(storage);
    expect(preview).toMatchObject({ dryRun: true, runs: 1, candidates: { approved: 0, rejected: 1, pending: 0 } });
    expect(preview.bytesAfter).toBeLessThan(preview.bytesBefore);
    expect(JSON.stringify(getWorkflowRunDetail(storage, run.id)!.candidates[2]!.payload)).toContain("content");
    const applied = compactFinishedWorkflowProseCandidates(storage, { dryRun: false });
    expect(applied).toMatchObject({ dryRun: false, candidates: { rejected: 1 } });
    const after = getWorkflowRunDetail(storage, run.id)!.candidates.filter((c) => c.kind === "prose");
    expect(isCompactedProsePayload(after[0]!.payload)).toBe(true);
    expect(after[1]!.payload).toEqual({ title: "突围", content: "第二版正文。" });
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

  async function toDraftStep(storage: StorageDatabase, bookRoot: string): Promise<WorkflowRunRecord> {
    let run = await startFanqie(storage, bookRoot);
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "other", payload: { summary: "上下文就绪" } }));
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "scene-spec", payload: { sceneSpec } }));
    expect(run.state.currentStepId).toBe("step-draft");
    return run;
  }

  // 本书 1000 字 → 硬范围 728–1272（与 pipeline.write 同一口径）。
  const lengthRule = { chapterWordCount: 1000, language: "zh" as const };

  it("正文候选提交时按本书硬范围校验字数：154 字被拒并说明差多少，运行原样", async () => {
    const { storage, bookRoot } = await setup();
    const run = await toDraftStep(storage, bookRoot);
    const short = submitWorkflowStepOutput({
      storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose",
      payload: { content: "短".repeat(154) }, lengthRule,
    });
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.code).toBe("length-out-of-range");
      expect(short.explanation.what).toContain("154字");
      expect(short.explanation.what).toContain("728-1272");
      expect(short.explanation.what).toContain("还差 574字");
    }
    const after = getActiveWorkflowRunForNarrator(storage, "narrator-1")!;
    expect(after.state.revision).toBe(run.state.revision);
    expect(after.state.currentStepId).toBe("step-draft");
    expect(getWorkflowRunDetail(storage, run.id)!.candidates.filter((c) => c.kind === "prose")).toHaveLength(0);

    const long = submitWorkflowStepOutput({
      storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose",
      payload: { content: "长".repeat(1300) }, lengthRule,
    });
    expect(!long.ok && long.explanation.what).toContain("超出上限 28字");

    const fine = ok(submitWorkflowStepOutput({
      storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose",
      payload: { content: "好".repeat(1000) }, lengthRule,
    }));
    expect(fine.state.currentStepId).toBe("step-adversarial-audit");
  });

  it("落盘工序受阻（如字数 / 写前预检）：运行受阻而非完成；作者可打回写正文重做", async () => {
    const { storage, bookRoot } = await setup();
    let run = await toDraftStep(storage, bookRoot);
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "prose", payload: { content: "萧炎一路杀出后山。" } }));
    run = ok(submitWorkflowStepOutput({ storage, narratorId: "narrator-1", runRevision: run.state.revision, kind: "audit", payload: { passed: true, summary: "可以放行", issues: [] } }));
    run = ok(approveWorkflowStep({ storage, runId: run.id, stepId: "step-adversarial-audit", expectedRevision: run.state.revision }));
    expect(run.state.currentStepId).toBe("step-settlement");
    expect(getApprovedProse(storage, run)).not.toBeNull();

    // 叙述者照简报报告落盘被拦：运行停在落盘工序，不能显示完成。
    run = ok(reportWorkflowBlocker({
      storage, narratorId: "narrator-1", runRevision: run.state.revision,
      explanation: { what: "pipeline.write 被拦下：length-out-of-range", why: "正文 154 字，不在 728-1272 内", action: "打回写正文补足字数" },
    }));
    expect(run.state.status).toBe("blocked");
    expect(run.state.steps.find((step) => step.stepId === "step-settlement")!.status).toBe("failed");
    expect(getActiveWorkflowRunForNarrator(storage, "narrator-1")).not.toBeNull();

    // 跳过被拒：跳过等于批准的正文没进书却显示完成。
    const skipped = skipWorkflowStep({ storage, runId: run.id, stepId: "step-settlement", expectedRevision: run.state.revision });
    expect(!skipped.ok && skipped.code).toBe("chapter-write-cannot-skip");

    // 版本过期的打回仍按乐观锁拒绝。
    const stale = rejectWorkflowStep({ storage, runId: run.id, stepId: "step-settlement", expectedRevision: run.state.revision - 1, note: "补足字数" });
    expect(!stale.ok && stale.code).toBe("revision-conflict");

    run = ok(rejectWorkflowStep({ storage, runId: run.id, stepId: "step-settlement", expectedRevision: run.state.revision, note: "正文太短，补足到 800 字以上" }));
    expect(run.state.status).toBe("running");
    expect(run.state.currentStepId).toBe("step-draft");
    expect(buildWorkflowRunBrief(run)).toContain("正文太短，补足到 800 字以上");
    // 旧的已批准正文作废：重写的正文要重新经审校与作者确认才能落盘。
    expect(getApprovedProse(storage, run)).toBeNull();
    expect(findApprovedProseMismatch(storage, run, "pipeline.write", { fromWorkflowRun: true })?.what).toContain("还没有经作者确认");
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
