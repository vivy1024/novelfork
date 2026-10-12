import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createWritingResourceFileStore } from "./file-store.js";
import { readChapterIndex } from "./chapter-layout.js";
import { resolveChapterFile } from "./chapter-path-guard.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * 书目录与书外的一个受害文件；索引里的 fileName 由调用方给出，指向书外。
 * 调用方必须写对层数：下面的自检会确认它真的落在受害文件上。
 */
function setup(maliciousFileName: string) {
  const base = mkdtempSync(join(tmpdir(), "chapter-guard-"));
  roots.push(base);
  const book = join(base, "books", "b1");
  const chaptersDir = join(book, "chapters");
  mkdirSync(chaptersDir, { recursive: true });
  const victim = join(base, "victim.txt");
  writeFileSync(victim, "OUTSIDE-ORIGINAL", "utf8");
  writeFileSync(join(chaptersDir, "index.json"), JSON.stringify([{
    number: 1,
    title: "恶意",
    fileName: maliciousFileName,
    wordCount: 1,
    updatedAt: new Date().toISOString(),
  }]), "utf8");
  // 自检：确认 fileName 从 chapters/ 出发确实指向受害文件，否则下面的越界断言没有意义。
  if (join(chaptersDir, maliciousFileName) !== victim) throw new Error("测试夹具路径未指向受害文件");
  return { book, victim, store: createWritingResourceFileStore(() => book) };
}

describe("resolveChapterFile", () => {
  it("拒绝越出章节目录的相对路径、绝对路径、盘符与备用数据流", () => {
    const chaptersDir = join(tmpdir(), "chapters-x");
    for (const bad of ["../../victim.txt", "..\\..\\victim.txt", "/etc/passwd", "C:\\Windows\\win.ini", "卷01/a:stream.md", "卷01/../../x.md", ""]) {
      expect(resolveChapterFile(chaptersDir, bad)).toBeNull();
    }
  });

  it("拒绝 Windows 保留设备名（含带扩展名与子目录的形式）", () => {
    const chaptersDir = join(tmpdir(), "chapters-x");
    for (const bad of ["CON", "nul.md", "卷01/COM1.md", "卷01/LPT9", "con/0001_x.md", "aux.txt"]) {
      expect(resolveChapterFile(chaptersDir, bad)).toBeNull();
    }
  });

  it("拒绝段末尾带点或空格（Windows 会静默去掉，导致写到别的文件）", () => {
    const chaptersDir = join(tmpdir(), "chapters-x");
    for (const bad of ["卷01./0001_x.md", "卷01 /0001_x.md", "卷01/0001_x.md.", "卷01/0001_x.md "]) {
      expect(resolveChapterFile(chaptersDir, bad)).toBeNull();
    }
  });

  it("接受章节目录内的正常卷目录路径", () => {
    const chaptersDir = join(tmpdir(), "chapters-x");
    expect(resolveChapterFile(chaptersDir, "卷01/0001_开篇.md")).toBe(join(chaptersDir, "卷01", "0001_开篇.md"));
  });
});

describe("章节索引 fileName 不可信：读、写、删都不得触碰书外文件", () => {
  it("读取章节时不返回书外内容", async () => {
    const { store, victim } = setup("../../../victim.txt");
    const found = await store.findAcceptedChapter("b1", 1);
    expect(found).toBeNull();
    expect(readFileSync(victim, "utf8")).toBe("OUTSIDE-ORIGINAL");
  });

  it("保存章节时不覆盖书外文件", async () => {
    const { store, victim } = setup("../../../victim.txt");
    await store.update("b1", "chapter:1", { content: "OVERWRITTEN" } as never).catch(() => undefined);
    expect(readFileSync(victim, "utf8")).toBe("OUTSIDE-ORIGINAL");
  });

  it("删除章节时不删除书外文件", async () => {
    const { store, victim } = setup("../../../victim.txt");
    await store.softDelete("b1", "chapter:1").catch(() => undefined);
    expect(existsSync(victim)).toBe(true);
  });

  it("布局同步不把越界条目保留在索引里", async () => {
    const { book } = setup("../../../victim.txt");
    const store = createWritingResourceFileStore(() => book);
    await store.list("b1");
    const entries = await readChapterIndex(book);
    expect(entries.some((entry) => entry.fileName.includes(".."))).toBe(false);
  });
});

describe("守卫覆盖：对账与风格库读取也不得触碰书外文件", () => {
  it("对账 reconcileChapterFiles 不读取书外文件的内容", async () => {
    const { book, victim } = setup("../../../victim.txt");
    const { reconcileChapterFiles } = await import("./chapter-reconcile.js");
    const changes = await reconcileChapterFiles({
      bookId: "b1",
      bookRoot: book,
      countingMode: "chinese" as never,
      resolveVolumeDirectory: async () => "卷01",
    });
    expect(changes.some((change) => change.content.includes("OUTSIDE-ORIGINAL"))).toBe(false);
    expect(readFileSync(victim, "utf8")).toBe("OUTSIDE-ORIGINAL");
  });
});

describe("符号链接与联接点：章节目录内的链接不得指向书外", () => {
  it("章节目录内的目录联接指向书外时，守卫拒绝且书外文件不被读写", () => {
    const base = mkdtempSync(join(tmpdir(), "chapter-junction-"));
    roots.push(base);
    const book = join(base, "books", "b1");
    const chaptersDir = join(book, "chapters");
    mkdirSync(chaptersDir, { recursive: true });
    const outsideDir = join(base, "outside");
    mkdirSync(outsideDir, { recursive: true });
    const victim = join(outsideDir, "0001_x.md");
    writeFileSync(victim, "OUTSIDE-ORIGINAL", "utf8");
    // 目录联接（junction）在 Windows 上无需管理员权限；卷01 看起来是章节目录内的子目录，真身在书外。
    symlinkSync(outsideDir, join(chaptersDir, "卷01"), "junction");
    // 字符串层面合法，只有按真实落点复核才能发现越界。
    expect(resolveChapterFile(chaptersDir, "卷01/0001_x.md")).toBeNull();
    expect(readFileSync(victim, "utf8")).toBe("OUTSIDE-ORIGINAL");
  });
});
