import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NOVEL_BUILTIN_WORKFLOWS, saveWorkflowRecipe } from "../engine/index.js";
import { createWorkflowsRouter } from "./workflows.js";

const dirs: string[] = [];

async function bookDir(config: Record<string, unknown> = { id: "book-1", title: "测试书", chapterWordCount: 3000 }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nf-wf-default-"));
  dirs.push(dir);
  await writeFile(join(dir, "book.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function routerFor(dir: string) {
  return createWorkflowsRouter({} as never, { resolveBookRoot: () => dir });
}

async function put(router: ReturnType<typeof routerFor>, recipeId: unknown) {
  return router.request("/api/books/book-1/workflow-default", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipeId }),
  });
}

describe("本书默认工作流（book.json defaultWorkflowRecipeId）", () => {
  it("没设过时为空", async () => {
    const res = await routerFor(await bookDir()).request("/api/books/book-1/workflow-default");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recipeId: null, storedRecipeId: null });
  });

  it("设为已发布方案后写进 book.json，保留其它字段，读回生效", async () => {
    const dir = await bookDir();
    const router = routerFor(dir);
    const target = NOVEL_BUILTIN_WORKFLOWS[1]!;
    const res = await put(router, target.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recipeId: target.id, recipeName: target.name });

    const config = JSON.parse(await readFile(join(dir, "book.json"), "utf8")) as Record<string, unknown>;
    expect(config.defaultWorkflowRecipeId).toBe(target.id);
    expect(config.title).toBe("测试书");
    expect(config.chapterWordCount).toBe(3000);

    const read = await (await router.request("/api/books/book-1/workflow-default")).json();
    expect(read).toMatchObject({ recipeId: target.id });
  });

  it("传 null 清除默认", async () => {
    const dir = await bookDir({ id: "book-1", title: "测试书", defaultWorkflowRecipeId: NOVEL_BUILTIN_WORKFLOWS[0]!.id });
    const res = await put(routerFor(dir), null);
    expect(res.status).toBe(200);
    const config = JSON.parse(await readFile(join(dir, "book.json"), "utf8")) as Record<string, unknown>;
    expect("defaultWorkflowRecipeId" in config).toBe(false);
  });

  it("不存在的方案 404、草稿 400，都带说明且不改 book.json", async () => {
    const dir = await bookDir();
    const router = routerFor(dir);
    const missing = await put(router, "no-such");
    expect(missing.status).toBe(404);
    expect((await missing.json()).explanation.what).toContain("找不到");

    const draft = { ...NOVEL_BUILTIN_WORKFLOWS[0]!, id: "my-draft", name: "我的草稿", status: "draft" };
    await saveWorkflowRecipe(dir, draft, { expectedRevision: 0 });
    const res = await put(router, "my-draft");
    expect(res.status).toBe(400);
    expect((await res.json()).explanation.what).toContain("草稿");
    const config = JSON.parse(await readFile(join(dir, "book.json"), "utf8")) as Record<string, unknown>;
    expect("defaultWorkflowRecipeId" in config).toBe(false);
  });

  it("记的默认方案被删或转回草稿时，有效默认为空并附说明", async () => {
    const dir = await bookDir({ id: "book-1", title: "测试书", defaultWorkflowRecipeId: "gone" });
    const res = await routerFor(dir).request("/api/books/book-1/workflow-default");
    const body = await res.json();
    expect(body).toMatchObject({ storedRecipeId: "gone", recipeId: null });
    expect(body.notice.what).toContain("不存在");
  });

  it("recipeId 类型不对时 400", async () => {
    const res = await put(routerFor(await bookDir()), 42);
    expect(res.status).toBe(400);
  });
});
