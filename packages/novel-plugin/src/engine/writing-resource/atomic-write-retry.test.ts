/**
 * writeFileAtomic 的 rename 退避重试：Windows 上目标被别的句柄读着时 rename 报 EPERM，稍等即可。
 * rename 通过 mock 注入失败次数，其余文件操作走真实文件系统。
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ failures: 0, code: "EPERM", calls: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const overrides = {
    rename: (async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      control.calls += 1;
      if (control.failures > 0) {
        control.failures -= 1;
        const error = new Error(`${control.code}: injected rename failure`) as NodeJS.ErrnoException;
        error.code = control.code;
        throw error;
      }
      return actual.rename(from, to);
    }) as typeof actual.rename,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

import { ATOMIC_RENAME_MAX_RETRIES, writeFileAtomic } from "./atomic-write.js";

let dir = "";

beforeEach(async () => {
  control.failures = 0;
  control.code = "EPERM";
  control.calls = 0;
  dir = await mkdtemp(join(tmpdir(), "novelfork-atomic-retry-"));
});

afterEach(async () => {
  control.failures = 0;
  await rm(dir, { recursive: true, force: true });
});

const tmpLeftovers = async () => (await readdir(dir)).filter((name) => name.endsWith(".tmp"));

describe("writeFileAtomic rename 重试", () => {
  it("rename 前 3 次 EPERM、之后成功：最终写入成功，不留临时文件", async () => {
    const target = join(dir, "index.json");
    await writeFile(target, "旧内容", "utf8");
    control.failures = 3;

    await writeFileAtomic(target, "新内容");

    expect(await readFile(target, "utf8")).toBe("新内容");
    expect(control.calls).toBe(4);
    expect(await tmpLeftovers()).toEqual([]);
  });

  it("EACCES / EBUSY 同样重试", async () => {
    for (const code of ["EACCES", "EBUSY"]) {
      control.code = code;
      control.failures = 2;
      control.calls = 0;
      await writeFileAtomic(join(dir, `${code}.json`), code);
      expect(await readFile(join(dir, `${code}.json`), "utf8")).toBe(code);
      expect(control.calls).toBe(3);
    }
  });

  it("一直 EPERM：重试用尽后抛出原始错误，目标原样，临时文件清理干净", async () => {
    const target = join(dir, "index.json");
    await writeFile(target, "旧内容", "utf8");
    control.failures = Number.POSITIVE_INFINITY;

    const started = Date.now();
    await expect(writeFileAtomic(target, "新内容")).rejects.toMatchObject({ code: "EPERM" });

    expect(control.calls).toBe(ATOMIC_RENAME_MAX_RETRIES + 1);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(await readFile(target, "utf8")).toBe("旧内容");
    expect(await tmpLeftovers()).toEqual([]);
  });

  it("ENOENT 不重试，直接抛出", async () => {
    control.code = "ENOENT";
    control.failures = 1;

    await expect(writeFileAtomic(join(dir, "a.json"), "x")).rejects.toMatchObject({ code: "ENOENT" });

    expect(control.calls).toBe(1);
    expect(await tmpLeftovers()).toEqual([]);
  });
});
