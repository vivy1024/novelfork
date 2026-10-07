import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "./atomic-write.js";
import { readChapterIndex, writeChapterIndex } from "./chapter-layout.js";
import { createWritingResourceFileStore } from "./file-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** 递归收集目录下的全部文件名，用来断言没有临时文件残留。 */
async function listAllFiles(dir: string): Promise<string[]> {
  const names: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(current, entry.name));
      else names.push(entry.name);
    }
  };
  await walk(dir);
  return names;
}

describe("writeFileAtomic", () => {
  it("写入内容并自动建目录，完成后不留临时文件", async () => {
    const dir = await freshDir("novelfork-atomic-write-");
    const target = join(dir, "chapters", "卷01", "0001_开篇.md");

    await writeFileAtomic(target, "第一章正文");

    await expect(readFile(target, "utf8")).resolves.toBe("第一章正文");
    expect(await listAllFiles(dir)).toEqual(["0001_开篇.md"]);
  });

  it("覆盖已有文件时旧版本被完整替换", async () => {
    const dir = await freshDir("novelfork-atomic-write-");
    const target = join(dir, "index.json");
    await writeFile(target, "旧内容旧内容旧内容", "utf8");

    await writeFileAtomic(target, "新");

    await expect(readFile(target, "utf8")).resolves.toBe("新");
    expect(await listAllFiles(dir)).toEqual(["index.json"]);
  });

  it("rename 失败时错误抛给调用方，临时文件被清理，目标原样", async () => {
    const dir = await freshDir("novelfork-atomic-write-");
    // 故障注入：目标路径是已存在的目录，rename 必然失败。
    const target = join(dir, "index.json");
    await mkdir(target, { recursive: true });

    await expect(writeFileAtomic(target, "半截内容")).rejects.toThrow();

    // 目标仍是目录、没有被写坏；目录里没有临时文件残留。
    expect((await listAllFiles(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    await expect(readFile(target, "utf8")).rejects.toThrow();
  });
});

describe("章节正文与索引的原子写", () => {
  it("writeChapterIndex 落盘后可完整读回，不留临时文件", async () => {
    const bookRoot = await freshDir("novelfork-atomic-index-");
    await writeChapterIndex(bookRoot, [{
      number: 1,
      title: "开篇",
      fileName: "卷01/0001_开篇.md",
      wordCount: 3,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }]);

    await expect(readChapterIndex(bookRoot)).resolves.toEqual([expect.objectContaining({ number: 1, title: "开篇" })]);
    expect(await listAllFiles(join(bookRoot, "chapters"))).toEqual(["index.json"]);
  });

  it("create/update/softDelete 走完正文与索引，chapters 树下零临时文件残留", async () => {
    const bookRoot = await freshDir("novelfork-atomic-store-");
    const store = createWritingResourceFileStore(() => bookRoot);

    const created = await store.create("book-a", { type: "chapter", title: "开篇", content: "第一版正文", status: "accepted" });
    const updated = await store.update("book-a", created.id, { content: "第二版正文，更长一些" });
    expect(updated?.content).toBe("第二版正文，更长一些");
    await store.create("book-a", { type: "chapter", title: "过渡", content: "另一章", status: "accepted" });
    await store.softDelete("book-a", created.id);

    const names = await listAllFiles(join(bookRoot, "chapters"));
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
    const index = await readChapterIndex(bookRoot);
    expect(index).toHaveLength(1);
    const remaining = await store.getById("book-a", `chapter:${index[0]!.number}`);
    expect(remaining?.content).toBe("另一章");
  });
});
