import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "@vivy1024/novelfork-core";
import { afterEach, describe, expect, it } from "vitest";

import { createWritingLayersRouter } from "./writing-layers.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createWritingLayersRouter", () => {
  it("does not expose the removed author-profile API", async () => {
    const projectRoot = await tempDir("novelfork-route-project-");
    const state = new StateManager(projectRoot);
    const router = createWritingLayersRouter({ state, root: projectRoot } as never);

    const getRes = await router.request("/api/author-profile");
    expect(getRes.status).toBe(404);
  });

  it("GET/PUT /api/books/:bookId/writing-layers isolates book design and rules", async () => {
    const projectRoot = await tempDir("novelfork-route-project-");
    const bookDir = join(projectRoot, "books", "book-1");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(join(bookDir, "book.json"), JSON.stringify({
      id: "book-1",
      title: "第一本书",
      platform: "tomato",
      genre: "xianxia",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }), "utf8");

    const state = new StateManager(projectRoot);
    const router = createWritingLayersRouter(
      {
        state,
        root: projectRoot,
        loadBookConfig: async () => ({
          id: "book-1",
          title: "第一本书",
          platform: "tomato",
          genre: "xianxia",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      } as never,
      { resolveBookRoot: () => bookDir },
    );

    const putRes = await router.request("/api/books/book-1/writing-layers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookDesign: {
          authorIntent: "全书追求真仙长生。",
          currentFocus: "第 1-3 章推进药园日常。",
        },
        bookRulesRaw: "---\nprohibitions:\n  - 不得越级杀敌\n---\n规则正文。\n",
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await router.request("/api/books/book-1/writing-layers");
    expect(getRes.status).toBe(200);
    const data = await getRes.json() as {
      bookDesign: { authorIntent: string; currentFocus: string };
      bookRulesRaw: string;
      bookRulesText: string;
    };
    expect(data).not.toHaveProperty("authorProfileEnabled");
    expect(data).not.toHaveProperty("authorHabitsText");
    expect(data.bookDesign.authorIntent).toContain("全书追求真仙长生");
    expect(data.bookRulesRaw).toContain("不得越级杀敌");
    expect(data.bookRulesText).toContain("不得越级杀敌");
  });
});

describe("writing-layers 写盘安全", () => {
  async function setup() {
    const projectRoot = await tempDir("novelfork-route-layers-");
    const bookDir = join(projectRoot, "books", "book-1");
    await mkdir(join(bookDir, "story"), { recursive: true });
    const router = createWritingLayersRouter({ state: new StateManager(projectRoot), root: projectRoot } as never, { resolveBookRoot: () => bookDir });
    const put = (body: unknown) => router.request("/api/books/book-1/writing-layers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const get = async () => (await router.request("/api/books/book-1/writing-layers")).json() as Promise<{
      bookDesign: { authorIntent: string; currentFocus: string; volumeOutline: string };
      bookRulesRaw: string;
      revisions: Record<string, string>;
    }>;
    return { bookDir, put, get };
  }

  it("拒绝通过 writing-layers 写卷纲：422 + explanation，volume_outline.md 与其它字段都不动", async () => {
    const { bookDir, put } = await setup();
    await writeFile(join(bookDir, "story", "volume_outline.md"), "经纬导出的卷纲\n", "utf8");

    const response = await put({ bookDesign: { volumeOutline: "面板里改的卷纲", authorIntent: "顺带改意图" } });

    expect(response.status).toBe(422);
    const body = await response.json() as { error: { code: string }; explanation: Record<string, string> };
    expect(body.error.code).toBe("VOLUME_OUTLINE_READ_ONLY");
    expect(body.explanation.suggestedAction).toContain("卷纲/大纲");
    expect(await readFile(join(bookDir, "story", "volume_outline.md"), "utf8")).toBe("经纬导出的卷纲\n");
    await expect(readFile(join(bookDir, "story", "author_intent.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("只提交改过的字段：保存当前聚焦不会用旧值覆盖别处刚写的作者意图", async () => {
    const { bookDir, put, get } = await setup();
    const loaded = await get();
    // 别处（叙述者 / 另一个窗口）在作者打开设置后改了作者意图。
    await writeFile(join(bookDir, "story", "author_intent.md"), "叙述者刚写的意图\n", "utf8");

    const response = await put({ bookDesign: { currentFocus: "作者改的聚焦" }, revisions: { currentFocus: loaded.revisions.currentFocus } });

    expect(response.status).toBe(200);
    expect(await readFile(join(bookDir, "story", "author_intent.md"), "utf8")).toBe("叙述者刚写的意图\n");
    expect(await readFile(join(bookDir, "story", "current_focus.md"), "utf8")).toBe("作者改的聚焦\n");
  });

  it("revision 不一致时拒绝保存：409 + explanation + 冲突字段，磁盘内容不被覆盖", async () => {
    const { bookDir, put, get } = await setup();
    await writeFile(join(bookDir, "story", "author_intent.md"), "最初的意图\n", "utf8");
    const loaded = await get();
    await writeFile(join(bookDir, "story", "author_intent.md"), "别处改过的意图\n", "utf8");

    const response = await put({ bookDesign: { authorIntent: "面板里的旧版改动" }, revisions: { authorIntent: loaded.revisions.authorIntent } });

    expect(response.status).toBe(409);
    const body = await response.json() as { error: { code: string }; explanation: Record<string, string>; conflictFields: string[] };
    expect(body.error.code).toBe("WRITING_LAYER_REVISION_CONFLICT");
    expect(body.conflictFields).toEqual(["authorIntent"]);
    expect(body.explanation).toMatchObject({ whatHappened: expect.stringContaining("作者意图"), whyItMatters: expect.any(String), suggestedAction: expect.any(String) });
    expect(await readFile(join(bookDir, "story", "author_intent.md"), "utf8")).toBe("别处改过的意图\n");
  });

  it("revision 一致时保存成功并返回新 revision，可连续保存", async () => {
    const { put, get } = await setup();
    const loaded = await get();
    const first = await put({ bookRulesRaw: "规则一", revisions: { bookRulesRaw: loaded.revisions.bookRulesRaw } });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { revisions: Record<string, string> };
    expect(firstBody.revisions.bookRulesRaw).not.toBe(loaded.revisions.bookRulesRaw);

    const second = await put({ bookRulesRaw: "规则二", revisions: { bookRulesRaw: firstBody.revisions.bookRulesRaw } });
    expect(second.status).toBe(200);
    expect((await get()).bookRulesRaw).toBe("规则二\n");
  });
});
