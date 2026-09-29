import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStyleDistillationsRouter } from "./style-distillations.js";
import { loadStylePreset } from "../engine/writing-layers/style-preset-store.js";
import type { RouterContext } from "./context.js";

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "nf-style-distill-route-"));
  roots.push(root);
  const bookRoot = join(root, "book-a");
  await mkdir(join(bookRoot, "chapters"), { recursive: true });
  const router = createStyleDistillationsRouter({
    state: { bookDir: (bookId: string) => join(root, bookId) },
    root,
    getSessionLlm: async () => undefined,
  } as unknown as RouterContext, { resolveBookRoot: () => bookRoot });
  return { router, bookRoot };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("文风自动蒸馏路由", () => {
  it("先预览范围，再生成可恢复来源包，采纳只进入预设", async () => {
    const { router, bookRoot } = await setup();
    const text = "第一章 雨夜\n她停在门前，听见雨声。\n\n第二章 灯下\n她把旧信压在杯底。";
    const previewResponse = await router.request("/api/books/book-a/style/distillations/preview", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceName: "参考稿", text }),
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { previewId: string; chapterCount: number; totalCharacters: number };
    expect(preview).toMatchObject({ chapterCount: 2, totalCharacters: expect.any(Number) });
    expect(await import("node:fs/promises").then(({ readdir }) => readdir(join(bookRoot, "story")).catch(() => []))).toEqual([]);

    const createdResponse = await router.request("/api/books/book-a/style/distillations/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { job: { jobId: string; status: string }; expectedRevision: string | null; result: { rules: unknown[]; samples: unknown[] } };
    // 测试上下文没有服务端模型：基线立即可审，模型批次暂停待叙述者会话继续。
    expect(created).toMatchObject({ job: { status: "paused" }, expectedRevision: null });
    expect(created.result.rules.length + created.result.samples.length).toBeGreaterThan(0);
    const job = await (await router.request(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}`)).json() as { job: { status: string } };
    expect(job.job.status).toBe("paused");

    const adoptedResponse = await router.request(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}/adopt`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: null, confirmedRuleIds: [], confirmedSampleIds: [] }),
    });
    expect(adoptedResponse.status).toBe(200);
    const preset = await loadStylePreset(bookRoot);
    expect(preset.source).toBe("preset");
    expect(preset.preset?.sources).toHaveLength(1);
    expect((await readFile(join(bookRoot, "story", "style_preset.json"), "utf8"))).toContain("参考稿");
  });

  it("注入服务端模型时后台分批抽取；没有模型时暂停并解释，恢复接口 422；对比接口并列多来源", async () => {
    const root = await mkdtemp(join(tmpdir(), "nf-style-distill-route-"));
    roots.push(root);
    const bookRoot = join(root, "book-a");
    await mkdir(bookRoot, { recursive: true });
    let available = true;
    const generateText = vi.fn(async () => ({ text: JSON.stringify({ rules: [
      { category: "scene", text: "用一个小动作收住情绪", evidence: "她停在门前", transfer: "transferable", reason: "通用技法" },
    ] }) }));
    const router = createStyleDistillationsRouter({
      state: { bookDir: () => bookRoot }, root, getSessionLlm: async () => undefined,
    } as unknown as RouterContext, { resolveBookRoot: () => bookRoot, resolveTextGenerator: async () => available ? generateText : undefined });
    const post = (path: string, body: unknown) => router.request(path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });

    const created = await (await post("/api/books/book-a/style/distillations/jobs", { sourceName: "旧稿甲", text: "第一章 雨夜\n她停在门前，听见雨声。" })).json() as { job: { jobId: string } };
    let view: { job: { status: string; rules: { origin?: string }[] }; batches: { done: number } } | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      view = await (await router.request(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}`)).json() as typeof view;
      if (view?.job.status === "ready") break;
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(view).toMatchObject({ job: { status: "ready" }, batches: { done: 1 } });
    expect(view!.job.rules.some((rule) => rule.origin === "model")).toBe(true);
    expect(generateText).toHaveBeenCalledTimes(1);

    available = false;
    const pausedResponse = await post("/api/books/book-a/style/distillations/jobs", { sourceName: "旧稿乙", text: "第一章 灯下\n他把旧信压在杯底。" });
    const paused = await pausedResponse.json() as { job: { jobId: string; status: string }; explanation?: { next: string } };
    expect(paused.job.status).toBe("paused");
    expect(paused.explanation?.next).toContain("style.distill_start");
    const resume = await post(`/api/books/book-a/style/distillations/jobs/${paused.job.jobId}/resume`, {});
    expect(resume.status).toBe(422);
    expect(await resume.json()).toMatchObject({ code: "STYLE_DISTILLATION_MODEL_UNAVAILABLE", explanation: { next: expect.stringContaining("jobId") } });

    const list = await (await router.request("/api/books/book-a/style/distillations/jobs")).json() as { jobs: unknown[] };
    expect(list.jobs).toHaveLength(2);
    const compare = await (await router.request("/api/books/book-a/style/distillations/compare")).json() as { sources: unknown[]; common: unknown[] };
    expect(compare.sources).toHaveLength(2);
    expect(Array.isArray(compare.common)).toBe(true);

    const adoptUnknown = await post(`/api/books/book-a/style/distillations/jobs/${paused.job.jobId}/adopt`, { expectedRevision: null, confirmedRuleIds: ["不存在"] });
    expect(adoptUnknown.status).toBe(400);
  });

  it("预览和作业拒绝过大或过期输入，采纳版本冲突返回 409", async () => {
    const { router } = await setup();
    const tooLarge = await router.request("/api/books/book-a/style/distillations/preview", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceName: "大文本", chapters: Array.from({ length: 201 }, (_, i) => ({ number: i + 1, content: "正文" })) }),
    });
    expect(tooLarge.status).toBe(400);
    const expired = await router.request("/api/books/book-a/style/distillations/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: "missing-preview" }),
    });
    expect(expired.status).toBe(404);
    const created = await (await router.request("/api/books/book-a/style/distillations/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceName: "参考稿", text: "第一章 雨夜\n她停在门前，听见雨声。" }),
    })).json() as { job: { jobId: string } };
    const conflict = await router.request(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}/adopt`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: "0".repeat(64), confirmedRuleIds: [], confirmedSampleIds: [] }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "STYLE_PRESET_CONFLICT", explanation: { what: expect.any(String) } });
  });
});
