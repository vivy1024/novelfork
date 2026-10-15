import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 记录 realpathSync 的调用，用来断言「一次批量解析只对章节目录做一次 realpath」。
// 其余行为原样透传给真实 fs，联接点与悬空链接用例走真实文件系统。
const fsCalls = vi.hoisted(() => ({ realpath: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const realpathSync = Object.assign(
    (path: import("node:fs").PathLike, options?: unknown) => {
      fsCalls.realpath.push(String(path));
      return actual.realpathSync(path, options as never);
    },
    { native: actual.realpathSync.native },
  );
  return { ...actual, realpathSync, default: { ...actual, realpathSync } };
});

import { createChapterFileResolver, requireChapterFile, resolveChapterFile } from "../utils/chapter-path-guard.js";
import { resolveChapterFilePath } from "../state/state-bootstrap.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempBase(prefix: string): string {
  const base = mkdtempSync(join(tmpdir(), prefix));
  roots.push(base);
  return base;
}

describe("resolveChapterFile（core 唯一实现）：字符串层", () => {
  const chaptersDir = join(tmpdir(), "core-chapters-x");

  it("拒绝越出章节目录的相对路径、绝对路径、盘符、备用数据流与空值", () => {
    for (const bad of ["../../victim.txt", "..\\..\\victim.txt", "/etc/passwd", "\\\\server\\share\\x.md", "C:\\Windows\\win.ini", "卷01/a:stream.md", "卷01/../../x.md", "", " 卷01/x.md"]) {
      expect(resolveChapterFile(chaptersDir, bad), bad).toBeNull();
    }
  });

  it("拒绝 Windows 保留设备名：含 CONIN$、CONOUT$ 与上标数字的 COM/LPT", () => {
    for (const bad of ["CON", "nul.md", "卷01/COM1.md", "卷01/LPT9", "CONIN$", "conout$.md", "卷01/COM¹.md", "LPT²", "com³.txt", "con .md"]) {
      expect(resolveChapterFile(chaptersDir, bad), bad).toBeNull();
    }
  });

  it("名字只是以保留名开头的正常文件不受影响", () => {
    for (const ok of ["console.md", "卷01/COM10.md", "卷01/0001_CON门.md", "auxiliary/0002_x.md"]) {
      expect(resolveChapterFile(chaptersDir, ok), ok).toBe(join(chaptersDir, ...ok.split("/")));
    }
  });

  it("拒绝段末尾带点或空格（Windows 会静默去掉，导致写到别的文件）", () => {
    for (const bad of ["卷01./0001_x.md", "卷01 /0001_x.md", "卷01/0001_x.md.", "卷01/0001_x.md "]) {
      expect(resolveChapterFile(chaptersDir, bad), bad).toBeNull();
    }
  });

  it("requireChapterFile 越界时抛错，不静默落到章节目录之外", () => {
    expect(() => requireChapterFile(chaptersDir, "../x.md")).toThrow(/章节目录/);
    expect(requireChapterFile(chaptersDir, "卷01/0001_开篇.md")).toBe(join(chaptersDir, "卷01", "0001_开篇.md"));
  });
});

