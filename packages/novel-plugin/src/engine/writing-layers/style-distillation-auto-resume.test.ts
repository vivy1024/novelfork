import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import { loadStyleDistillationJob, STYLE_DISTILLATIONS_RELATIVE_DIR } from "./style-distillation.js";
import {
  ensureStyleDistillationAutoResume,
  resetStyleDistillationAutoResumeForTests,
  STYLE_DISTILLATION_AUTO_RESUME_MAX_FAILURES,
} from "./style-distillation-auto-resume.js";
import { acquireStyleDistillationLock, inspectStyleDistillationLock, styleDistillationLockPath } from "./style-distillation-lock.js";
import { createStyleDistillationJob, readStyleDistillationJob, runStyleDistillationBatches } from "./style-distillation-runner.js";

const roots: string[] = [];
let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  resetStyleDistillationAutoResumeForTests();
  logs = [
    vi.spyOn(console, "info").mockImplementation(() => undefined),
    vi.spyOn(console, "warn").mockImplementation(() => undefined),
    vi.spyOn(console, "error").mockImplementation(() => undefined),
  ];
});
afterEach(async () => {
  for (const spy of logs) spy.mockRestore();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function bookRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nf-style-auto-resume-"));
  roots.push(root);
  return root;
}

function chapters(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    title: `第${index + 1}章`,
    content: `她把伞收起来，雨水顺着伞骨滴进鞋里${index + 1}。${"风从巷口灌进来，灯影晃了一下。".repeat(320)}`,
  }));
}

