import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTextGenerator, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";
import { awaitStyleDistillationToolRun, executeStyleDistillationTool } from "./style-distill-tools.js";
import type { TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";
import { loadStylePreset, saveStylePreset } from "../engine/writing-layers/style-preset-store.js";
import { createStylePreset } from "../engine/writing-layers/style-preset.js";
import { readStyleDistillationJob } from "../engine/writing-layers/style-distillation-runner.js";

const roots: string[] = [];
const startedJobs: { root: string; jobId: string }[] = [];
afterEach(async () => {
  // 后台批次跑完再删临时书根，免得删目录时任务文件还在写。
  await Promise.all(startedJobs.splice(0).map(({ root, jobId }) => awaitStyleDistillationToolRun(root, jobId)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(): Promise<{ root: string; binding: TrustedRuntimeBookBinding }> {
  const root = await mkdtemp(join(tmpdir(), "nf-style-tools-")); roots.push(root); await mkdir(join(root, "story"));
  return { root, binding: { bookId: "book-1", root } };
}

function context(generateText?: RuntimeTextGenerator, emitOutput?: (line: string) => void): ToolExecutionContext {
  return {
    sessionId: "narrator-1", runtimeProjectId: "project", projectRoot: "", projectType: "novel", enabledPluginIds: ["novel"], resourceBindings: {},
    ...(generateText ? { generateText } : {}),
    ...(emitOutput ? { emitOutput } : {}),
  };
}

const chapters = [
  { number: 1, content: "她停在门前，听见雨声。灯影在墙上晃了一下，她没有回头。" },
  { number: 2, content: "他把旧信压在杯底，茶水慢慢凉了。窗外有人喊了一声，又停了。" },
];

const modelOutput = {
  text: "```json\n" + JSON.stringify({ rules: [
    { category: "scene", text: "用一个小动作收住情绪，不直接说出感受", evidence: "她没有回头", transfer: "transferable", reason: "动作收束与题材无关" },
    { category: "voice", text: "旧信意象贯穿人物关系", evidence: "他把旧信压在杯底", transfer: "source-only", reason: "旧信是本作专属道具" },
  ] }) + "\n```",
};
const model: RuntimeTextGenerator = vi.fn(async () => modelOutput);

type ToolData = {
  job: { jobId: string; status: string };
  batches: { total: number; done: number; failed: number; pending: number; failures: { explanation?: { what: string } }[] };
  reviewItems: {
    ruleCount: number;
    rules?: { id: string; origin: string; transfer: string; status: string }[];
    samples?: { id: string }[];
    page?: { hasMore: boolean; next?: string };
    note?: string;
  };
  explanation?: { what: string; next: string };
  alreadyRunning?: boolean;
};

/** 启动并等后台批次跑完，返回跑完后的 status。 */
async function startAndSettle(binding: TrustedRuntimeBookBinding, input: Record<string, unknown>, ctx: ToolExecutionContext) {
  const started = await executeStyleDistillationTool("style.distill_start", input, binding, ctx);
  expect(started.ok).toBe(true);
  const jobId = (started.data as ToolData).job.jobId;
  startedJobs.push({ root: binding.root, jobId });
  await awaitStyleDistillationToolRun(binding.root, jobId);
  const status = await executeStyleDistillationTool("style.distill_status", { jobId }, binding, context());
  return { started, status, jobId };
}

describe("叙述者文风蒸馏工具", () => {
  it("预览不落盘；start 把批次放到后台并立即返回，status 等待后看到结果，返回不含完整任务", async () => {
    const { root, binding } = await setup();
    const preview = await executeStyleDistillationTool("style.distill_preview", { sourceName: "旧稿", chapters }, binding, context());
    expect(preview.ok).toBe(true);
    // 与网页预览同一份估算：两章短文合成 1 批。
    expect(preview).toMatchObject({ data: { estimate: { batchCount: 1, maxOutputTokens: 16_000, worstCaseModelCalls: 3 } } });
    expect(preview.summary).toContain("将调用模型 1 次");
    expect(await import("node:fs/promises").then(({ readdir }) => readdir(join(root, "story")).catch(() => []))).toEqual([]);

    // 模型调用被闸住：start 必须在模型返回之前就结束。
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const gated: RuntimeTextGenerator = vi.fn(async () => { await gate; return modelOutput; });
    const lines: string[] = [];
    const started = await executeStyleDistillationTool("style_distill_start", { sourceName: "旧稿", chapters }, binding, context(gated, (line) => lines.push(line)));
    const startedData = started.data as ToolData;
    startedJobs.push({ root, jobId: startedData.job.jobId });
    expect(started).toMatchObject({ ok: true, data: { job: { status: "running" }, batches: { total: 1, done: 0, pending: 1 }, expectedVersion: "", next: { action: "status" } } });
    expect(started.summary).toContain("后台");
    expect(started.summary).toContain("action=status");
    expect(startedData.reviewItems.rules).toBeUndefined();
    expect(lines[0]).toContain("初始化文风蒸馏任务");
    expect(lines.at(-1)).toContain("已在后台开始");

    // 运行中重复 start 不会并发启动第二个执行者。
    const again = await executeStyleDistillationTool("style.distill_start", { jobId: startedData.job.jobId }, binding, context(gated));
    expect(again).toMatchObject({ ok: true, data: { alreadyRunning: true, job: { status: "running" } } });

    const waiting = executeStyleDistillationTool("style.distill_status", { jobId: startedData.job.jobId, waitSeconds: 10 }, binding, context());
    release();
    const status = await waiting;
    expect(gated).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({ ok: true, data: { job: { jobId: startedData.job.jobId, status: "ready" }, batches: { done: 1, failed: 0 } } });
    const data = status.data as ToolData & { job: Record<string, unknown> };
    // 瘦身：不再回传完整任务（批次详情、规则全文、样本全文）。
    expect(data.job).not.toHaveProperty("rules");
    expect(data.job).not.toHaveProperty("batches");
    expect(data.job).not.toHaveProperty("samples");
    const modelRules = data.reviewItems.rules!.filter((rule) => rule.origin === "model");
    expect(modelRules).toHaveLength(2);
    expect(modelRules.every((rule) => rule.status === "needs-review")).toBe(true);
  });

  it("待审条目分页返回，并说明如何读取后续", async () => {
    const { binding } = await setup();
    const { status, jobId } = await startAndSettle(binding, { sourceName: "旧稿", chapters }, context(model));
    const total = (status.data as ToolData).reviewItems.ruleCount;
    expect(total).toBeGreaterThan(1);
    const page = await executeStyleDistillationTool("style.distill_status", { jobId, itemLimit: 1 }, binding, context());
    const pageData = page.data as ToolData;
    expect(pageData.reviewItems.rules).toHaveLength(1);
    expect(pageData.reviewItems.page).toMatchObject({ hasMore: true, next: expect.stringContaining("itemOffset=1") });
    const second = await executeStyleDistillationTool("style.distill_status", { jobId, itemOffset: 1, itemLimit: 1 }, binding, context());
    expect((second.data as ToolData).reviewItems.rules![0]!.id).not.toBe(pageData.reviewItems.rules![0]!.id);
  });

  it("后台批次的模型失败写进批次，status 能看到失败原因并可 retryFailed 重试", async () => {
    const { binding } = await setup();
    const broken: RuntimeTextGenerator = vi.fn(async () => { throw new Error("供应商 500"); });
    const { status, jobId } = await startAndSettle(binding, { sourceName: "旧稿", chapters }, context(broken));
    expect(status).toMatchObject({ ok: true, data: { batches: { failed: 1, failures: [{ explanation: { what: expect.stringContaining("供应商 500") } }] } } });
    expect(status.summary).toContain("retryFailed=true");

    const retried = await executeStyleDistillationTool("style.distill_start", { jobId, retryFailed: true }, binding, context(model));
    expect(retried).toMatchObject({ ok: true, data: { job: { status: "running" } } });
    await awaitStyleDistillationToolRun(binding.root, jobId);
    const after = await executeStyleDistillationTool("style.distill_status", { jobId }, binding, context());
    expect(after).toMatchObject({ ok: true, data: { job: { status: "ready" }, batches: { done: 1, failed: 0 } } });
  });

  it("后台任务级失败（来源快照缺失）写进 lastError，status 给出停下原因", async () => {
    const { root, binding } = await setup();
    const created = await executeStyleDistillationTool("style.distill_start", { sourceName: "旧稿", chapters }, binding, context());
    const jobId = (created.data as ToolData).job.jobId;
    await rm(join(root, "story", "style-distillations", `${jobId}.source.json`));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const started = await executeStyleDistillationTool("style.distill_start", { jobId }, binding, context(model));
      expect(started.ok).toBe(true);
      startedJobs.push({ root, jobId });
      await awaitStyleDistillationToolRun(root, jobId);
    } finally {
      errors.mockRestore();
    }
    const status = await executeStyleDistillationTool("style.distill_status", { jobId }, binding, context());
    expect(status).toMatchObject({
      ok: true,
      data: {
        job: { status: "paused" },
        explanation: { what: expect.stringContaining("来源快照") },
        background: { runningInThisSession: false, lastOutcome: { outcome: "failed" } },
      },
    });
  });

  it("会话中断时后台批次退回待处理、任务暂停并说明原因，之后带 jobId 续跑", async () => {
    const { root, binding } = await setup();
    const controller = new AbortController();
    const aborting: RuntimeTextGenerator = vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    });
    const abortContext = { ...context(aborting), signal: controller.signal };
    const started = await executeStyleDistillationTool("style.distill_start", { sourceName: "旧稿", chapters }, binding, abortContext);
    expect(started.ok).toBe(true);
    const jobId = (started.data as ToolData).job.jobId;
    startedJobs.push({ root, jobId });
    await awaitStyleDistillationToolRun(root, jobId);
    // 中断后不再发起拆半重试或后续批次。
    expect(aborting).toHaveBeenCalledTimes(1);
    const job = await readStyleDistillationJob(root, jobId);
    expect(job.batches.map((batch) => batch.status)).toEqual(["pending"]);
    expect(job.status).toBe("paused");

    const status = await executeStyleDistillationTool("style.distill_status", { jobId }, binding, context());
    expect(status).toMatchObject({
      ok: true,
      data: { job: { status: "paused" }, explanation: { what: expect.stringContaining("会话本轮已结束或被中断") }, background: { lastOutcome: { outcome: "aborted" } } },
    });
    expect(status.summary).toContain("action=start");

    await executeStyleDistillationTool("style.distill_start", { jobId }, binding, context(model));
    await awaitStyleDistillationToolRun(root, jobId);
    const resumed = await executeStyleDistillationTool("style.distill_status", { jobId }, binding, context());
    expect(resumed).toMatchObject({ ok: true, data: { job: { status: "ready" }, batches: { done: 1, failed: 0 } } });
    // 续跑成功后停下原因清除。
    expect((resumed.data as ToolData).explanation).toBeUndefined();
  });

  it("宿主提供不随本轮取消的模型时优先用它：会话中断后批次照常跑完，并记下发起人", async () => {
    const { root, binding } = await setup();
    const controller = new AbortController();
    const session: RuntimeTextGenerator = vi.fn(async () => { throw new Error("不应调用本会话模型"); });
    const background: RuntimeTextGenerator = vi.fn(async () => {
      // 模型还在跑时本轮就结束了：脱离会话的批次不受影响。
      controller.abort();
      return modelOutput;
    });
    const detachedContext: ToolExecutionContext = {
      ...context(session),
      backgroundGenerateText: background,
      actorUserId: "user-7",
      signal: controller.signal,
    };
    const started = await executeStyleDistillationTool("style.distill_start", { sourceName: "旧稿", chapters }, binding, detachedContext);
    expect(started.ok).toBe(true);
    expect(started.summary).toContain("本轮对话结束后照常跑完");
    const jobId = (started.data as ToolData).job.jobId;
    startedJobs.push({ root, jobId });
    await awaitStyleDistillationToolRun(root, jobId);

    expect(session).not.toHaveBeenCalled();
    expect(background).toHaveBeenCalledTimes(1);
    const job = await readStyleDistillationJob(root, jobId);
    expect(job.status).toBe("ready");
    expect(job.initiatorId).toBe("user-7");
    const status = await executeStyleDistillationTool("style.distill_status", { jobId }, binding, context());
    expect(status).toMatchObject({ ok: true, data: { batches: { done: 1, failed: 0 }, background: { lastOutcome: { outcome: "completed" } } } });
  });

  it("cancel 停止脱离会话的后台批次：当前批次收尾后暂停，说明是作者停止；没在跑时如实说明", async () => {
    const { root, binding } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const background: RuntimeTextGenerator = vi.fn(async () => { await gate; return modelOutput; });
    const detachedContext: ToolExecutionContext = { ...context(), backgroundGenerateText: background, actorUserId: "user-7" };
    // 章节够长才会切成多批：停止只拦「下一批」，单批任务会照常跑完。
    const longChapters = Array.from({ length: 4 }, (_, index) => ({
      number: index + 1,
      content: `她没有回头。${"风从巷口灌进来，灯影晃了一下。".repeat(400)}`,
    }));
    const started = await executeStyleDistillationTool("style.distill_start", { sourceName: "旧稿", chapters: longChapters }, binding, detachedContext);
    const jobId = (started.data as ToolData).job.jobId;
    startedJobs.push({ root, jobId });
    expect((started.data as ToolData).batches.total).toBeGreaterThan(1);
    await vi.waitFor(() => expect(background).toHaveBeenCalledTimes(1));

    const cancelled = await executeStyleDistillationTool("style.distill_cancel", { jobId }, binding, context());
    expect(cancelled).toMatchObject({ ok: true, data: { cancelRequested: true } });
    release();
    await awaitStyleDistillationToolRun(root, jobId);
    const status = await executeStyleDistillationTool("style.distill_status", { jobId }, binding, context());
    expect(status).toMatchObject({
      ok: true,
      data: {
        explanation: { what: expect.stringContaining("作者停止了文风蒸馏") },
        background: { lastOutcome: { outcome: "aborted", message: expect.stringContaining("作者停止") } },
      },
    });

    const again = await executeStyleDistillationTool("style.distill_cancel", { jobId }, binding, context());
    expect(again.ok).toBe(true);
    expect(again.summary).toContain("没有在跑的后台批次");
  });

  it("没有会话模型时保存基线并暂停，之后带 jobId 继续同一任务", async () => {
    const { binding } = await setup();
    const started = await executeStyleDistillationTool("style.distill_start", { sourceName: "旧稿", chapters }, binding, context());
    expect(started).toMatchObject({ ok: true, data: { job: { status: "paused" }, explanation: { what: expect.stringContaining("没有可用") } } });
    const jobId = (started.data as ToolData).job.jobId;
    const { status } = await startAndSettle(binding, { jobId }, context(model));
    expect(status).toMatchObject({ ok: true, data: { job: { jobId, status: "ready" }, batches: { done: 1 } } });
  });

  it("全部批次已结束时 start 不再启动后台批次", async () => {
    const { binding } = await setup();
    const { jobId } = await startAndSettle(binding, { sourceName: "旧稿", chapters }, context(model));
    const calls = vi.mocked(model).mock.calls.length;
    const again = await executeStyleDistillationTool("style.distill_start", { jobId }, binding, context(model));
    expect(again).toMatchObject({ ok: true, data: { job: { status: "ready" } } });
    expect(again.summary).toContain("没有待处理批次");
    expect(vi.mocked(model).mock.calls.length).toBe(calls);
  });

  it("对话采纳只写点名条目、复用 HTTP 同一采纳函数，版本不符返回 409 语义并带 explanation", async () => {
    const { root, binding } = await setup();
    const { status, jobId } = await startAndSettle(binding, { sourceName: "旧稿", chapters }, context(model));
    const rules = (status.data as ToolData).reviewItems.rules!;
    const transferable = rules.find((rule) => rule.origin === "model" && rule.transfer === "可迁移")!;

    const empty = await executeStyleDistillationTool("style.distill_adopt", { jobId, expectedVersion: "" }, binding, context());
    expect(empty).toMatchObject({ ok: false, error: "nothing-to-adopt" });

    const adopted = await executeStyleDistillationTool("style.distill_adopt", { jobId, ruleIds: [transferable.id], expectedVersion: "" }, binding, context());
    expect(adopted).toMatchObject({ ok: true, data: { guideRuleCount: 1, status: "adopted" } });
    expect((await loadStylePreset(root)).guideText).toContain("用一个小动作收住情绪");

    const version = (adopted.data as { expectedVersion: string }).expectedVersion;
    await saveStylePreset(root, { ...createStylePreset(), name: "作者刚改过" }, version);
    const conflict = await executeStyleDistillationTool("style.distill_adopt", { jobId, ruleIds: [transferable.id], expectedVersion: version }, binding, context());
    expect(conflict).toMatchObject({ ok: false, error: "STYLE_PRESET_CONFLICT", data: { status: 409, explanation: { next: expect.stringContaining("expectedVersion") } } });
    expect((await loadStylePreset(root)).preset?.name).toBe("作者刚改过");
  });

  it("缺少任务 ID、越过可信书籍或未知工具名会明确失败", async () => {
    const { root, binding } = await setup();
    expect(await executeStyleDistillationTool("style.distill_status", {}, binding, context())).toMatchObject({ ok: false, error: "job-id-required" });
    expect(await executeStyleDistillationTool("style.distill_adopt", { ruleIds: ["x"], expectedVersion: "" }, binding, context())).toMatchObject({ ok: false, error: "job-id-required" });
    const started = await executeStyleDistillationTool("style.distill_start", { sourceName: "旧稿", chapters }, binding, context());
    const jobId = (started.data as ToolData).job.jobId;
    const foreign = await executeStyleDistillationTool("style.distill_status", { jobId }, { bookId: "book-2", root }, context());
    expect(foreign).toMatchObject({ ok: false, error: "STYLE_DISTILLATION_NOT_FOUND" });
    expect(await executeStyleDistillationTool("style.distill_delete", {}, binding, context())).toMatchObject({ ok: false, error: "unknown-style-distill-tool" });
  });

  it("style.distill_index 列出书根参考文件并做分页机械索引，联动 filePath + chapterList 靶向蒸馏保留原章号", async () => {
    const { root, binding } = await setup();
    const text = Array.from({ length: 130 }, (_, idx) => (
      `第${idx + 1}章 章题${idx + 1}\n${idx + 1 === 24
        ? "本月工时折算 300 枚灵石，贷款利息 50 灵石，余额与成本算账分明。".repeat(20)
        : "她停在门前，听见雨声。灯影在墙上晃了一下，她没有回头。".repeat(12)}`
    )).join("\n\n");
    await writeFile(join(root, "参考大书.txt"), text, "utf8");

    const fileList = await executeStyleDistillationTool("style.distill_index", { listFilesOnly: true }, binding, context());
    expect(fileList).toMatchObject({ ok: true, data: { files: [expect.objectContaining({ filePath: "参考大书.txt" })] } });

    const indexed = await executeStyleDistillationTool("style.distill_index", { filePath: "参考大书.txt" }, binding, context());
    expect(indexed.ok).toBe(true);
    const indexData = indexed.data as {
      chapterCount: number;
      chapters: { number: number }[];
      pagination: { offset: number; limit: number; hasMore: boolean };
      recommendedChapters: { chapterNumbers: number[] };
    };
    expect(indexData.chapterCount).toBe(130);
    expect(indexData.chapters).toHaveLength(100);
    expect(indexData.pagination).toEqual({ offset: 0, limit: 100, totalChapters: 130, hasMore: true });
    expect(indexData.recommendedChapters.chapterNumbers).toContain(24);

    const page2 = await executeStyleDistillationTool("style.distill_index", { filePath: "参考大书.txt", offset: 100, limit: 50 }, binding, context());
    expect((page2.data as { chapters: { number: number }[] }).chapters.map((c) => c.number)[0]).toBe(101);

    const preview = await executeStyleDistillationTool(
      "style.distill_preview",
      { filePath: "参考大书.txt", chapterList: [1, 2, 24, 128] },
      binding,
      context(),
    );
    expect(preview).toMatchObject({ ok: true, data: { chapterCount: 4, chapterRange: { from: 1, to: 128 } } });

    const { status } = await startAndSettle(binding, { filePath: "参考大书.txt", chapterList: [1, 24, 128] }, context(model));
    expect(status).toMatchObject({ ok: true, data: { job: { status: "ready", chapterRange: { from: 1, to: 128 }, chapterCount: 3 } } });
  });
});
