// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createManuscriptImportRouter } from "./manuscript-import.js";
import type { HostTextGenerationAvailability } from "./context.js";
import { runManuscriptSettlement } from "../handlers/manuscript-import-service.js";
import { readChapterIndex } from "../engine/writing-resource/chapter-layout.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";

let storage: StorageDatabase;
let tempDir: string;
let bookRoot: string;

const para = (name: string) => `${name}推开门，屋里只有一盏灯。窗外的雨下得很密。`.repeat(30);
const manuscript = [
  "第一章 雨夜",
  para("林照"),
  "第二章 来客",
  para("沈默"),
  "第三章 旧信",
  para("林照"),
  "第四章 渡口",
  para("沈默"),
].join("\n");

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "novelfork-manuscript-route-"));
  bookRoot = join(tempDir, "book-1");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(bookRoot, "chapters"), { recursive: true }));
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({ id: "book-1", title: "旧稿", chapterWordCount: 3000, language: "zh", status: "outlining" }), "utf8");
  await writeFile(join(bookRoot, "chapters", "index.json"), "[]\n", "utf8");
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  storage.sqlite.prepare(`INSERT INTO "book" (id, name, created_at, updated_at) VALUES ('book-1', '旧稿', ?, ?)`).run(Date.now(), Date.now());
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

const unavailable = async (): Promise<HostTextGenerationAvailability> => ({
  available: false,
  code: "MODEL_NOT_CONFIGURED",
  message: "还没有设置默认模型。",
  suggestedAction: "在设置里配置 AI 供应商并选定默认模型后重试。",
});

function app(resolveTextGeneration: (c: unknown) => Promise<HostTextGenerationAvailability> = unavailable) {
  return createManuscriptImportRouter({ storage, resolveBookRoot: () => bookRoot, resolveTextGeneration });
}

async function upload(router: ReturnType<typeof app>, text = manuscript) {
  const form = new FormData();
  form.set("sourceName", "旧稿.txt");
  form.append("files", new File([text], "旧稿.txt", { type: "text/plain" }));
  const response = await router.request("/api/books/book-1/manuscript-import/jobs", { method: "POST", body: form });
  return { response, body: await response.json() as any };
}