function fakeModel(): RuntimeTextGenerator & ReturnType<typeof vi.fn> {
  return vi.fn(async (request: Parameters<RuntimeTextGenerator>[0]) => {
    const user = request.messages.find((message) => message.role === "user")?.content ?? "";
    const first = Number(/### 第(\d+)章/u.exec(user)?.[1] ?? 1);
    return { text: JSON.stringify({ rules: [{
      category: "scene", text: `用身体感受开场（第${first}章）`, evidence: `雨水顺着伞骨滴进鞋里${first}`, transfer: "transferable", reason: "通用",
    }] }) };
  }) as unknown as RuntimeTextGenerator & ReturnType<typeof vi.fn>;
}

const OWNER = "author-1";

function jobFile(root: string, jobId: string): string {
  return join(root, STYLE_DISTILLATIONS_RELATIVE_DIR, `${jobId}.json`);
}

/** 模拟「执行者跑到一半进程退出」：先正常跑完 doneBatches 批，再把磁盘状态改回 running 并留下 running 批次。 */
async function orphanedJob(root: string, options: { batches?: number; doneBatches?: number; failures?: number } = {}) {
  const created = await createStyleDistillationJob({ bookRoot: root, bookId: "book-1", source: { sourceName: "旧稿", chapters: chapters((options.batches ?? 3) * 2) }, modelAvailable: true, initiatorId: OWNER });
  if (options.doneBatches) await runStyleDistillationBatches({ bookRoot: root, jobId: created.jobId, generateText: fakeModel(), maxBatches: options.doneBatches });
  const raw = JSON.parse(await readFile(jobFile(root, created.jobId), "utf8"));
  raw.status = "running";
  const next = raw.batches.find((batch: { status: string }) => batch.status === "pending");
  if (next) next.status = "running";
  if (options.failures !== undefined) raw.autoResume = { failures: options.failures };
  await writeFile(jobFile(root, created.jobId), JSON.stringify(raw), "utf8");
  return created.jobId;
}

describe("文风蒸馏：进程重启后自动续跑", () => {
  it("模拟重启：running 且无执行者的任务从未完成批次自动续跑，跑完清零计数；同一进程只扫一次", async () => {
    const root = await bookRoot();
    const jobId = await orphanedJob(root, { batches: 3, doneBatches: 1 });
    const generateText = fakeModel();
    const resolveGenerator = vi.fn(async () => ({ generateText }));

    const outcome = await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator });
    expect(outcome).toMatchObject({ resumed: [jobId], failed: [], noModel: [], skipped: [] });
    await outcome!.settled;

    const job = await loadStyleDistillationJob(root, jobId);
    expect(job.status).toBe("ready");
    expect(job.batches.map((batch) => batch.status)).toEqual(["done", "done", "done"]);
    // 第一批在「重启前」已完成，不重跑：只调用剩下两批。
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(job.autoResume).toBeUndefined();
    expect(await inspectStyleDistillationLock(root, jobId)).toEqual({ kind: "none" });

    await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator });
    expect(resolveGenerator).toHaveBeenCalledTimes(1);
    expect(logs[0]!.mock.calls.map((call) => String(call[0])).join("\n")).toContain(`自动续跑任务 ${jobId}`);
  });

  it("续跑开始即落盘计数：执行中途进程再退出也算一次", async () => {
    const root = await bookRoot();
    const jobId = await orphanedJob(root, { batches: 1, failures: 1 });
    const seen: unknown[] = [];
    const generateText: RuntimeTextGenerator = async (request) => {
      seen.push((await loadStyleDistillationJob(root, jobId)).autoResume?.failures);
      return fakeModel()(request);
    };
    const outcome = await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator: async () => ({ generateText }) });
    await outcome!.settled;
    expect(seen).toEqual([2]);
    expect((await loadStyleDistillationJob(root, jobId)).autoResume).toBeUndefined();
  });

  it("防并发：另一进程持有活着的运行锁时不续跑、读视图照实显示 running；同时两次扫描只跑一份", async () => {
    const root = await bookRoot();
    const jobId = await orphanedJob(root, { batches: 2 });
    // 本机另一个活着的进程（父进程）持有运行锁。
    await writeFile(styleDistillationLockPath(root, jobId), `pid:${process.ppid} ts:${Date.now()} host:${encodeURIComponent(hostname())} token:other`, "utf8");
    const generateText = fakeModel();
    const outcome = await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator: async () => ({ generateText }) });
    expect(outcome).toMatchObject({ resumed: [], skipped: [jobId] });
    expect(generateText).not.toHaveBeenCalled();
    expect((await readStyleDistillationJob(root, jobId)).status).toBe("running");
    await expect(runStyleDistillationBatches({ bookRoot: root, jobId, generateText })).rejects.toMatchObject({ code: "STYLE_DISTILLATION_BUSY" });
    // 拿不到锁的执行者不碰任务文件。
    expect(JSON.parse(await readFile(jobFile(root, jobId), "utf8")).status).toBe("running");

    // 锁的主人退出（锁文件残留着一个不存在的进程号）：被判陈旧，两个并发扫描只有一个执行。
    await writeFile(styleDistillationLockPath(root, jobId), `pid:999999 ts:${Date.now()} host:${encodeURIComponent(hostname())} token:dead`, "utf8");
    resetStyleDistillationAutoResumeForTests();
    const { resumeOrphanedStyleDistillations } = await import("./style-distillation-auto-resume.js");
    const [first, second] = await Promise.all([
      resumeOrphanedStyleDistillations({ bookRoot: root, actorId: OWNER, resolveGenerator: async () => ({ generateText }) }),
      resumeOrphanedStyleDistillations({ bookRoot: root, actorId: OWNER, resolveGenerator: async () => ({ generateText }) }),
    ]);
    await Promise.all([first.settled, second.settled]);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect((await loadStyleDistillationJob(root, jobId)).status).toBe("ready");
  });

  it("他机持有运行锁时视为被占用，不按进程号回收", async () => {
    const root = await bookRoot();
    const jobId = await orphanedJob(root, { batches: 1 });
    await writeFile(styleDistillationLockPath(root, jobId), `pid:999999 ts:1 host:other-machine token:x`, "utf8");
    expect(await inspectStyleDistillationLock(root, jobId)).toMatchObject({ kind: "other-host", host: "other-machine" });
    const acquired = await acquireStyleDistillationLock(root, jobId);
    expect(acquired.ok).toBe(false);
    await expect(runStyleDistillationBatches({ bookRoot: root, jobId, generateText: fakeModel() }))
      .rejects.toThrow(/另一台电脑「other-machine」/u);
  });

  it("连续未完成达到上限：不再续跑，任务标 failed 并写明原因；手动继续会重新开放", async () => {
    const root = await bookRoot();
    const jobId = await orphanedJob(root, { batches: 1, failures: STYLE_DISTILLATION_AUTO_RESUME_MAX_FAILURES });
    const generateText = fakeModel();
    const outcome = await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator: async () => ({ generateText }) });
    expect(outcome).toMatchObject({ resumed: [], failed: [jobId] });
    expect(generateText).not.toHaveBeenCalled();
    const job = await loadStyleDistillationJob(root, jobId);
    expect(job.status).toBe("failed");
    expect(job.autoResume?.explanation?.what).toContain(`连续 ${STYLE_DISTILLATION_AUTO_RESUME_MAX_FAILURES} 次`);
    expect(job.batches[0]?.status).toBe("pending");

    // 再「重启」：failed 不再是候选。
    resetStyleDistillationAutoResumeForTests();
    expect(await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator: async () => ({ generateText }) })).toMatchObject({ resumed: [], failed: [] });

    const manual = await runStyleDistillationBatches({ bookRoot: root, jobId, generateText });
    expect(manual.job.status).toBe("ready");
    expect(manual.job.autoResume).toBeUndefined();
  });

  it("续跑执行抛错时计入次数并写明原因；累计到上限时转为 failed", async () => {
    const root = await bookRoot();
    const jobId = await orphanedJob(root, { batches: 1, failures: STYLE_DISTILLATION_AUTO_RESUME_MAX_FAILURES - 1 });
    // 来源快照丢失：执行者每次都会在同一处失败。
    await rm(join(root, STYLE_DISTILLATIONS_RELATIVE_DIR, `${jobId}.source.json`));
    const outcome = await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator: async () => ({ generateText: fakeModel() }) });
    expect(outcome?.resumed).toEqual([jobId]);
    await outcome!.settled;
    const job = await loadStyleDistillationJob(root, jobId);
    expect(job.status).toBe("failed");
    expect(job.autoResume).toMatchObject({ failures: STYLE_DISTILLATION_AUTO_RESUME_MAX_FAILURES, explanation: { what: expect.stringContaining("已停止自动续跑") } });
    expect(logs[2]!.mock.calls.map((call) => String(call[0])).join("\n")).toContain("来源快照");
  });

  it("没有可用模型：不续跑、不计失败，写明原因并停下，本进程不再重试", async () => {
    const root = await bookRoot();
    const jobId = await orphanedJob(root, { batches: 2 });
    const resolveGenerator = vi.fn(async () => ({ unavailableMessage: "还没有设置默认模型。" }));
    const outcome = await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator });
    expect(outcome).toMatchObject({ resumed: [], noModel: [jobId] });
    const job = await loadStyleDistillationJob(root, jobId);
    expect(job.status).toBe("paused");
    expect(job.autoResume).toMatchObject({ failures: 0, explanation: { what: expect.stringContaining("还没有设置默认模型") } });
    expect(job.batches.every((batch) => batch.status === "pending")).toBe(true);

    await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator });
    resetStyleDistillationAutoResumeForTests();
    // 「再重启」：任务已是 paused，不再当作孤儿任务，也不再去解析模型。
    await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator });
    expect(resolveGenerator).toHaveBeenCalledTimes(1);
    expect(logs[1]!.mock.calls.map((call) => String(call[0])).join("\n")).toContain("没有可用模型");
  });

  it("没有孤儿任务时不解析模型", async () => {
    const root = await bookRoot();
    await mkdir(join(root, STYLE_DISTILLATIONS_RELATIVE_DIR), { recursive: true });
    await createStyleDistillationJob({ bookRoot: root, bookId: "book-1", source: { sourceName: "旧稿", chapters: chapters(2) }, modelAvailable: false });
    const resolveGenerator = vi.fn(async () => ({ generateText: fakeModel() }));
    await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator });
    expect(resolveGenerator).not.toHaveBeenCalled();
  });

  it("只替发起人续跑：别人先来访不调模型、不改任务，也不吃掉发起人的那次扫描", async () => {
    const root = await bookRoot();
    const jobId = await orphanedJob(root, { batches: 2 });
    const visitorModel = fakeModel();
    const visitorResolve = vi.fn(async () => ({ generateText: visitorModel }));
    const visitor = await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: "visitor-2", resolveGenerator: visitorResolve });
    expect(visitor).toMatchObject({ resumed: [], notOwned: [jobId] });
    expect(visitorResolve).not.toHaveBeenCalled();
    expect(visitorModel).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(jobFile(root, jobId), "utf8")).status).toBe("running");

    // 没有登录身份的访问同样不续跑
    const anonymous = await ensureStyleDistillationAutoResume({ bookRoot: root, resolveGenerator: visitorResolve });
    expect(anonymous).toMatchObject({ resumed: [], notOwned: [jobId] });

    // 发起人随后来访：照常续跑
    const ownerModel = fakeModel();
    const owner = await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator: async () => ({ generateText: ownerModel }) });
    expect(owner).toMatchObject({ resumed: [jobId], notOwned: [] });
    await owner?.settled;
    expect(ownerModel).toHaveBeenCalled();
    expect((await loadStyleDistillationJob(root, jobId)).status).toBe("ready");
  });

  it("没有发起人记录的旧任务不自动续跑；有人手动继续后他成为发起人", async () => {
    const root = await bookRoot();
    const jobId = await orphanedJob(root, { batches: 1 });
    const raw = JSON.parse(await readFile(jobFile(root, jobId), "utf8"));
    delete raw.initiatorId;
    await writeFile(jobFile(root, jobId), JSON.stringify(raw), "utf8");
    const outcome = await ensureStyleDistillationAutoResume({ bookRoot: root, actorId: OWNER, resolveGenerator: async () => ({ generateText: fakeModel() }) });
    expect(outcome).toMatchObject({ resumed: [], notOwned: [jobId] });

    const manual = await runStyleDistillationBatches({ bookRoot: root, jobId, generateText: fakeModel(), initiatorId: "author-9" });
    expect(manual.job.initiatorId).toBe("author-9");
  });
});
