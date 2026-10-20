import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileSystemStorageAdapter } from "../storage/fs-adapter.js";
import { StateManager } from "../state/manager.js";
import type { ChapterMeta } from "../models/chapter.js";

/**
 * C2 红测：core 层的正文与章节索引落盘必须原子。
 *
 * 缺陷：`FileSystemStorageAdapter.saveChapterContent`、`applyMutationSet` 的
 * create/update 分支，以及 `StateManager.saveChapterIndexAt` 都直接 `writeFile`
 * 覆盖目标文件。写到一半崩溃、或 rename 期间的失败，会把**已存在的正文**替换成
 * 半截内容；章节索引被写坏时正文还在，但按章号再也找不回来。
 *
 * 这里用故障注入证明「要么旧版、要么新版」：让 rename 失败，目标文件必须原样保留
 * 旧内容，临时文件不得残留，错误必须抛给调用方（不得静默吞掉）。
 *
 * 临时目录放在仓库内被忽略的 `packages/core/tmp/`（本仓库约定测试不在仓库外写文件）。
 */

/**
 * 只对显式登记的路径注入故障，其余全部透传真实实现：
 * - renameFailures：rename 到该路径时抛 EPERM（模拟替换落盘失败）；
 * - truncateOnWriteFailures：直接 writeFile 该路径时先截断成空文件再抛 ENOSPC
 *   （模拟「就地覆盖写到一半失败」——这正是非原子写会留下的半截文件）。
 */
const fsControl = vi.hoisted(() => ({
  renameFailures: new Set<string>(),
  truncateOnWriteFailures: new Set<string>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (path: Parameters<typeof actual.writeFile>[0], ...rest: unknown[]) => {
      const key = String(path);
      if (fsControl.truncateOnWriteFailures.has(key)) {
        await actual.writeFile(path, "");
        const error = new Error(`ENOSPC: no space left on device, write '${key}'`) as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        throw error;
      }
      return (actual.writeFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    },
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (fsControl.renameFailures.has(String(to))) {
        const error = new Error(`EPERM: operation not permitted, rename '${String(from)}' -> '${String(to)}'`) as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return actual.rename(from, to);
    },
  };
});

const TMP_ROOT = join(process.cwd(), "tmp", "core-chapter-write-atomicity");
const roots: string[] = [];

async function freshProjectRoot(): Promise<string> {
  const root = join(TMP_ROOT, crypto.randomUUID());
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}

function chapterMeta(number: number, title: string): ChapterMeta {
  return {
    number,
    title,
    status: "drafted",
    wordCount: 100,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    auditIssues: [],
    lengthWarnings: [],
  };
}

/** 递归收集目录下所有文件名，用来断言没有临时文件残留。 */
async function listAllFiles(dir: string): Promise<string[]> {
  const names: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(join(current, entry.name));
      else names.push(entry.name);
    }
  };
  await walk(dir);
  return names;
}

beforeEach(() => {
  fsControl.renameFailures.clear();
});

afterEach(async () => {
  fsControl.renameFailures.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("core 正文写原子化（C2 红测）", () => {
  it("saveChapterContent：替换正文失败时旧正文原样保留，不留临时文件，错误抛给调用方", async () => {
    const projectRoot = await freshProjectRoot();
    const adapter = new FileSystemStorageAdapter(projectRoot);
    await adapter.saveChapterContent("book", 1, "旧正文：完整的第一版", chapterMeta(1, "开篇"));

    const chaptersDir = join(projectRoot, "books", "book", "chapters");
    const chapterPath = join(chaptersDir, "卷01", "0001_开篇.md");
    await expect(readFile(chapterPath, "utf8")).resolves.toBe("旧正文：完整的第一版");

    // 故障注入：这次的正文替换必然失败。
    fsControl.renameFailures.add(chapterPath);
    await expect(
      adapter.saveChapterContent("book", 1, "新正文：写到一半就断了", chapterMeta(1, "开篇")),
    ).rejects.toThrow();

    // 旧正文必须原样在，不能变成半截内容、也不能消失。
    await expect(readFile(chapterPath, "utf8")).resolves.toBe("旧正文：完整的第一版");
    expect((await listAllFiles(chaptersDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("saveChapterContent：成功后正文完整可读且不留临时文件", async () => {
    const projectRoot = await freshProjectRoot();
    const adapter = new FileSystemStorageAdapter(projectRoot);

    await adapter.saveChapterContent("book", 1, "第一章正文", chapterMeta(1, "开篇"));

    const chaptersDir = join(projectRoot, "books", "book", "chapters");
    await expect(readFile(join(chaptersDir, "卷01", "0001_开篇.md"), "utf8")).resolves.toBe("第一章正文");
    expect((await listAllFiles(chaptersDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("StateManager.saveChapterIndex：索引替换失败时旧索引原样保留（正文不会因索引半截而失联）", async () => {
    const projectRoot = await freshProjectRoot();
    const manager = new StateManager(projectRoot);
    const chaptersDir = join(projectRoot, "books", "book", "chapters");
    const indexPath = join(chaptersDir, "index.json");
    const original = [chapterMeta(1, "开篇")];
    await manager.saveChapterIndex("book", original);
    await expect(readFile(indexPath, "utf8")).resolves.toBe(JSON.stringify(original, null, 2));

    fsControl.renameFailures.add(indexPath);
    await expect(manager.saveChapterIndex("book", [...original, chapterMeta(2, "第二章")])).rejects.toThrow();

    // 旧索引必须完整保留，且仍能解析（半截 JSON 会让整本书的章节索引不可读）。
    const raw = await readFile(indexPath, "utf8");
    expect(JSON.parse(raw)).toEqual(original);
    expect((await listAllFiles(chaptersDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("applyMutationSet 的 create/update：写入失败时目标文件保持旧内容", async () => {
    const projectRoot = await freshProjectRoot();
    const adapter = new FileSystemStorageAdapter(projectRoot);
    const bookDir = join(projectRoot, "books", "book");
    const target = join(bookDir, "story", "current_state.md");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(target, "旧状态", "utf8");

    const lock = await adapter.acquireWriteLock("book");
    try {
      fsControl.renameFailures.add(target);
      await expect(
        adapter.applyMutationSet(
          "book",
          { operations: [{ path: join("story", "current_state.md"), op: "update", content: "新状态" }] },
          lock.lockId,
        ),
      ).rejects.toThrow();

      await expect(readFile(target, "utf8")).resolves.toBe("旧状态");
      await expect(stat(join(bookDir, "story", ".tmp"))).rejects.toThrow();
    } finally {
      lock.release();
    }
  });
});
