import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import {
  loadStyleDistillationJob,
  planStyleDistillationBatches,
  STYLE_DISTILLATIONS_RELATIVE_DIR,
} from "./style-distillation.js";
import { locateStyleEvidence, parseStyleDistillationBatchOutput } from "./style-distillation-model.js";
import {
  adoptStyleDistillation,
  createStyleDistillationJob,
  readStyleDistillationJob,
  runStyleDistillationBatches,
} from "./style-distillation-runner.js";
import { loadStylePreset, saveStylePreset } from "./style-preset-store.js";
import { createStylePreset } from "./style-preset.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function bookRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nf-style-runner-"));
  roots.push(root);
  return root;
}

// 每章都有一句可被逐字引用的证据；章节足够长，按 12000 字预算会切成多批。
function chapters(count: number, size = 5_000) {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    title: `第${index + 1}章`,
    content: `她把伞收起来，雨水顺着伞骨滴进鞋里${index + 1}。${"风从巷口灌进来，灯影晃了一下。".repeat(Math.ceil(size / 16))}`,
  }));
}

function chapterNumbersFromPrompt(content: string): number[] {
  return [...content.matchAll(/### 第(\d+)章/gu)].map((match) => Number(match[1]));
}

/** 假模型：按提示里出现的章节号回两条规则，证据取自该章原文。 */
function fakeModel(overrides: Record<number, string> = {}): RuntimeTextGenerator & ReturnType<typeof vi.fn> {
  return vi.fn(async (request: Parameters<RuntimeTextGenerator>[0]) => {
    const user = request.messages.find((message) => message.role === "user")?.content ?? "";
    const numbers = chapterNumbersFromPrompt(user);
    const first = numbers[0]!;
    if (overrides[first] !== undefined) return { text: overrides[first]! };
    return {
      text: JSON.stringify({
        rules: [
          {
            category: "scene",
            text: `用具体的身体感受开场（批次起于第${first}章）`,
            evidence: `雨水顺着伞骨滴进鞋里${first}`,
            transfer: "transferable",
            reason: "身体感受开场与题材无关",
          },
          {
            category: "rhythm",
            text: "环境句短促重复，制造压迫感",
            evidence: "风从巷口灌进来，灯影晃了一下。",
            transfer: "source-only",
            reason: "该重复句式是本作标志",
          },
        ],
      }),
    };
  }) as unknown as RuntimeTextGenerator & ReturnType<typeof vi.fn>;
}

describe("文风蒸馏模型批次", () => {
  it("按字数预算与章数上限切批，只收非空章节", () => {
    const batches = planStyleDistillationBatches([
      ...chapters(7, 5_000),
      { number: 8, title: "空章", content: "" },
      { number: 9, title: "短章", content: "短。" },
    ]);
    expect(batches.map((batch) => batch.chapterNumbers)).toEqual([[1, 2], [3, 4], [5, 6], [7, 9]]);
    expect(batches.every((batch) => batch.status === "pending" && batch.attempts === 0)).toBe(true);
  });

  it("模型输出经 zod 校验：坏 JSON、缺字段都判失败并带 explanation，证据找不到的条目记入 issues", () => {
    const source = chapters(1, 100);
    const badJson = parseStyleDistillationBatchOutput("这不是 JSON", source);
    expect(badJson).toMatchObject({ ok: false, explanation: { what: expect.stringContaining("JSON"), why: expect.any(String), next: expect.any(String) } });
    const missing = parseStyleDistillationBatchOutput(JSON.stringify({ rules: [{ text: "只有文本" }] }), source);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.explanation.what).toContain("rules.0");
    const fabricated = parseStyleDistillationBatchOutput(JSON.stringify({ rules: [{
      category: "voice", text: "第一人称贴身叙述", evidence: "原文根本没有这句话", transfer: "transferable", reason: "通用",
    }] }), source);
    expect(fabricated).toMatchObject({ ok: true, rules: [] });
    if (fabricated.ok) expect(fabricated.issues[0]).toContain("证据未在本批原文中逐字找到");
    expect(locateStyleEvidence("她把伞收起来……滴进鞋里1", source)).toBe(1);
  });

  it("分批调用模型并逐批落盘；结果一律待审、带证据与迁移判断；统计指纹保留", async () => {
    const root = await bookRoot();
    const created = await createStyleDistillationJob({ bookRoot: root, bookId: "book-1", source: { sourceName: "旧稿", chapters: chapters(4) }, modelAvailable: true });
    expect(created.status).toBe("paused");
    expect(created.batches).toHaveLength(2);
    expect(created.fingerprint).not.toBeNull();

    const generateText = fakeModel();
    const run = await runStyleDistillationBatches({ bookRoot: root, jobId: created.jobId, generateText });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(run.job.status).toBe("ready");
    expect(run.summary).toMatchObject({ total: 2, done: 2, failed: 0, pending: 0 });
    const modelRules = run.job.rules.filter((rule) => rule.origin === "model");
    // 第二批的 rhythm 规则与第一批重复，合并后记入 issues，而不是静默丢弃。
    expect(modelRules).toHaveLength(3);
    expect(modelRules.every((rule) => rule.status === "needs-review")).toBe(true);
    expect(modelRules.map((rule) => rule.transfer)).toContain("source-only");
    expect(modelRules[0]).toMatchObject({ category: "scene", evidence: "第1章原文：「雨水顺着伞骨滴进鞋里1」", batchId: "batch-001" });
    expect(run.job.batches[1]?.issues.join("")).toContain("重复");
    expect(run.job.fingerprint).toEqual(created.fingerprint);

    const stored = await loadStyleDistillationJob(root, created.jobId);
    expect(stored.batches.map((batch) => batch.status)).toEqual(["done", "done"]);
  });

  it("失败批次带 explanation；中断后从未完成批次恢复，retryFailed 才重跑失败批", async () => {
    const root = await bookRoot();
    const created = await createStyleDistillationJob({ bookRoot: root, bookId: "book-1", source: { sourceName: "旧稿", chapters: chapters(6) }, modelAvailable: true });
    expect(created.batches).toHaveLength(3);

    const broken = fakeModel({ 1: "{\"rules\": [{\"category\": \"voice\"}]}" });
    const first = await runStyleDistillationBatches({ bookRoot: root, jobId: created.jobId, generateText: broken, maxBatches: 2 });
    expect(first.processedBatchIds).toEqual(["batch-001", "batch-002"]);
    expect(first.job.status).toBe("paused");
    expect(first.job.batches[0]).toMatchObject({ status: "failed", attempts: 1, explanation: { what: expect.stringContaining("不符合规则格式") } });
    expect(first.summary.failures[0]?.explanation?.next).toBeTruthy();

    // 模拟进程在第三批进行中退出：磁盘上残留 running，读视图应呈现为待处理、可恢复。
    const file = join(root, STYLE_DISTILLATIONS_RELATIVE_DIR, `${created.jobId}.json`);
    const raw = JSON.parse(await readFile(file, "utf8"));
    raw.status = "running";
    raw.batches[2].status = "running";
    await writeFile(file, JSON.stringify(raw), "utf8");
    const view = await readStyleDistillationJob(root, created.jobId);
    expect(view.status).toBe("paused");
    expect(view.batches[2]?.status).toBe("pending");

    const resumed = await runStyleDistillationBatches({ bookRoot: root, jobId: created.jobId, generateText: fakeModel() });
    expect(resumed.processedBatchIds).toEqual(["batch-003"]);
    expect(resumed.job.status).toBe("ready");
    expect(resumed.job.batches[0]?.status).toBe("failed");

    const retried = await runStyleDistillationBatches({ bookRoot: root, jobId: created.jobId, generateText: fakeModel(), retryFailed: true });
    expect(retried.processedBatchIds).toEqual(["batch-001"]);
    expect(retried.job.batches[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(retried.job.batches[0]?.explanation).toBeUndefined();
  });

  it("模型调用抛错时本批失败，其余批次继续；同一任务不允许并发运行", async () => {
    const root = await bookRoot();
    const created = await createStyleDistillationJob({ bookRoot: root, bookId: "book-1", source: { sourceName: "旧稿", chapters: chapters(4) }, modelAvailable: true });
    let calls = 0;
    const flaky: RuntimeTextGenerator = async (request) => {
      calls += 1;
      if (calls === 1) throw new Error("上游超时");
      return fakeModel()(request);
    };
    const running = runStyleDistillationBatches({ bookRoot: root, jobId: created.jobId, generateText: flaky });
    await expect(runStyleDistillationBatches({ bookRoot: root, jobId: created.jobId, generateText: flaky }))
      .rejects.toMatchObject({ code: "STYLE_DISTILLATION_BUSY" });
    const result = await running;
    expect(result.job.batches[0]).toMatchObject({ status: "failed", explanation: { what: "模型调用失败：上游超时" } });
    expect(result.job.batches[1]?.status).toBe("done");
  });

  it("来源快照被改动时拒绝恢复", async () => {
    const root = await bookRoot();
    const created = await createStyleDistillationJob({ bookRoot: root, bookId: "book-1", source: { sourceName: "旧稿", chapters: chapters(2) }, modelAvailable: false });
    const snapshot = join(root, STYLE_DISTILLATIONS_RELATIVE_DIR, `${created.jobId}.source.json`);
    const raw = JSON.parse(await readFile(snapshot, "utf8"));
    raw.chapters[0].content = "被替换的正文";
    await writeFile(snapshot, JSON.stringify(raw), "utf8");
    await expect(runStyleDistillationBatches({ bookRoot: root, jobId: created.jobId, generateText: fakeModel() }))
      .rejects.toMatchObject({ code: "STYLE_DISTILLATION_SOURCE_MISSING" });
    expect((await readStyleDistillationJob(root, created.jobId)).status).toBe("paused");
  });

  it("采纳只写入点名条目；可迁移且确认的进入指南，作品专属只存证据；版本不符与未知 ID 被拒绝", async () => {
    const root = await bookRoot();
    const created = await createStyleDistillationJob({ bookRoot: root, bookId: "book-1", source: { sourceName: "旧稿", chapters: chapters(2) }, modelAvailable: true });
    const run = await runStyleDistillationBatches({ bookRoot: root, jobId: created.jobId, generateText: fakeModel() });
    const transferable = run.job.rules.find((rule) => rule.origin === "model" && rule.transfer === "transferable")!;
    const sourceOnly = run.job.rules.find((rule) => rule.origin === "model" && rule.transfer === "source-only")!;
    const untouched = run.job.rules.find((rule) => rule.origin === "baseline")!;

    await expect(adoptStyleDistillation({ bookRoot: root, jobId: created.jobId, ruleIds: ["不存在"], sampleIds: [], expectedRevision: null }))
      .rejects.toMatchObject({ code: "STYLE_DISTILLATION_INVALID_INPUT" });

    const result = await adoptStyleDistillation({ bookRoot: root, jobId: created.jobId, ruleIds: [transferable.id, sourceOnly.id], sampleIds: [], expectedRevision: null });
    expect(result).toMatchObject({ guideRuleCount: 1, sourceOnlyCount: 1, job: { status: "adopted" } });
    expect(result.preset.guideText).toContain(transferable.text);
    expect(result.preset.guideText).not.toContain(sourceOnly.text);
    const source = result.preset.preset!.sources[0]!;
    expect(source.rules.map((rule) => rule.text)).toEqual([transferable.text, sourceOnly.text]);
    expect(source.rules.map((rule) => rule.text)).not.toContain(untouched.text);

    // 预设被别处改过：旧版本号采纳必须冲突，不覆盖。
    await saveStylePreset(root, { ...createStylePreset(), name: "作者改过" }, result.preset.revision);
    await expect(adoptStyleDistillation({ bookRoot: root, jobId: created.jobId, ruleIds: [transferable.id], sampleIds: [], expectedRevision: result.preset.revision }))
      .rejects.toMatchObject({ code: "STYLE_PRESET_CONFLICT" });
    expect((await loadStylePreset(root)).preset?.name).toBe("作者改过");
  });
});