describe("resolveChapterFile：真实落点层", () => {
  it("目录联接指向书外时拒绝", () => {
    const base = tempBase("core-guard-junction-");
    const chaptersDir = join(base, "chapters");
    const outside = join(base, "outside");
    mkdirSync(chaptersDir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(chaptersDir, "卷01"), "junction");
    expect(resolveChapterFile(chaptersDir, "卷01/0001_x.md")).toBeNull();
  });

  it("悬空联接（目标已被删除）一律拒绝，不沿父目录上溯放行", () => {
    const base = tempBase("core-guard-dangling-");
    const chaptersDir = join(base, "chapters");
    const outside = join(base, "outside");
    mkdirSync(chaptersDir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(chaptersDir, "卷01"), "junction");
    rmSync(outside, { recursive: true, force: true });
    // 写入会沿着链接在书外重新建出目录与文件，所以链接本身和它下面的新路径都必须拒绝。
    expect(resolveChapterFile(chaptersDir, "卷01")).toBeNull();
    expect(resolveChapterFile(chaptersDir, "卷01/0001_x.md")).toBeNull();
  });

  it("指向从未存在的书外目标的联接同样拒绝", () => {
    const base = tempBase("core-guard-never-");
    const chaptersDir = join(base, "chapters");
    mkdirSync(chaptersDir, { recursive: true });
    symlinkSync(join(base, "never-created"), join(chaptersDir, "卷02"), "junction");
    expect(resolveChapterFile(chaptersDir, "卷02/0001_x.md")).toBeNull();
  });

  it("章节目录本身是悬空链接时拒绝", () => {
    const base = tempBase("core-guard-root-dangling-");
    const book = join(base, "book");
    mkdirSync(book, { recursive: true });
    symlinkSync(join(base, "gone"), join(book, "chapters"), "junction");
    expect(resolveChapterFile(join(book, "chapters"), "卷01/0001_x.md")).toBeNull();
  });

  it("章节目录尚不存在时只做字符串检查（新书第一次写章）", () => {
    const base = tempBase("core-guard-missing-");
    const chaptersDir = join(base, "book", "chapters");
    expect(resolveChapterFile(chaptersDir, "卷01/0001_x.md")).toBe(join(chaptersDir, "卷01", "0001_x.md"));
  });

  it("目录内尚未创建的卷目录与文件正常放行", () => {
    const base = tempBase("core-guard-new-");
    const chaptersDir = join(base, "chapters");
    mkdirSync(chaptersDir, { recursive: true });
    expect(resolveChapterFile(chaptersDir, "卷09/0099_新章.md")).toBe(join(chaptersDir, "卷09", "0099_新章.md"));
  });
});

describe("createChapterFileResolver：一次批量解析只 realpath 章节目录一次", () => {
  it("同一个解析器连续判定 50 个文件名，章节目录的 realpath 只算一次", () => {
    const base = tempBase("core-guard-cache-");
    const chaptersDir = join(base, "chapters");
    mkdirSync(join(chaptersDir, "卷01"), { recursive: true });
    const resolver = createChapterFileResolver(chaptersDir);
    fsCalls.realpath.length = 0;
    for (let number = 1; number <= 50; number += 1) {
      expect(resolver(`卷01/${String(number).padStart(4, "0")}_x.md`)).not.toBeNull();
    }
    const rootCalls = fsCalls.realpath.filter((path) => resolve(path) === resolve(chaptersDir));
    expect(rootCalls).toHaveLength(1);
  });
});

describe("state-bootstrap 的索引路径解析与 novel-plugin 共用同一守卫", () => {
  function bookWithIndex(fileName: string) {
    const base = tempBase("core-guard-bootstrap-");
    const chaptersDir = join(base, "book", "chapters");
    mkdirSync(chaptersDir, { recursive: true });
    writeFileSync(join(chaptersDir, "index.json"), JSON.stringify([{ number: 1, title: "x", fileName }]), "utf8");
    return { base, chaptersDir };
  }

  it("索引 fileName 经目录联接指向书外时，不返回书外文件", async () => {
    const { base, chaptersDir } = bookWithIndex("卷01/0001_x.md");
    const outside = join(base, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "0001_x.md"), "OUTSIDE", "utf8");
    symlinkSync(outside, join(chaptersDir, "卷01"), "junction");
    expect(await resolveChapterFilePath(chaptersDir, 1)).toBeNull();
  });

  it("正常的卷目录路径与旧索引的 chapters/ 前缀仍可解析", async () => {
    const { chaptersDir } = bookWithIndex("chapters/卷01/0001_x.md");
    mkdirSync(join(chaptersDir, "卷01"), { recursive: true });
    writeFileSync(join(chaptersDir, "卷01", "0001_x.md"), "# x", "utf8");
    expect(await resolveChapterFilePath(chaptersDir, 1)).toBe(join(chaptersDir, "卷01", "0001_x.md"));
  });
});
