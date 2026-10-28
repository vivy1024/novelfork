import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BookConfigUnreadableError,
  readBookConfigFile,
  updateBookConfig,
  withBookConfigLock,
} from "./book-config-lock.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function bookRoot(initial?: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "book-config-lock-"));
  roots.push(root);
  if (initial !== undefined) await writeFile(join(root, "book.json"), initial, "utf8");
  return root;
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("updateBookConfig", () => {
  it("两次并发写入 book.json 的不同字段，最终两个字段都在", async () => {
    const root = await bookRoot(`${JSON.stringify({ id: "book-1", title: "测试书" })}\n`);
    await Promise.all([
      updateBookConfig(root, async (current) => {
        await tick(20);
        return { ...current, chapterWordCount: 3200 };
      }),
      updateBookConfig(root, async (current) => {
        await tick(5);
        return { ...current, narrativeMemory: { retrieval: { maxTokens: 12000 } } };
      }),
    ]);
    const saved = JSON.parse(await readFile(join(root, "book.json"), "utf8"));
    expect(saved).toMatchObject({
      id: "book-1",
      title: "测试书",
      chapterWordCount: 3200,
      narrativeMemory: { retrieval: { maxTokens: 12000 } },
    });
  });

  it("没有锁时同样的交错会丢字段（对照组，证明上面的用例能抓住问题）", async () => {
    const root = await bookRoot(`${JSON.stringify({ id: "book-1", title: "测试书" })}\n`);
    const unlocked = async (patch: Record<string, unknown>, delay: number) => {
      const current = JSON.parse(await readFile(join(root, "book.json"), "utf8"));
      await tick(delay);
      await writeFile(join(root, "book.json"), JSON.stringify({ ...current, ...patch }), "utf8");
    };
    await Promise.all([unlocked({ chapterWordCount: 3200 }, 20), unlocked({ tone: "冷峻" }, 5)]);
    const saved = JSON.parse(await readFile(join(root, "book.json"), "utf8"));
    expect(Object.keys(saved).filter((key) => key === "chapterWordCount" || key === "tone")).toHaveLength(1);
  });

  it("book.json 解析失败时抛错，且不覆盖原文件", async () => {
    const broken = '{"id":"book-1","title":"半截';
    const root = await bookRoot(broken);
    await expect(updateBookConfig(root, (current) => ({ ...current, updatedAt: "x" }))).rejects.toBeInstanceOf(
      BookConfigUnreadableError,
    );
    await expect(updateBookConfig(root, () => ({ id: "book-1" }))).rejects.toThrow("发生了什么");
    expect(await readFile(join(root, "book.json"), "utf8")).toBe(broken);
  });

  it("book.json 不是对象时抛错", async () => {
    const root = await bookRoot("[]\n");
    await expect(readBookConfigFile(root)).rejects.toBeInstanceOf(BookConfigUnreadableError);
  });

  it("文件不存在时 current 为 null；mutate 返回 null 不写文件", async () => {
    const root = await bookRoot();
    const seen: unknown[] = [];
    const result = await updateBookConfig(root, (current) => {
      seen.push(current);
      return null;
    });
    expect(seen).toEqual([null]);
    expect(result).toBeNull();
    expect(await readBookConfigFile(root)).toBeNull();
  });
});

describe("withBookConfigLock", () => {
  it("同一本书串行、可重入，路径大小写在 Windows 下视为同一把锁", async () => {
    const root = await bookRoot(`${JSON.stringify({ id: "book-1", title: "测试书" })}\n`);
    const log: string[] = [];
    const alias = process.platform === "win32" ? root.toUpperCase() : root;
    await Promise.all([
      withBookConfigLock(root, async () => {
        log.push("a:start");
        await tick(15);
        // 嵌套加锁直接执行，不会自锁。
        await withBookConfigLock(root, async () => log.push("a:nested"));
        log.push("a:end");
      }),
      withBookConfigLock(alias, async () => {
        log.push("b:start");
        log.push("b:end");
      }),
    ]);
    expect(log).toEqual(["a:start", "a:nested", "a:end", "b:start", "b:end"]);
  });
});
