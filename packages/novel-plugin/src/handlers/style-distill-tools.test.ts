import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTextGenerator, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";
import { executeStyleDistillationTool } from "./style-distill-tools.js";
import type { TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";
import { loadStylePreset, saveStylePreset } from "../engine/writing-layers/style-preset-store.js";
import { createStylePreset } from "../engine/writing-layers/style-preset.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

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

const model: RuntimeTextGenerator = vi.fn(async () => ({
  text: "```json\n" + JSON.stringify({ rules: [
    { category: "scene", text: "用一个小动作收住情绪，不直接说出感受", evidence: "她没有回头", transfer: "transferable", reason: "动作收束与题材无关" },
    { category: "voice", text: "旧信意象贯穿人物关系", evidence: "他把旧信压在杯底", transfer: "source-only", reason: "旧信是本作专属道具" },
  ] }) + "\n```",
}));

describe("叙述者文风蒸馏工具", () => {
  it("预览不落盘；启动任务经会话模型分批抽取，结果待审并可按可信书籍查询", async () => {
    const { root, binding } = await setup();
    const preview = await executeStyleDistillationTool("style.distill_preview", { sourceName: "旧稿", chapters }, binding, context());
    expect(preview.ok).toBe(true);
    expect(await import("node:fs/promises").then(({ readdir }) => readdir(join(root, "story")).catch(() => []))).toEqual([]);

    const lines: string[] = [];
    const started = await executeStyleDistillationTool("style_distill_start", { sourceName: "旧稿", chapters }, binding, context(model, (line) => lines.push(line)));
    expect(started).toMatchObject({ ok: true, data: { job: { status: "ready" }, batches: { total: 1, done: 1 }, expectedVersion: "" } });
    expect(model).toHaveBeenCalledTimes(1);
    expect(lines[0]).toContain("batch-001");
    const data = started.data as { job: { jobId: string; rules: { origin?: string; status: string }[] } };
    const modelRules = data.job.rules.filter((rule) => rule.origin === "model");
    expect(modelRules).toHaveLength(2);
    expect(modelRules.every((rule) => rule.status === "needs-review")).toBe(true);

    const status = await executeStyleDistillationTool("style.distill_status", { jobId: data.job.jobId }, binding, context());
    expect(status).toMatchObject({ ok: true, data: { job: { jobId: data.job.jobId, status: "ready" } } });
  });

  it("没有会话模型时保存基线并暂停，之后带 jobId 继续同一任务", async () => {
    const { binding } = await setup();
    const started = await executeStyleDistillationTool("style.distill_start", { sourceName: "旧稿", chapters }, binding, context());
    expect(started).toMatchObject({ ok: true, data: { job: { status: "paused" }, explanation: { what: expect.stringContaining("没有可用") } } });
    const jobId = (started.data as { job: { jobId: string } }).job.jobId;
    const resumed = await executeStyleDistillationTool("style.distill_start", { jobId }, binding, context(model));
    expect(resumed).toMatchObject({ ok: true, data: { job: { jobId, status: "ready" }, batches: { done: 1 } } });
  });

  it("对话采纳只写点名条目、复用 HTTP 同一采纳函数，版本不符返回 409 语义并带 explanation", async () => {
    const { root, binding } = await setup();
    const started = await executeStyleDistillationTool("style.distill_start", { sourceName: "旧稿", chapters }, binding, context(model));
    const job = (started.data as { job: { jobId: string; rules: { id: string; transfer: string; origin?: string }[] } }).job;
    const transferable = job.rules.find((rule) => rule.origin === "model" && rule.transfer === "transferable")!;

    const empty = await executeStyleDistillationTool("style.distill_adopt", { jobId: job.jobId, expectedVersion: "" }, binding, context());
    expect(empty).toMatchObject({ ok: false, error: "nothing-to-adopt" });

    const adopted = await executeStyleDistillationTool("style.distill_adopt", { jobId: job.jobId, ruleIds: [transferable.id], expectedVersion: "" }, binding, context());
    expect(adopted).toMatchObject({ ok: true, data: { guideRuleCount: 1, status: "adopted" } });
    expect((await loadStylePreset(root)).guideText).toContain("用一个小动作收住情绪");

    const version = (adopted.data as { expectedVersion: string }).expectedVersion;
    await saveStylePreset(root, { ...createStylePreset(), name: "作者刚改过" }, version);
    const conflict = await executeStyleDistillationTool("style.distill_adopt", { jobId: job.jobId, ruleIds: [transferable.id], expectedVersion: version }, binding, context());
    expect(conflict).toMatchObject({ ok: false, error: "STYLE_PRESET_CONFLICT", data: { status: 409, explanation: { next: expect.stringContaining("expectedVersion") } } });
    expect((await loadStylePreset(root)).preset?.name).toBe("作者刚改过");
  });

  it("缺少任务 ID、越过可信书籍或未知工具名会明确失败", async () => {
    const { root, binding } = await setup();
    expect(await executeStyleDistillationTool("style.distill_status", {}, binding, context())).toMatchObject({ ok: false, error: "job-id-required" });
    expect(await executeStyleDistillationTool("style.distill_adopt", { ruleIds: ["x"], expectedVersion: "" }, binding, context())).toMatchObject({ ok: false, error: "job-id-required" });
    const started = await executeStyleDistillationTool("style.distill_start", { sourceName: "旧稿", chapters }, binding, context());
    const jobId = (started.data as { job: { jobId: string } }).job.jobId;
    const foreign = await executeStyleDistillationTool("style.distill_status", { jobId }, { bookId: "book-2", root }, context());
    expect(foreign).toMatchObject({ ok: false, error: "STYLE_DISTILLATION_NOT_FOUND" });
    expect(await executeStyleDistillationTool("style.distill_delete", {}, binding, context())).toMatchObject({ ok: false, error: "unknown-style-distill-tool" });
  });
});
