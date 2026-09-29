import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createWritingModesRouter } from "./writing-modes.js";
import { createWritingToolsRouter } from "./writing-tools.js";
import { createStylePreset } from "../engine/writing-layers/style-preset.js";
import { resolveWritingLayers } from "../engine/writing-layers/layer-store.js";
import type { RouterContext } from "./context.js";

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "nf-style-api-")); roots.push(root);
  const bookRoot = join(root, "book-a");
  await mkdir(join(bookRoot, "story"), { recursive: true });
  const context = { state: { bookDir: (id: string) => join(root, id), loadBookConfig: async () => ({}) }, root } as RouterContext;
  const app = new Hono().route("/", createWritingModesRouter(context)).route("/", createWritingToolsRouter(context));
  return { app, bookRoot };
}
const request = (body: unknown, method = "PUT") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("文风预设 HTTP 契约", () => {
  it("保存与读取使用同一份预设，并贯通写作指南和统计兼容接口", async () => {
    const { app, bookRoot } = await setup();
    expect(await (await app.request("/api/books/book-a/style/preset")).json()).toMatchObject({ preset: null, revision: null });
    const preset = createStylePreset({ avgSentenceLength: 20, sentenceLengthStdDev: 6, vocabularyDiversity: 0.8 });
    preset.bookVoice.tone = "朴实、少解释";
    const saved = await app.request("/api/books/book-a/style/preset", request({ expectedRevision: null, preset }));
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.guideText).toContain("朴实、少解释");
    expect(body.revision).toEqual(expect.any(String));
    const profile = await (await app.request("/api/books/book-a/style/profile")).json();
    expect(profile.profile.avgSentenceLength).toBe(20);
    expect(profile.guideText).toBe(body.guideText);
    expect((await resolveWritingLayers({ bookRoot })).styleGuideText).toBe(body.guideText);
    expect(await (await app.request("/api/books/book-b/style/preset")).json()).toMatchObject({ preset: null });
  });

  it("无版本拒绝保存，旧版本返回 409，非法字段返回 400", async () => {
    const { app } = await setup(); const path = "/api/books/book-a/style/preset";
    const preset = createStylePreset();
    expect((await app.request(path, request({ preset }))).status).toBe(400);
    expect((await app.request(path, request({ expectedRevision: null, preset: { ...preset, name: "" } }))).status).toBe(400);
    expect((await app.request(path, request({ expectedRevision: null, preset }))).status).toBe(200);
    expect((await app.request(path, request({ expectedRevision: null, preset }))).status).toBe(409);
  });

  it("参考样文重提取不丢作者指南，预览不会写文件，漂移检测读新基线", async () => {
    const { app, bookRoot } = await setup();
    const preset = createStylePreset(); preset.generalRules = ["让对话留白"];
    await app.request("/api/books/book-a/style/preset", request({ expectedRevision: null, preset }));
    const file = join(bookRoot, "story", "style_preset.json");
    const before = await readFile(file, "utf8");
    const samples = ["风过树梢。她停住脚步，半晌才说：‘回来就好。’"];
    await app.request("/api/books/book-a/style/distill", request({ samples, persist: false }, "POST"));
    expect(await readFile(file, "utf8")).toBe(before);
    const result = await app.request("/api/books/book-a/style/distill", request({ samples }, "POST"));
    expect(result.status).toBe(200);
    const { profile } = await result.json();
    const saved = await (await app.request("/api/books/book-a/style/preset")).json();
    expect(saved.preset.generalRules).toEqual(["让对话留白"]);
    expect(saved.preset.fingerprint).toEqual(profile);
    const drift = await app.request("/api/books/book-a/style/drift-check", request({ current: profile, base: "auto" }, "POST"));
    expect((await drift.json()).base).toEqual(profile);
  });

  it("坏文件明确报错并保留内容，不显示为未配置", async () => {
    const { app, bookRoot } = await setup();
    const path = join(bookRoot, "story", "style_preset.json"); await writeFile(path, "invalid");
    const response = await app.request("/api/books/book-a/style/profile");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "STYLE_PRESET_CORRUPTED" });
    expect(await readFile(path, "utf8")).toBe("invalid");
  });

  it.each(["rhythm", "tone-check"])("%s 遇到损坏预设时返回可识别的错误与修复说明", async (action) => {
    const { app, bookRoot } = await setup();
    const path = join(bookRoot, "story", "style_preset.json");
    await writeFile(path, "invalid");
    const response = await app.request(`/api/books/book-a/chapters/1/${action}`, request({ content: "雨停了。他望向窗外。" }, "POST"));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "STYLE_PRESET_CORRUPTED", explanation: {
      what: expect.any(String), why: expect.any(String), next: expect.any(String),
    } });
    expect(await readFile(path, "utf8")).toBe("invalid");
  });
});
