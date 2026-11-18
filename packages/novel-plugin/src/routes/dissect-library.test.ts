// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDissectLibraryRouter } from "./dissect-library";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dissect-route-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const base = "/api/books/trusted/dissect-library";
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

it("可信书根下完整 HTTP 建库、工作台读取、逐章对照、读写、列树、删除", async () => {
  const app = createDissectLibraryRouter({
    resolveBookRoot: (id) => {
      expect(id).toBe("trusted");
      return root;
    },
  });
  expect((await app.request(`${base}/tree`)).status).toBe(200);

  const preview = await app.request(`${base}/preview`, json({ text: "第一章 开山\n少年握紧长剑。\n第二章 试炼\n风雪交加。" }));
  expect(preview.status).toBe(200);
  expect((await preview.json()).totalChapters).toBe(2);

  const build = await app.request(
    `${base}/build`,
    json({ bookTitle: "测试", text: "第一章 开山\n唐三说道：“敌人来了！”\n秘密是什么？" }),
  );
  expect(build.status).toBe(200);
  expect((await build.json()).generatedDocuments).toBe(14);

  const workspaceRes = await app.request(`${base}/books/${encodeURIComponent("测试")}/workspace`);
  expect(workspaceRes.status).toBe(200);
  expect((await workspaceRes.json()).chapters).toHaveLength(1);

  const pairRes = await app.request(`${base}/books/${encodeURIComponent("测试")}/chapters/1`);
  expect(pairRes.status).toBe(200);
  expect((await pairRes.json()).sourceText).toContain("唐三说道");

  const path = "story/dissect-library/小说/测试/报告/开篇分析.md";
  expect((await app.request(`${base}/doc?path=${encodeURIComponent(path)}`)).status).toBe(200);
  expect((await app.request(`${base}/doc`, json({ path, content: "# 作者编辑" }, "PUT"))).status).toBe(200);
  expect(await (await app.request(`${base}/doc?path=${encodeURIComponent(path)}`)).json()).toMatchObject({ content: "# 作者编辑" });
  expect((await app.request(`${base}/books/${encodeURIComponent("测试")}`, { method: "DELETE" })).status).toBe(200);
});

it("支持 multipart 上传本地文件进行预览与建库", async () => {
  const app = createDissectLibraryRouter({ resolveBookRoot: () => root });
  const previewForm = new FormData();
  previewForm.append("files", new File(["第一章 初遇\n夜色如水。\n\n第二章 转折\n剑光一闪。"], "demo.txt", { type: "text/plain" }));
  const previewRes = await app.request(`${base}/preview`, { method: "POST", body: previewForm });
  expect(previewRes.status).toBe(200);
  expect((await previewRes.json()).totalChapters).toBe(2);

  const buildForm = new FormData();
  buildForm.set("bookTitle", "上传测试");
  buildForm.set("category", "玄幻");
  buildForm.set("chapterSelection", JSON.stringify({ preset: "first5" }));
  buildForm.set("dissectMode", "per-chapter");
  buildForm.set("useModel", "false");
  buildForm.append("files", new File(["第一章 初遇\n夜色如水。\n\n第二章 转折\n剑光一闪。"], "demo.txt", { type: "text/plain" }));
  const buildRes = await app.request(`${base}/build`, { method: "POST", body: buildForm });
  expect(buildRes.status).toBe(200);
  expect((await buildRes.json()).slug).toBe("上传测试");
});

it("拒绝非法字段、越界、坏 JSON 和无模型精炼", async () => {
  const app = createDissectLibraryRouter({ resolveBookRoot: () => root });
  expect((await app.request(`${base}/build`, json({ bookTitle: "测试", text: "正文", bookRoot: "/untrusted" }))).status).toBe(400);
  expect((await app.request(`${base}/build`, { method: "POST", body: "bad" })).status).toBe(400);
  expect((await app.request(`${base}/doc?path=../../secret.md`)).status).toBe(400);
  expect((await app.request(`${base}/build`, json({ bookTitle: "测试", text: "正文", useModel: true }))).status).toBe(422);
});
