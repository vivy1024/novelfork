import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDissectLibraryRouter } from "./dissect-library";
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "dissect-route-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const base = "/api/books/trusted/dissect-library";
const json = (body: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
it("可信书根下完整 HTTP 建库、读写、列树、删除", async () => {
  const app = createDissectLibraryRouter({ resolveBookRoot: (id) => { expect(id).toBe("trusted"); return root; } });
  expect((await app.request(`${base}/tree`)).status).toBe(200);
  const build = await app.request(`${base}/build`, json({ bookTitle: "测试", text: "第一章\n唐三说道：“敌人来了！”\n秘密是什么？" }));
  expect(build.status).toBe(200); expect((await build.json()).generatedDocuments).toBe(14);
  const path = "story/dissect-library/小说/测试/报告/开篇分析.md";
  expect((await app.request(`${base}/doc?path=${encodeURIComponent(path)}`)).status).toBe(200);
  expect((await app.request(`${base}/doc`, json({ path, content: "# 作者编辑" }, "PUT"))).status).toBe(200);
  expect(await (await app.request(`${base}/doc?path=${encodeURIComponent(path)}`)).json()).toMatchObject({ content: "# 作者编辑" });
  expect((await app.request(`${base}/books/${encodeURIComponent("测试")}`, { method: "DELETE" })).status).toBe(200);
});
it("拒绝非法字段、越界、坏 JSON 和无模型精炼", async () => {
  const app = createDissectLibraryRouter({ resolveBookRoot: () => root });
  expect((await app.request(`${base}/build`, json({ bookTitle: "测试", text: "正文", bookRoot: "/untrusted" }))).status).toBe(400);
  expect((await app.request(`${base}/build`, { method: "POST", body: "bad" })).status).toBe(400);
  expect((await app.request(`${base}/doc?path=../../secret.md`)).status).toBe(400);
  expect((await app.request(`${base}/build`, json({ bookTitle: "测试", text: "正文", useModel: true }))).status).toBe(422);
});
