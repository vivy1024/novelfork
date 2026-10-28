/**
 * 章节索引 / 正文写盘安全：读失败不当空、坏索引留底、换名先写后删、删除失败不吞。
 * 故障通过 mock node:fs/promises 与原子写注入，其余调用走真实文件系统。
 */
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({
  readFile: null as null | ((path: string) => Error | null),
  unlink: null as null | ((path: string) => Error | null),
  atomic: null as null | ((path: string) => Error | null),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const overrides = {
    readFile: (async (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      const injected = faults.readFile?.(String(path));
      if (injected) throw injected;
      return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof actual.readFile,
    unlink: (async (path: Parameters<typeof actual.unlink>[0]) => {
      const injected = faults.unlink?.(String(path));
      if (injected) throw injected;
      return actual.unlink(path);
    }) as typeof actual.unlink,
  };
  // 被测模块对 node 内置模块走 default 互操作，具名导出与 default 都要换掉。
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock("./atomic-write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./atomic-write.js")>();
  return {
    ...actual,
    writeFileAtomic: async (path: string, content: string) => {
      const injected = faults.atomic?.(path);
      if (injected) throw injected;
      return actual.writeFileAtomic(path, content);
    },
  };
});

import { ChapterStoreError, readChapterIndex, synchronizeChapterLayout } from "./chapter-layout.js";
import { createWritingResourceFileStore } from "./file-store.js";

function fsError(code: string, message = code): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

const roots: string[] = [];

beforeEach(() => {
  faults.readFile = null;
  faults.unlink = null;
  faults.atomic = null;
});

afterEach(async () => {
  faults.readFile = null;
  faults.unlink = null;
  faults.atomic = null;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function bookRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "chapter-store-safety-"));
  roots.push(root);
  return root;
}

const RICH_INDEX = [
  {
    number: 1,
    title: "开篇",
    fileName: "卷01/0001_开篇.md",
    wordCount: 2,
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "audited",
    importSource: "导入:旧稿.txt",
    auditIssues: ["人物称谓前后不一"],
  },
];

async function seedRichBook(root: string): Promise<string> {
  await mkdir(join(root, "chapters", "卷01"), { recursive: true });
  await writeFile(join(root, "chapters", "卷01", "0001_开篇.md"), "正文", "utf8");
  // 磁盘上还有一章没进索引：对账一旦按“空索引”重建，就会改写 index.json。
  await writeFile(join(root, "chapters", "卷01", "0002_过渡.md"), "第二章", "utf8");
  const raw = `${JSON.stringify(RICH_INDEX, null, 2)}\n`;
  await writeFile(join(root, "chapters", "index.json"), raw, "utf8");
  return raw;
}

const isIndexPath = (path: string) => path.replaceAll("\\", "/").endsWith("chapters/index.json");

describe("问题 1：章节索引读失败不当成空", () => {
  it("索引读到 EBUSY 时 list 抛出带 explanation 的错误，index.json 原样不动", async () => {
    const root = await bookRoot();
    const raw = await seedRichBook(root);
    const store = createWritingResourceFileStore(() => root);
    faults.readFile = (path) => (isIndexPath(path) ? fsError("EBUSY", "resource busy or locked") : null);

    const failure = await store.list("book").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChapterStoreError);
    expect((failure as ChapterStoreError).code).toBe("CHAPTER_INDEX_UNREADABLE");
    expect((failure as ChapterStoreError).explanation).toMatchObject({
      whatHappened: expect.stringContaining("EBUSY"),
      whyItMatters: expect.any(String),
      suggestedAction: expect.any(String),
    });

    faults.readFile = null;
    expect(await readFile(join(root, "chapters", "index.json"), "utf8")).toBe(raw);
  });

  it("索引读到 EPERM 时 create 不会把索引写成只剩一条", async () => {
    const root = await bookRoot();
    const raw = await seedRichBook(root);
    const store = createWritingResourceFileStore(() => root);
    faults.readFile = (path) => (isIndexPath(path) ? fsError("EPERM", "operation not permitted") : null);

    await expect(store.create("book", { type: "chapter", status: "accepted", title: "新章", content: "x", chapterNumber: 3 } as never))
      .rejects.toBeInstanceOf(ChapterStoreError);

    faults.readFile = null;
    expect(await readFile(join(root, "chapters", "index.json"), "utf8")).toBe(raw);
  });

  it("索引不存在（ENOENT）仍按空处理，对账照常建索引", async () => {
    const root = await bookRoot();
    await mkdir(join(root, "chapters", "卷01"), { recursive: true });
    await writeFile(join(root, "chapters", "卷01", "0001_开篇.md"), "正文", "utf8");
    await expect(readChapterIndex(root)).resolves.toEqual([]);
    const result = await synchronizeChapterLayout("book", root, () => "卷01");
    expect(result.indexed).toBe(1);
  });

  it("坏 JSON 被改名留底并抛错，元数据可从留底文件找回", async () => {
    const root = await bookRoot();
    await mkdir(join(root, "chapters"), { recursive: true });
    const broken = `${JSON.stringify(RICH_INDEX).slice(0, -5)}`;
    await writeFile(join(root, "chapters", "index.json"), broken, "utf8");

    const failure = await readChapterIndex(root).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChapterStoreError);
    expect((failure as ChapterStoreError).code).toBe("CHAPTER_INDEX_CORRUPT");
    expect((failure as ChapterStoreError).explanation.whatHappened).toContain("index.json.corrupt-");

    const names = await readdir(join(root, "chapters"));
    const backup = names.find((name) => name.startsWith("index.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(root, "chapters", backup!), "utf8")).toBe(broken);
    expect(names).not.toContain("index.json");
  });

  it("索引顶层不是数组同样留底抛错，不当空覆写", async () => {
    const root = await bookRoot();
    await mkdir(join(root, "chapters"), { recursive: true });
    await writeFile(join(root, "chapters", "index.json"), "{\"chapters\":[]}", "utf8");
    await expect(readChapterIndex(root)).rejects.toMatchObject({ code: "CHAPTER_INDEX_CORRUPT" });
    const names = await readdir(join(root, "chapters"));
    expect(names.some((name) => name.startsWith("index.json.corrupt-"))).toBe(true);
  });

});

describe("问题 2：改标题换文件名时先写新正文再删旧正文", () => {
  it("create 写新文件失败时，旧正文还在，索引仍指向旧文件", async () => {
    const root = await bookRoot();
    const store = createWritingResourceFileStore(() => root);
    await store.create("book", { type: "chapter", status: "accepted", title: "旧标题", content: "旧正文", chapterNumber: 1 } as never);
    const oldPath = join(root, "chapters", "卷01", "0001_旧标题.md");
    faults.atomic = (path) => (path.includes("0001_新标题.md") ? fsError("ENOSPC", "no space left on device") : null);

    await expect(store.create("book", { type: "chapter", status: "accepted", title: "新标题", content: "新正文", chapterNumber: 1 } as never))
      .rejects.toThrow();

    faults.atomic = null;
    expect(await readFile(oldPath, "utf8")).toBe("旧正文");
    expect((await readChapterIndex(root))[0]).toMatchObject({ fileName: "卷01/0001_旧标题.md" });
  });

  it("create 写索引失败时，旧正文还在", async () => {
    const root = await bookRoot();
    const store = createWritingResourceFileStore(() => root);
    await store.create("book", { type: "chapter", status: "accepted", title: "旧标题", content: "旧正文", chapterNumber: 1 } as never);
    faults.atomic = (path) => (isIndexPath(path) ? fsError("EIO", "i/o error") : null);

    await expect(store.create("book", { type: "chapter", status: "accepted", title: "新标题", content: "新正文", chapterNumber: 1 } as never))
      .rejects.toThrow();

    faults.atomic = null;
    expect(await readFile(join(root, "chapters", "卷01", "0001_旧标题.md"), "utf8")).toBe("旧正文");
  });

  it("create 成功后旧文件删除失败只告警，不回滚，新正文与索引生效", async () => {
    const root = await bookRoot();
    const store = createWritingResourceFileStore(() => root);
    await store.create("book", { type: "chapter", status: "accepted", title: "旧标题", content: "旧正文", chapterNumber: 1 } as never);
    faults.unlink = (path) => (path.includes("0001_旧标题.md") ? fsError("EBUSY") : null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const created = await store.create("book", { type: "chapter", status: "accepted", title: "新标题", content: "新正文", chapterNumber: 1 } as never);

    expect(created.content).toBe("新正文");
    expect(created.metadata.warnings).toEqual([expect.objectContaining({ code: "CHAPTER_OLD_FILE_NOT_REMOVED", explanation: expect.objectContaining({ suggestedAction: expect.any(String) }) })]);
    expect(warn).toHaveBeenCalled();
    expect((await readChapterIndex(root))[0]).toMatchObject({ fileName: "卷01/0001_新标题.md" });
    warn.mockRestore();
  });

  it("update 改标题时写新文件失败，旧正文还在、索引不变", async () => {
    const root = await bookRoot();
    const store = createWritingResourceFileStore(() => root);
    const created = await store.create("book", { type: "chapter", status: "accepted", title: "旧标题", content: "旧正文", chapterNumber: 1 } as never);
    faults.atomic = (path) => (path.includes("0001_新标题.md") ? fsError("ENOSPC") : null);

    await expect(store.update("book", created.id, { title: "新标题", content: "新正文" })).rejects.toThrow();

    faults.atomic = null;
    expect(await readFile(join(root, "chapters", "卷01", "0001_旧标题.md"), "utf8")).toBe("旧正文");
    expect((await readChapterIndex(root))[0]).toMatchObject({ fileName: "卷01/0001_旧标题.md" });
  });

  it("update 只改标题时正文搬到新文件名，旧文件删除", async () => {
    const root = await bookRoot();
    const store = createWritingResourceFileStore(() => root);
    const created = await store.create("book", { type: "chapter", status: "accepted", title: "旧标题", content: "旧正文", chapterNumber: 1 } as never);

    const updated = await store.update("book", created.id, { title: "新标题" });

    expect(updated?.content).toBe("旧正文");
    expect(await readFile(join(root, "chapters", "卷01", "0001_新标题.md"), "utf8")).toBe("旧正文");
    await expect(readFile(join(root, "chapters", "卷01", "0001_旧标题.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("问题 3：softDelete 先删正文再改索引，删除失败要报出来", () => {
  it("unlink 失败时抛出带 explanation 的错误，索引仍保留该章", async () => {
    const root = await bookRoot();
    const store = createWritingResourceFileStore(() => root);
    const created = await store.create("book", { type: "chapter", status: "accepted", title: "开篇", content: "正文", chapterNumber: 1 } as never);
    faults.unlink = (path) => (path.includes("0001_开篇.md") ? fsError("EPERM", "operation not permitted") : null);

    const failure = await store.softDelete("book", created.id).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChapterStoreError);
    expect((failure as ChapterStoreError).code).toBe("CHAPTER_FILE_DELETE_FAILED");
    expect((failure as ChapterStoreError).explanation.whatHappened).toContain("EPERM");
    faults.unlink = null;
    expect((await readChapterIndex(root)).map((entry) => entry.number)).toEqual([1]);
    expect(await readFile(join(root, "chapters", "卷01", "0001_开篇.md"), "utf8")).toBe("正文");
  });

  it("正文已不在（ENOENT）时照常从索引移除", async () => {
    const root = await bookRoot();
    const store = createWritingResourceFileStore(() => root);
    const created = await store.create("book", { type: "chapter", status: "accepted", title: "开篇", content: "正文", chapterNumber: 1 } as never);
    await fsPromises.rm(join(root, "chapters", "卷01", "0001_开篇.md"));

    await expect(store.softDelete("book", created.id)).resolves.toMatchObject({ status: "archived" });
    expect(await readChapterIndex(root)).toEqual([]);
  });
});
