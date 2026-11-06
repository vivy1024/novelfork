import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
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
    const preview = await previewResponse.json() as { previewId: string; chapterCount: number; totalCharacters: number; estimate: { batchCount: number; maxOutputTokens: number; summary: string } };
    expect(preview).toMatchObject({ chapterCount: 2, totalCharacters: expect.any(Number), estimate: { batchCount: 1, maxOutputTokens: 16_000 } });
    expect(preview.estimate.summary).toContain("将调用模型 1 次");
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

    // 一键采纳推荐条目：任务视图给出推荐 id，接口按同一口径采纳并进入指南。
    const ready = await (await router.request(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}`)).json() as { recommendedRuleIds: string[] };
    expect(ready.recommendedRuleIds).toHaveLength(1);
    const missingRevision = await post(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}/adopt-recommended`, {});
    expect(missingRevision.status).toBe(400);
    const recommended = await post(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}/adopt-recommended`, { expectedRevision: null });
    expect(recommended.status).toBe(200);
    const adopted = await recommended.json() as { guideText: string; adoptedRuleIds: string[]; guideRuleCount: number };
    expect(adopted).toMatchObject({ adoptedRuleIds: ready.recommendedRuleIds, guideRuleCount: 1 });
    expect(adopted.guideText).toContain("用一个小动作收住情绪");
    // 没有推荐条目的任务（只有基线）拒绝一键采纳。
    const none = await post(`/api/books/book-a/style/distillations/jobs/${paused.job.jobId}/adopt-recommended`, { expectedRevision: (await loadStylePreset(bookRoot)).revision });
    expect(none.status).toBe(400);
  });

  it("任务级失败（来源快照缺失）写进任务，暂停时接口带出原因", async () => {
    const root = await mkdtemp(join(tmpdir(), "nf-style-distill-route-"));
    roots.push(root);
    const bookRoot = join(root, "book-a");
    await mkdir(bookRoot, { recursive: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const generateText = vi.fn(async () => ({ text: JSON.stringify({ rules: [] }) }));
      let available = false;
      const router = createStyleDistillationsRouter({
        state: { bookDir: () => bookRoot }, root, getSessionLlm: async () => undefined,
      } as unknown as RouterContext, { resolveBookRoot: () => bookRoot, resolveTextGenerator: async () => available ? generateText : undefined });
      const created = await (await router.request("/api/books/book-a/style/distillations/jobs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceName: "旧稿", text: "第一章 雨夜\n她停在门前，听见雨声。" }),
      })).json() as { job: { jobId: string } };
      await rm(join(bookRoot, "story", "style-distillations", `${created.job.jobId}.source.json`));
      available = true;
      await router.request(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}/resume`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      let view: { job: { status: string; lastError?: { what: string } }; explanation?: { what: string; next: string } } | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        view = await (await router.request(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}`)).json() as typeof view;
        if (view?.job.lastError) break;
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(view).toMatchObject({ job: { status: "paused" }, explanation: { what: expect.stringContaining("来源快照"), next: expect.stringContaining("重新粘贴") } });
      const list = await (await router.request("/api/books/book-a/style/distillations/jobs")).json() as { jobs: { explanation?: { what: string } }[] };
      expect(list.jobs[0]?.explanation?.what).toContain("来源快照");
    } finally {
      errorSpy.mockRestore();
    }
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

  it("模拟进程重启：第一次访问蒸馏接口时自动续跑上次未跑完的任务；比较接口带证据与任务 ID", async () => {
    const root = await mkdtemp(join(tmpdir(), "nf-style-distill-route-"));
    roots.push(root);
    const bookRoot = join(root, "book-a");
    await mkdir(bookRoot, { recursive: true });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const { createStyleDistillationJob } = await import("../engine/writing-layers/style-distillation-runner.js");
      const { resetStyleDistillationAutoResumeForTests } = await import("../engine/writing-layers/style-distillation-auto-resume.js");
      const created = await createStyleDistillationJob({ bookRoot, bookId: "book-a", source: { sourceName: "旧稿甲", text: "第一章 雨夜\n她停在门前，听见雨声。" }, modelAvailable: true, initiatorId: "author-1" });
      // 上一个进程跑到一半退出：任务文件停在 running，没有运行锁。
      const file = join(bookRoot, "story", "style-distillations", `${created.jobId}.json`);
      const raw = JSON.parse(await readFile(file, "utf8"));
      raw.status = "running";
      raw.batches[0].status = "running";
      await writeFile(file, JSON.stringify(raw), "utf8");
      resetStyleDistillationAutoResumeForTests();

      const generateText = vi.fn(async () => ({ text: JSON.stringify({ rules: [
        { category: "scene", text: "用一个小动作收住情绪", evidence: "她停在门前", transfer: "transferable", reason: "通用技法" },
      ] }) }));
      const inner = createStyleDistillationsRouter({
        state: { bookDir: () => bookRoot }, root, getSessionLlm: async () => undefined,
      } as unknown as RouterContext, { resolveBookRoot: () => bookRoot, resolveTextGenerator: async () => generateText });
      // 宿主在认证中间件里写入登录用户；自动续跑只替任务的发起人续跑。
      const router = new Hono();
      router.use("*", async (c, next) => { (c as unknown as { set(k: string, v: unknown): void }).set("user", { sub: "author-1" }); await next(); });
      router.route("", inner);

      let status = "";
      for (let attempt = 0; attempt < 50 && status !== "ready"; attempt += 1) {
        const list = await (await router.request("/api/books/book-a/style/distillations/jobs")).json() as { jobs: { status: string }[] };
        status = list.jobs[0]?.status ?? "";
        if (status !== "ready") await new Promise((done) => setTimeout(done, 10));
      }
      expect(status).toBe("ready");
      expect(generateText).toHaveBeenCalledTimes(1);

      const compare = await (await router.request("/api/books/book-a/style/distillations/compare")).json() as {
        sources: { jobId: string }[]; differences: { rules: { jobId: string; evidence: string }[] }[];
      };
      expect(compare.sources[0]?.jobId).toBe(created.jobId);
      expect(compare.differences[0]?.rules.some((rule) => rule.jobId === created.jobId && rule.evidence.includes("她停在门前"))).toBe(true);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("后台批次顶层失败（updateJob 自身失败）时落日志，留下任务 id 与错误，不再静默吞掉", async () => {
    const root = await mkdtemp(join(tmpdir(), "nf-style-distill-route-"));
    roots.push(root);
    const bookRoot = join(root, "book-a");
    await mkdir(bookRoot, { recursive: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const generateText = vi.fn(async () => {
        // 故障注入：后台运行到模型阶段时任务文件已丢，随后写批次结果的 updateJob 必然失败。
        const dir = join(bookRoot, "story", "style-distillations");
        for (const file of await readdir(dir)) {
          if (file.endsWith(".json")) await rm(join(dir, file), { force: true });
        }
        return { text: JSON.stringify({ rules: [] }) };
      });
      const router = createStyleDistillationsRouter({
        state: { bookDir: () => bookRoot }, root, getSessionLlm: async () => undefined,
      } as unknown as RouterContext, { resolveBookRoot: () => bookRoot, resolveTextGenerator: async () => generateText });

      const createdResponse = await router.request("/api/books/book-a/style/distillations/jobs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceName: "旧稿", text: "第一章 雨夜\n她停在门前，听见雨声。" }),
      });
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as { job: { jobId: string } };

      let logged = "";
      for (let attempt = 0; attempt < 100 && !logged; attempt += 1) {
        logged = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
        if (!logged) await new Promise((done) => setTimeout(done, 10));
      }
      expect(logged).toContain("[style-distillations]");
      expect(logged).toContain(created.job.jobId);
      expect(logged).toContain("蒸馏任务不存在或尚未保存");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
