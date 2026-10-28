import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * writeFileAtomic 的 rename 重试：Windows 上目标被别的句柄占着时，rename 覆盖会瞬时报
 * EPERM / EACCES / EBUSY（隔离实测 400 次并发写有 279 次 EPERM）。只对这几种错误码有限次
 * 退避重试；其余错误码立即抛出；重试用尽抛原始错误且不留临时文件。
 */
const renameControl = vi.hoisted(() => ({
  /** 目标路径 → 还要失败几次（Infinity 表示一直失败） */
  failures: new Map<string, { remaining: number; code: string }>(),
  calls: new Map<string, number>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      const key = String(to);
      renameControl.calls.set(key, (renameControl.calls.get(key) ?? 0) + 1);
      const failure = renameControl.failures.get(key);
      if (failure && failure.remaining > 0) {
        failure.remaining -= 1;
        const error = new Error(`${failure.code}: rename '${String(from)}' -> '${key}'`) as NodeJS.ErrnoException;
        error.code = failure.code;
        throw error;
      }
      return actual.rename(from, to);
    },
  };
});

const { writeFileAtomic, ATOMIC_RENAME_MAX_RETRIES } = await import("../utils/atomic-write.js");

const TMP_ROOT = join(process.cwd(), "tmp", "core-atomic-write-retry");

async function leftoverTemporaries(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(".tmp"));
}

describe("writeFileAtomic rename 重试", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(TMP_ROOT, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    renameControl.failures.clear();
    renameControl.calls.clear();
  });

  afterEach(async () => {
    await rm(TMP_ROOT, { recursive: true, force: true });
  });

  it.each(["EPERM", "EACCES", "EBUSY"])("瞬时 %s 几次后成功写入新内容", async (code) => {
    const target = join(dir, "index.json");
    await writeFile(target, "旧", "utf8");
    renameControl.failures.set(target, { remaining: 3, code });

    await writeFileAtomic(target, "新");

    expect(await readFile(target, "utf8")).toBe("新");
    expect(renameControl.calls.get(target)).toBe(4);
    expect(await leftoverTemporaries(dir)).toEqual([]);
  });

  it("一直 EPERM：重试用尽后抛原始错误，旧内容保留、无临时文件残留", async () => {
    const target = join(dir, "chapter.md");
    await writeFile(target, "旧正文", "utf8");
    renameControl.failures.set(target, { remaining: Number.POSITIVE_INFINITY, code: "EPERM" });

    await expect(writeFileAtomic(target, "新正文")).rejects.toMatchObject({ code: "EPERM" });

    expect(renameControl.calls.get(target)).toBe(ATOMIC_RENAME_MAX_RETRIES + 1);
    expect(await readFile(target, "utf8")).toBe("旧正文");
    expect(await leftoverTemporaries(dir)).toEqual([]);
  });

  it("不可重试的错误码（ENOENT）立即抛出，不重试", async () => {
    const target = join(dir, "book.json");
    await writeFile(target, "{}", "utf8");
    renameControl.failures.set(target, { remaining: 1, code: "ENOENT" });

    await expect(writeFileAtomic(target, "{\"a\":1}")).rejects.toMatchObject({ code: "ENOENT" });

    expect(renameControl.calls.get(target)).toBe(1);
    expect(await readFile(target, "utf8")).toBe("{}");
    expect(await leftoverTemporaries(dir)).toEqual([]);
  });
});
