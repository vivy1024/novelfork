import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
          volumeOutline: "第一卷：七玄门风云",
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
