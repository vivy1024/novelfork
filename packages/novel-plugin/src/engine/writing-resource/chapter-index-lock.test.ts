import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readChapterIndex } from "./chapter-layout.js";
import { withChapterIndexLock } from "./chapter-index-lock.js";
import { createWritingResourceFileStore } from "./file-store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function bookRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "chapter-index-lock-"));
  roots.push(root);
  return root;
}

describe("withChapterIndexLock", () => {
  it("同一本书的任务串行执行，不同书互不阻塞", async () => {
    const root = bookRoot();
    const other = bookRoot();
    const log: string[] = [];
    const slow = (label: string, ms: number) => async () => {
      log.push(`${label}:start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`${label}:end`);
    };
    await Promise.all([
      withChapterIndexLock(root, slow("a", 30)),
      withChapterIndexLock(root, slow("b", 1)),
      withChapterIndexLock(other, slow("x", 1)),
    ]);
    expect(log.indexOf("a:end")).toBeLessThan(log.indexOf("b:start"));
    expect(log.indexOf("x:end")).toBeLessThan(log.indexOf("a:end"));
  });

  it("同一调用链内可重入，不自锁", async () => {
    const root = bookRoot();
    const value = await withChapterIndexLock(root, () => withChapterIndexLock(root, async () => 42));
    expect(value).toBe(42);
  });

  it("任务抛错后释放锁，后续任务照常执行", async () => {
    const root = bookRoot();
    await expect(withChapterIndexLock(root, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withChapterIndexLock(root, async () => "ok")).resolves.toBe("ok");
  });

  it("并发新建多章时 index.json 不丢条目", async () => {
    const root = bookRoot();
    const store = createWritingResourceFileStore(() => root);
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.create("book", {
      type: "chapter",
      status: "accepted",
      title: `第${i + 1}章`,
      content: `正文 ${i + 1}`,
      chapterNumber: i + 1,
    } as never)));
    const index = await readChapterIndex(root);
    expect(index.map((entry) => entry.number)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
});