async function post(router: ReturnType<typeof app>, path: string, body: unknown = {}) {
  const response = await router.request(`/api/books/book-1/manuscript-import/jobs/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as any };
}

describe("旧稿导入接口", () => {
  it("上传 → 预览 → 调整 → 确认写章；无模型时停在逐章事实并说明原因，仍可完成导入", async () => {
    const router = app();
    const created = await upload(router);
    expect(created.response.status).toBe(201);
    const jobId = created.body.job.jobId as string;
    expect(created.body.preview.chapterCount).toBe(4);
    expect(created.body.preview.chapters[0]).toMatchObject({ index: 1, title: "雨夜" });
    // 导入中：book.json 带任务标记；确认前不写任何章节。
    expect(JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")).manuscriptImportJobId).toBe(jobId);
    expect(await readChapterIndex(bookRoot)).toEqual([]);

    const renamed = await post(router, `${jobId}/plan-edits`, { expectedRevision: 1, edit: { op: "rename", index: 2, title: "不速之客" } });
    expect(renamed.response.status).toBe(200);
    expect(renamed.body.preview.chapters[1].title).toBe("不速之客");

    const stale = await post(router, `${jobId}/plan-edits`, { expectedRevision: 1, edit: { op: "merge", index: 3 } });
    expect(stale.response.status).toBe(409);
    expect(stale.body.explanation.suggestedAction).toContain("刷新");

    const merged = await post(router, `${jobId}/plan-edits`, { expectedRevision: 2, edit: { op: "merge", index: 3 } });
    expect(merged.body.preview.chapterCount).toBe(3);

    const confirmed = await post(router, `${jobId}/confirm`, { expectedRevision: 3 });
    expect(confirmed.response.status).toBe(200);
    expect(confirmed.body.job.phase).toBe("written");
    expect(confirmed.body.progress).toMatchObject({ total: 3, written: 3, settled: 0 });
    expect(confirmed.body.job.settlement.state).toBe("blocked");
    expect(confirmed.body.job.settlement.explanation.whatHappened).toContain("还没有设置默认模型");
    expect(confirmed.body.job.settlement.explanation.whyItMatters).toContain("没有用规则凑数");

    const index = await readChapterIndex(bookRoot);
    expect(index.map((entry) => [entry.number, entry.title])).toEqual([[1, "雨夜"], [2, "不速之客"], [3, "旧信"]]);
    expect(index.every((entry) => typeof entry.contentHash === "string")).toBe(true);
    const third = await readFile(join(bookRoot, "chapters", index[2]!.fileName), "utf8");
    expect(third.startsWith("# 旧信\n\n")).toBe(true);
    expect(third).toContain("第四章 渡口");
    // 没有模型：没有写入任何叙事事件。
    ensureNarrativeMemorySchema(storage);
    expect(storage.sqlite.prepare("SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = 'book-1'").get()).toEqual({ count: 0 });

    const retry = await post(router, `${jobId}/settle`);
    expect(retry.response.status).toBe(422);
    expect(retry.body.job.settlement.state).toBe("blocked");

    const again = await post(router, `${jobId}/confirm`, { expectedRevision: 3 });
    expect(again.response.status).toBe(409);

    const published = await post(router, `${jobId}/publish`);
    expect(published.response.status).toBe(200);
    expect(published.body.job.phase).toBe("published");
    expect(published.body.job.report).toMatchObject({ chapterCount: 3, settledChapters: 0, unsettledChapters: [1, 2, 3], eventCount: 0 });
    const config = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8"));
    expect(config.manuscriptImportJobId).toBeUndefined();
    expect(config.status).toBe("active");
  });

  it("有模型时逐章结算、记录进度并综合；失败章写进报告，可单独重跑", async () => {
    let calls = 0;
    const generation = async (): Promise<HostTextGenerationAvailability> => ({
      available: true,
      generateText: async (request) => {
        const user = request.messages.at(-1)?.content ?? "";
        if (request.messages[0]?.content.includes("叙事记忆结算器")) {
          calls += 1;
          if (user.includes("chapterNumber: 2\n")) return { text: "这不是 JSON" };
          const name = user.includes("沈默") ? "沈默" : "林照";
          return { text: JSON.stringify({ events: [{ eventType: "location_changed", subject: name, predicate: "所在", object: "屋里", evidenceText: `${name}推开门`, confidence: 0.9, source: "settle" }], mentionedEntities: [name] }) };
        }
        return { text: "{\"summary\":\"雨夜里有人推门进屋。\"}" };
      },
    });
    const router = app(generation);
    const { body } = await upload(router, manuscript);
    const jobId = body.job.jobId as string;
    // 用后台跑者之外的同一实现同步跑完，便于断言：先确认（会在后台起跑），再等它结束。
    const confirmed = await post(router, `${jobId}/confirm`, { expectedRevision: 1 });
    expect(confirmed.body.job.phase).toBe("written");
    const deadline = Date.now() + 20_000;
    let view: any;
    do {
      await new Promise((done) => setTimeout(done, 100));
      view = await (await router.request(`/api/books/book-1/manuscript-import/jobs/${jobId}`)).json();
    } while ((view.running || view.job.settlement.state === "running") && Date.now() < deadline);

    expect(calls).toBe(4);
    expect(view.progress).toMatchObject({ total: 4, settled: 3, failed: 1 });
    expect(view.job.settlement.state).toBe("done");
    expect(view.job.report.failedChapters).toEqual([expect.objectContaining({ chapterNumber: 2 })]);
    expect(view.job.report.failedChapters[0].reason).toContain("发生了什么");
    expect(view.job.report.eventCount).toBeGreaterThanOrEqual(3);
    // 书里没有人物条目：实体数为 0，但综合从正文统计起草了待确认人物（林照出现在第 1、3 章：2 条事件 + 2 章出场）。
    expect(view.job.report.entityCount).toBe(0);
    expect(view.job.report.characterDrafts).toMatchObject({ pending: 1, stagedThisRun: 1, threshold: 3 });
    expect(view.job.report.characterDrafts.items.map((item: { title: string }) => item.title)).toEqual(["林照"]);
    expect(view.job.report.characterDrafts.explanation.whyItMatters).toContain("实体图谱");
    expect(view.job.report.pendingReviewTotal).toBeGreaterThanOrEqual(1);

    // 重跑失败章：已完成的章不再调模型。
    const fixed = await runManuscriptSettlement(
      { bookId: "book-1", bookRoot, storage },
      jobId,
      {
        retryFailed: true,
        generateText: async (request) => request.messages[0]?.content.includes("叙事记忆结算器")
          ? { text: JSON.stringify({ events: [], mentionedEntities: ["沈默"] }) }
          : { text: "{\"summary\":\"沈默来访。\"}" },
      },
    );
    expect(fixed.chapters.map((chapter) => chapter.settle.status)).toEqual(["done", "done", "done", "done"]);
    expect(fixed.report?.failedChapters).toEqual([]);
  });

  it("中断后从未完成的章续跑", async () => {
    const router = app();
    const { body } = await upload(router);
    const jobId = body.job.jobId as string;
    await post(router, `${jobId}/confirm`, { expectedRevision: 1 });
    let calls = 0;
    const generateText = async (request: { messages: ReadonlyArray<{ content: string }> }) => {
      if (request.messages[0]?.content.includes("叙事记忆结算器")) calls += 1;
      return { text: request.messages[0]?.content.includes("叙事记忆结算器") ? "{\"events\":[],\"mentionedEntities\":[]}" : "{\"summary\":\"摘要\"}" };
    };
    const context = { bookId: "book-1", bookRoot, storage };
    const partial = await runManuscriptSettlement(context, jobId, { generateText, maxChapters: 2 });
    expect(partial.settlement.state).toBe("paused");
    expect(partial.chapters.map((chapter) => chapter.settle.status)).toEqual(["done", "done", "pending", "pending"]);
    const rest = await runManuscriptSettlement(context, jobId, { generateText });
    expect(calls).toBe(4);
    expect(rest.settlement.state).toBe("done");
    expect(rest.report?.settledChapters).toBe(4);
  });

  it("两本书共用书根时，另一本书的请求读不到、改不了、也列不出本书的导入任务", async () => {
    const router = app();
    const { body } = await upload(router);
    const jobId = body.job.jobId as string;
    const other = (path: string, init?: RequestInit) =>
      router.request(`/api/books/book-2/manuscript-import/jobs${path}`, init);
    const json = (payload: unknown): RequestInit => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect((await other(`/${jobId}`)).status).toBe(404);
    expect((await other(`/${jobId}/plan/chapters/1`)).status).toBe(404);
    expect((await other(`/${jobId}/resplit`, json({ mode: "rule" }))).status).toBe(404);
    expect((await other(`/${jobId}/plan-edits`, json({ expectedRevision: 1, edit: { op: "merge", index: 1 } }))).status).toBe(404);
    expect((await other(`/${jobId}/confirm`, json({ expectedRevision: 1 }))).status).toBe(404);
    expect((await other(`/${jobId}/publish`, json({}))).status).toBe(404);
    const listed = await other("") ;
    expect(((await listed.json()) as { jobs: unknown[] }).jobs).toEqual([]);

    // 越权确认被拒，没有写任何章节；本书自己的任务原样还在预览阶段
    expect(await readChapterIndex(bookRoot)).toEqual([]);
    const own = await router.request(`/api/books/book-1/manuscript-import/jobs/${jobId}`);
    expect(((await own.json()) as any).job.phase).toBe("preview");
  });

  it("预览阶段调 /settle 直接返回 409，不回 202 让前端空等", async () => {
    const generateText = async () => ({ text: "{}" });
    const router = app(async () => ({ available: true, generateText }) as unknown as HostTextGenerationAvailability);
    const { body } = await upload(router);
    const jobId = body.job.jobId as string;
    const settled = await post(router, `${jobId}/settle`, {});
    expect(settled.response.status).toBe(409);
    expect(settled.body.error.code).toBe("MANUSCRIPT_IMPORT_WRONG_PHASE");
    expect(settled.body.explanation.suggestedAction).toContain("确认");
    const view = await router.request(`/api/books/book-1/manuscript-import/jobs/${jobId}`);
    expect(((await view.json()) as any).running).toBe(false);
  });

  it("读取模型配置抛错时，原始异常文本不进响应也不进任务文件", async () => {
    const router = app(async () => {
      throw new Error("ECONNREFUSED http://10.0.0.5:8080 C:\\secret\\provider.json");
    });
    const { body } = await upload(router);
    const jobId = body.job.jobId as string;
    const confirmed = await post(router, `${jobId}/confirm`, { expectedRevision: 1 });
    expect(confirmed.response.status).toBe(200);
    const text = JSON.stringify(confirmed.body);
    expect(text).toContain("读取模型配置失败");
    expect(text).not.toContain("10.0.0.5");
    expect(text).not.toContain("secret");
  });

  it("请求体严格校验：坏 JSON、多余字段、未知操作、未知切分方式都返回 400，不按缺省值猜", async () => {
    const router = app();
    const { body } = await upload(router);
    const jobId = body.job.jobId as string;
    const raw = (path: string, text: string) => router.request(`/api/books/book-1/manuscript-import/jobs/${jobId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
    });
    expect((await raw("confirm", "{not json")).status).toBe(400);
    expect((await post(router, `${jobId}/confirm`, { expectedRevision: 1, extra: true })).response.status).toBe(400);
    expect((await post(router, `${jobId}/plan-edits`, { expectedRevision: 1, edit: { op: "delete", index: 1 } })).response.status).toBe(400);
    expect((await post(router, `${jobId}/plan-edits`, { expectedRevision: 1, edit: { op: "merge", index: 0 } })).response.status).toBe(400);
    expect((await post(router, `${jobId}/resplit`, { mode: "by-chapter" })).response.status).toBe(400);
    expect((await post(router, `${jobId}/settle`, { retryFailed: "yes" })).response.status).toBe(400);
    // 合法空请求体照常通过
    expect((await raw("resplit", "")).status).toBe(200);
  });

  it("任务文件里的 storedAs 指向任务目录外时拒绝读取，不读任务目录以外的文件", async () => {
    const router = app();
    const { body } = await upload(router);
    const jobId = body.job.jobId as string;
    const { readdir } = await import("node:fs/promises");
    const findJobFile = async (dir: string): Promise<string | null> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          const hit = await findJobFile(full);
          if (hit) return hit;
        } else if (entry.name === "job.json" && full.includes(jobId)) {
          return full;
        }
      }
      return null;
    };
    const jobFile = await findJobFile(bookRoot);
    expect(jobFile).toBeTruthy();
    const job = JSON.parse(await readFile(jobFile!, "utf8"));
    job.source.files[0].storedAs = "../../../book.json";
    await writeFile(jobFile!, JSON.stringify(job), "utf8");
    const resplit = await post(router, `${jobId}/resplit`, { mode: "rule" });
    expect(resplit.response.status).toBe(422);
    expect(resplit.body.error.code).toBe("MANUSCRIPT_IMPORT_CORRUPTED");
  });

  it("拒绝过大上传与未知任务", async () => {
    const router = app();
    const missing = await router.request("/api/books/book-1/manuscript-import/jobs/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
    const empty = await router.request("/api/books/book-1/manuscript-import/jobs", { method: "POST", body: new FormData() });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as any).explanation.whatHappened).toContain("没有收到");
  });
});
