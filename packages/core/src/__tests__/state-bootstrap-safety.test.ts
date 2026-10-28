/**
 * 结构化状态 bootstrap 的写盘安全：
 * - 只有 ENOENT 才创建；EBUSY/EPERM 等读错误抛出且不覆写；
 * - 内容无效先留底再重建；
 * - 内容没变不写 manifest；
 * - writeIfMissing 只在文件确实不存在时创建。
 */
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({
  readFile: null as null | ((path: string) => Error | null),
  stat: null as null | ((path: string) => Error | null),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const overrides = {
    readFile: (async (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      const injected = faults.readFile?.(String(path));
      if (injected) throw injected;
      return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof actual.readFile,
    stat: (async (path: Parameters<typeof actual.stat>[0], ...rest: unknown[]) => {
      const injected = faults.stat?.(String(path));
      if (injected) throw injected;
      return (actual.stat as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof actual.stat,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

import { bootstrapStructuredStateFromMarkdown, RuntimeStateFileError } from "../state/state-bootstrap.js";
import { StateManager } from "../state/manager.js";

function fsError(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: injected`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

const normalize = (path: string) => path.replaceAll("\\", "/");

let root = "";

beforeEach(async () => {
  faults.readFile = null;
  faults.stat = null;
  root = await mkdtemp(join(tmpdir(), "novelfork-state-bootstrap-safety-"));
});

afterEach(async () => {
  faults.readFile = null;
  faults.stat = null;
  await rm(root, { recursive: true, force: true });
});

const STATE_FILES = {
  "manifest.json": { schemaVersion: 2, language: "zh", lastAppliedChapter: 0, projectionVersion: 1, migrationWarnings: [] },
  "current_state.json": { chapter: 0, facts: [{ subject: "林月", predicate: "位于", object: "河埠", validFromChapter: 0, validUntilChapter: null, sourceChapter: 0 }] },
  "hooks.json": { hooks: [] },
  "chapter_summaries.json": { rows: [] },
} as const;

async function seedBook(): Promise<{ bookDir: string; stateDir: string }> {
  const bookDir = join(root, "book");
  const stateDir = join(bookDir, "story", "state");
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(bookDir, "story", "current_state.md"), "# 当前状态\n\n| 字段 | 值 |\n|---|---|\n| 当前章节 | 0 |\n", "utf-8");
  for (const [name, value] of Object.entries(STATE_FILES)) {
    await writeFile(join(stateDir, name), JSON.stringify(value, null, 2), "utf-8");
  }
  return { bookDir, stateDir };
}

async function snapshotState(stateDir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of Object.keys(STATE_FILES)) result[name] = await readFile(join(stateDir, name), "utf-8");
  return result;
}

describe("bootstrapStructuredStateFromMarkdown 写盘安全", () => {
  for (const name of ["current_state.json", "hooks.json", "chapter_summaries.json", "manifest.json"] as const) {
    it(`${name} 读到 EBUSY 时抛出带 explanation 的错误，四份状态文件都不被覆写`, async () => {
      const { bookDir, stateDir } = await seedBook();
      const before = await snapshotState(stateDir);
      faults.readFile = (path) => (normalize(path).endsWith(`story/state/${name}`) ? fsError("EBUSY") : null);

      const failure = await bootstrapStructuredStateFromMarkdown({ bookDir }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(RuntimeStateFileError);
      expect((failure as RuntimeStateFileError).explanation).toMatchObject({
        whatHappened: expect.stringContaining(name),
        whyItMatters: expect.any(String),
        suggestedAction: expect.any(String),
      });
      faults.readFile = null;
      expect(await snapshotState(stateDir)).toEqual(before);
    });
  }

  it("内容没变时不重写 manifest.json（读路径不改文件）", async () => {
    const { bookDir, stateDir } = await seedBook();
    await bootstrapStructuredStateFromMarkdown({ bookDir });
    const manifestPath = join(stateDir, "manifest.json");
    const firstMtime = (await stat(manifestPath)).mtimeMs;
    const firstContent = await readFile(manifestPath, "utf-8");
    await new Promise((resolve) => setTimeout(resolve, 30));

    await bootstrapStructuredStateFromMarkdown({ bookDir });

    expect(await readFile(manifestPath, "utf-8")).toBe(firstContent);
    expect((await stat(manifestPath)).mtimeMs).toBe(firstMtime);
  });

  it("状态文件内容无效时先改名留底，再按 markdown 重建，告警里写明留底文件名", async () => {
    const { bookDir, stateDir } = await seedBook();
    await writeFile(join(stateDir, "hooks.json"), "{ 坏掉的 JSON", "utf-8");

    const result = await bootstrapStructuredStateFromMarkdown({ bookDir });

    const names = await readdir(stateDir);
    const backup = names.find((entry) => entry.startsWith("hooks.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(stateDir, backup!), "utf-8")).toBe("{ 坏掉的 JSON");
    expect(result.warnings.some((warning) => warning.includes(backup!))).toBe(true);
    expect(JSON.parse(await readFile(join(stateDir, "hooks.json"), "utf-8"))).toEqual({ hooks: [] });
  });

  it("状态文件不存在（ENOENT）时照常创建", async () => {
    const bookDir = join(root, "fresh");
    await mkdir(bookDir, { recursive: true });
    const result = await bootstrapStructuredStateFromMarkdown({ bookDir });
    expect([...result.createdFiles].sort()).toEqual(["chapter_summaries.json", "current_state.json", "hooks.json", "manifest.json"]);
  });
});

describe("StateManager.writeIfMissing（经 ensureControlDocumentsAt）", () => {
  it("stat 失败（EPERM）时不拿默认模板覆盖作者已写的 author_intent.md", async () => {
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });
    const intentPath = join(bookDir, "story", "author_intent.md");
    await writeFile(intentPath, "作者自己写的长期方向。\n", "utf-8");
    faults.stat = (path) => (normalize(path).endsWith("story/author_intent.md") ? fsError("EPERM") : null);

    const manager = new StateManager(root);
    await manager.ensureControlDocumentsAt(bookDir, "zh");

    faults.stat = null;
    expect(await readFile(intentPath, "utf-8")).toBe("作者自己写的长期方向。\n");
  });

  it("文件不存在时创建默认模板", async () => {
    const bookDir = join(root, "book");
    const manager = new StateManager(root);
    await manager.ensureControlDocumentsAt(bookDir, "zh");
    expect(await readFile(join(bookDir, "story", "current_focus.md"), "utf-8")).toContain("当前聚焦");
  });
});
