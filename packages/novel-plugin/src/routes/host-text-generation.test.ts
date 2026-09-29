/**
 * 宿主提供的服务端文本生成（RouterContext.resolveTextGeneration）接到网页路由上的行为：
 * 有模型时直接生成，没有模型时退回预览 / 暂停 / 规则初稿并带 explanation，模型报错时不崩。
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { createCharacterVoiceRouter } from "./character-voice.js";
import type { HostTextGenerationAvailability, HostTextGenerator, RouterContext } from "./context.js";
import { createStyleDistillationsRouter } from "./style-distillations.js";
import { createWritingModesRouter } from "./writing-modes.js";

const NOT_CONFIGURED: HostTextGenerationAvailability = {
  available: false,
  code: "MODEL_NOT_CONFIGURED",
  message: "Runtime 还没有设置默认模型。",
  suggestedAction: "在设置里配置 AI 供应商并选定默认模型后重试。",
};

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function routerContext(root: string, resolveTextGeneration?: RouterContext["resolveTextGeneration"]): RouterContext {
  return {
    state: { bookDir: (bookId: string) => join(root, bookId) },
    root,
    broadcast: () => undefined,
    buildPipelineConfig: async () => { throw new Error("不应再走 pipeline 配置"); },
    getSessionLlm: async () => { throw new Error("不应再读取会话供应商配置"); },
    ...(resolveTextGeneration ? { resolveTextGeneration } : {}),
  } as unknown as RouterContext;
}

const post = (body: unknown): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("写作模式接宿主文本生成", () => {
  it("有模型时直接生成，返回宿主报告的模型与用量", async () => {
    const root = await tempRoot("nf-host-gen-");
    const generateText = vi.fn<HostTextGenerator>(async () => ({
      text: "雨还在下。", model: "anthropic:main", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }));
    const app = createWritingModesRouter(routerContext(root, async () => ({ available: true, model: "anthropic:main", generateText })));

    const response = await app.request("/api/books/book-a/inline-write", post({ mode: "continuation", selectedText: "她停在门前。" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: "generated", writingMode: "continuation", content: "雨还在下。", model: "anthropic:main",
      usage: { totalTokens: 15 }, bookId: "book-a",
    });
    const request = generateText.mock.calls[0]![0];
    expect(request.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(request).toMatchObject({ temperature: 0.7, maxTokens: 2048 });

    const variants = await (await app.request("/api/books/book-a/variants/generate", post({ selectedText: "她停在门前。", count: 2 }))).json();
    expect(variants).toMatchObject({ mode: "generated", count: 2, model: "anthropic:main" });
    expect(generateText).toHaveBeenCalledTimes(3);
  });

  it("没有模型时退回提示词预览并说明原因；execute-prompt 直接 422", async () => {
    const root = await tempRoot("nf-host-gen-");
    const app = createWritingModesRouter(routerContext(root, async () => NOT_CONFIGURED));

    const preview = await (await app.request("/api/books/book-a/dialogue/generate", post({ characters: [{ name: "陆沉" }], scene: "雨夜" }))).json();
    expect(preview).toMatchObject({
      mode: "prompt-preview", reason: "model-unavailable", modelUnavailableCode: "MODEL_NOT_CONFIGURED",
      explanation: { what: NOT_CONFIGURED.message, next: NOT_CONFIGURED.suggestedAction },
    });
    expect(preview.promptPreview).toEqual(expect.any(String));

    const execute = await app.request("/api/books/book-a/writing-modes/execute-prompt", post({ prompt: "写一段雨夜" }));
    expect(execute.status).toBe(422);
    expect(await execute.json()).toMatchObject({ code: "MODEL_UNAVAILABLE", explanation: { what: NOT_CONFIGURED.message } });
  });

  it("宿主不提供文本生成或读取失败时同样按无模型处理，不碰旧的供应商配置", async () => {
    const root = await tempRoot("nf-host-gen-");
    const noHost = createWritingModesRouter(routerContext(root));
    expect(await (await noHost.request("/api/books/book-a/outline/branch", post({}))).json()).toMatchObject({
      mode: "prompt-preview", modelUnavailableCode: "MODEL_HOST_UNSUPPORTED", explanation: { what: expect.any(String) },
    });

    const broken = createWritingModesRouter(routerContext(root, async () => { throw new Error("设置损坏"); }));
    expect(await (await broken.request("/api/books/book-a/inline-write", post({ mode: "polish", selectedText: "x" }))).json()).toMatchObject({
      mode: "prompt-preview", modelUnavailableCode: "MODEL_STATUS_FAILED", explanation: { what: expect.stringContaining("设置损坏") },
    });
  });

  it("模型调用失败返回 502 与说明，不写任何内容", async () => {
    const root = await tempRoot("nf-host-gen-");
    const app = createWritingModesRouter(routerContext(root, async () => ({
      available: true, model: "anthropic:main", generateText: async () => { throw new Error("上游超时"); },
    })));
    const response = await app.request("/api/books/book-a/outline/branch/b1/expand", post({ title: "分支" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "MODEL_REQUEST_FAILED", model: "anthropic:main", explanation: { what: expect.stringContaining("上游超时") },
    });
  });
});

describe("网页文风蒸馏接宿主文本生成", () => {
  it("新建任务后直接在后台跑模型批次；没有模型时暂停并写明原因与去处", async () => {
    const root = await tempRoot("nf-host-distill-");
    const bookRoot = join(root, "book-a");
    await mkdir(bookRoot, { recursive: true });
    let availability: HostTextGenerationAvailability = {
      available: true,
      model: "anthropic:main",
      generateText: vi.fn<HostTextGenerator>(async () => ({ text: JSON.stringify({ rules: [
        { category: "scene", text: "用一个小动作收住情绪", evidence: "她停在门前", transfer: "transferable", reason: "通用技法" },
      ] }), model: "anthropic:main" })),
    };
    const app = createStyleDistillationsRouter(routerContext(root, async () => availability), { resolveBookRoot: () => bookRoot });

    const created = await (await app.request("/api/books/book-a/style/distillations/jobs", post({ sourceName: "旧稿甲", text: "第一章 雨夜\n她停在门前，听见雨声。" }))).json() as { job: { jobId: string } };
    let status = "";
    for (let attempt = 0; attempt < 50 && status !== "ready"; attempt += 1) {
      const view = await (await app.request(`/api/books/book-a/style/distillations/jobs/${created.job.jobId}`)).json() as { job: { status: string } };
      status = view.job.status;
      if (status !== "ready") await new Promise((done) => setTimeout(done, 10));
    }
    expect(status).toBe("ready");

    availability = NOT_CONFIGURED;
    const paused = await (await app.request("/api/books/book-a/style/distillations/jobs", post({ sourceName: "旧稿乙", text: "第一章 灯下\n他把旧信压在杯底。" }))).json() as {
      job: { jobId: string; status: string }; explanation?: { what: string; next: string };
    };
    expect(paused.job.status).toBe("paused");
    expect(paused.explanation?.what).toContain(NOT_CONFIGURED.message);
    expect(paused.explanation?.next).toContain(NOT_CONFIGURED.suggestedAction);
    expect(paused.explanation?.next).toContain("jobId");

    const resume = await app.request(`/api/books/book-a/style/distillations/jobs/${paused.job.jobId}/resume`, post({}));
    expect(resume.status).toBe(422);
    expect(await resume.json()).toMatchObject({
      code: "STYLE_DISTILLATION_MODEL_UNAVAILABLE",
      error: expect.stringContaining(NOT_CONFIGURED.message),
      explanation: { next: expect.stringContaining("jobId") },
    });
  });
});

describe("角色声线草稿接宿主文本生成", () => {
  let storage: StorageDatabase | undefined;
  afterEach(() => { storage?.close(); storage = undefined; });

  it("没有模型时保留规则初稿，说明里带宿主给出的原因与建议", async () => {
    const root = await tempRoot("nf-host-voice-");
    const bookRoot = join(root, "book-1");
    await mkdir(join(bookRoot, "chapters"), { recursive: true });
    storage = createStorageDatabase({ databasePath: join(root, "novelfork.db") });
    runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
    const now = new Date("2026-09-01T00:00:00.000Z");
    await createBookRepository(storage).create({ id: "book-1", name: "声线测试", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
    await createStoryJingweiSectionRepository(storage).create({
      id: "sec-1", bookId: "book-1", key: "characters", name: "角色", description: "", icon: null, order: 1, enabled: true,
      showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: "characters",
      sourceTemplate: null, createdAt: now, updatedAt: now,
    });
    const entry = await createStoryJingweiEntryRepository(storage).create({
      id: crypto.randomUUID(), bookId: "book-1", sectionId: "sec-1", title: "陆沉", contentMd: "", category: "characters",
      fields: { personality: "沉默寡言" }, customFields: {}, tags: [], aliases: [], relatedChapterNumbers: [], relatedEntryIds: [],
      visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: "dynamic", status: "confirmed",
      createdAt: now, updatedAt: now,
    });
    const resolveGenerateText = vi.fn(async () => undefined);
    const app = new Hono().route("/", createCharacterVoiceRouter({
      storage, resolveBookRoot: () => bookRoot, resolveTextGeneration: async () => NOT_CONFIGURED, resolveGenerateText,
    }));

    const response = await (await app.request(`/api/books/book-1/jingwei/entries/${entry.id}/voice/draft`, post({ expectedVersion: entry.version, useModel: true }))).json();
    expect(response.draft.modelUsed).toBe(false);
    const warning = response.warnings.find((item: { code: string }) => item.code === "MODEL_UNAVAILABLE");
    expect(warning.explanation).toMatchObject({
      whatHappened: NOT_CONFIGURED.message,
      suggestedAction: expect.stringContaining(NOT_CONFIGURED.suggestedAction),
    });
    // 给了宿主文本生成就不再看旧的注入口。
    expect(resolveGenerateText).not.toHaveBeenCalled();
  });
});
