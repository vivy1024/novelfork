import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createWritingModesRouter } from "./writing-modes.js";
import { MANUAL_STYLE_MEMORY_SOURCE_ID } from "../engine/writing-layers/style-memory.js";
import type { RouterContext } from "./context.js";

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "nf-style-memory-api-"));
  roots.push(root);
  const context = { state: { bookDir: (id: string) => join(root, id) }, root } as unknown as RouterContext;
  const app = new Hono().route("/", createWritingModesRouter(context));
  return { app, bookRoot: join(root, "book-a") };
}
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const DIALOGUE_TEXT = ["“车还来吗？”她问。", "“末班。”值班员头也没抬。", "“那还有一刻钟。”她看了看表。", "“你急什么？”"].join("\n");

describe("写法记忆 HTTP 契约", () => {
  it("预览返回推断规则、原文例句、场景标签与统计，不写任何文件", async () => {
    const { app } = await setup();
    const response = await app.request("/api/books/book-a/style/memories/preview", post({ text: DIALOGUE_TEXT, note: "对话节奏好" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.note).toBe("对话节奏好");
    expect(body.sceneTypes).toEqual(["dialogue"]);
    expect(body.rules[0]).toMatchObject({ origin: "note", text: "对话节奏好" });
    expect(body.rules.some((rule: { origin: string }) => rule.origin === "inferred")).toBe(true);
    expect(body.samples.length).toBeGreaterThan(0);
    expect(body.stats.sentenceCount).toBeGreaterThan(0);
    // 预览不写预设
    const preset = await (await app.request("/api/books/book-a/style/preset")).json();
    expect(preset).toMatchObject({ preset: null, revision: null });
  });

  it("空文本与超长文本的预览请求被拒绝", async () => {
    const { app } = await setup();
    const empty = await app.request("/api/books/book-a/style/memories/preview", post({ text: "  " }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ code: "STYLE_MEMORY_EMPTY_TEXT", explanation: { what: expect.any(String), why: expect.any(String), next: expect.any(String) } });
    const large = await app.request("/api/books/book-a/style/memories/preview", post({ text: "长".repeat(20_001) }));
    expect(large.status).toBe(400);
  });

  it("无版本号拒绝确认；确认后预设出现「手动写法记忆」来源且规则可再读回", async () => {
    const { app } = await setup();
    const noRevision = await app.request("/api/books/book-a/style/memories/confirm", post({ rules: [{ text: "短句为主。" }] }));
    expect(noRevision.status).toBe(400);
    const empty = await app.request("/api/books/book-a/style/memories/confirm", post({ expectedRevision: null }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ code: "STYLE_MEMORY_EMPTY_CONFIRM" });
    const badScene = await app.request("/api/books/book-a/style/memories/confirm", post({ expectedRevision: null, samples: [{ text: "例句。", sceneType: "landscape" }] }));
    expect(badScene.status).toBe(400);

    const confirmed = await app.request("/api/books/book-a/style/memories/confirm", post({
      expectedRevision: null,
      note: "这段对话收得干净",
      rules: [{ text: "对话密度高，以对话推进场景。", evidence: "“车还来吗？”她问。" }],
      samples: [{ text: "“车还来吗？”她问。", sceneType: "dialogue" }],
    }));
    expect(confirmed.status).toBe(200);
    const saved = await confirmed.json();
    expect(saved.preset.sources[0]).toMatchObject({ id: MANUAL_STYLE_MEMORY_SOURCE_ID, title: "手动写法记忆" });
    expect(saved.preset.sources[0].rules[0]).toMatchObject({ transfer: "transferable", status: "confirmed" });
    expect(saved.preset.sources[0].samples[0].sceneType).toBe("dialogue");
    expect(saved.guideText).toContain("对话密度高，以对话推进场景。");

    const reread = await (await app.request("/api/books/book-a/style/preset")).json();
    expect(reread.preset.sources[0].id).toBe(MANUAL_STYLE_MEMORY_SOURCE_ID);
    expect(reread.revision).toBe(saved.revision);
  });

  it("旧版本号确认返回 409，不覆盖新内容", async () => {
    const { app } = await setup();
    const first = await app.request("/api/books/book-a/style/memories/confirm", post({ expectedRevision: null, rules: [{ text: "短句。" }] }));
    expect(first.status).toBe(200);
    const conflict = await app.request("/api/books/book-a/style/memories/confirm", post({ expectedRevision: null, rules: [{ text: "另一条。" }] }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "STYLE_PRESET_CONFLICT" });
    const preset = await (await app.request("/api/books/book-a/style/preset")).json();
    expect(preset.preset.sources[0].rules).toHaveLength(1);
  });

  it("一键生成本书技能：无确认规则返回 422，确认后 200 并落盘 SKILL.md", async () => {
    const { app } = await setup();
    const empty = await app.request("/api/books/book-a/style/skill-export", post({}));
    expect(empty.status).toBe(422);
    expect(await empty.json()).toMatchObject({ code: "STYLE_SKILL_EXPORT_EMPTY", explanation: { what: expect.any(String), why: expect.any(String), next: expect.any(String) } });

    const confirmed = await app.request("/api/books/book-a/style/memories/confirm", post({
      expectedRevision: null,
      note: "短句收得住",
      rules: [{ text: "句子以短句为主。", evidence: "门开了。" }],
    }));
    expect(confirmed.status).toBe(200);
    const exported = await app.request("/api/books/book-a/style/skill-export", post({}));
    expect(exported.status).toBe(200);
    const body = await exported.json();
    expect(body.slug).toBe("book-style-memory");
    expect(body.ruleCount).toBe(1);
    expect(body.sourceTitles).toEqual(["手动写法记忆"]);
    expect(body.content).toContain("句子以短句为主。（来源：手动写法记忆）");
    expect(body.skill).toMatchObject({ slug: "book-style-memory", kind: "prose", mode: "manual" });
  });
});
