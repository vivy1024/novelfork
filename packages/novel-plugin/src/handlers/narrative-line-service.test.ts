/**
 * 叙事线存储（story/narrative_line.json）的写盘安全：
 * - 文件写坏后不当空：先留底再抛错，下次 apply 不会抹掉全部节点；
 * - 读不到（EBUSY）不当空；
 * - 同一本书的并发 apply 串行，后写的不覆盖先写的；
 * - 写入是原子替换，不留临时文件。
 */
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({ readFile: null as null | ((path: string) => Error | null) }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const overrides = {
    readFile: (async (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      const injected = faults.readFile?.(String(path));
      if (injected) throw injected;
      return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof actual.readFile,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

import { createNarrativeLineService } from "./narrative-line-service.js";
import type { NarrativeLineMutationPreview } from "./narrative-line-types.js";

const BOOK_ID = "book-line";
let bookRoot = "";

beforeEach(async () => {
  faults.readFile = null;
  bookRoot = await mkdtemp(join(tmpdir(), "novelfork-narrative-line-service-"));
  await mkdir(join(bookRoot, "story"), { recursive: true });
});

afterEach(async () => {
  faults.readFile = null;
  await rm(bookRoot, { recursive: true, force: true });
});

function service() {
  return createNarrativeLineService({
    state: {
      bookDir: () => bookRoot,
      loadChapterIndex: async () => [],
    },
    // 不接产品库：投影走空集，只测叙事线文件本身。
    storage: undefined,
  } as never);
}

function preview(id: string, nodeId: string): NarrativeLineMutationPreview {
  return {
    id,
    bookId: BOOK_ID,
    summary: `添加 ${nodeId}`,
    nodes: [{ id: nodeId, bookId: BOOK_ID, type: "beat", title: nodeId, summary: `${nodeId} 的说明` }] as never,
    edges: [],
    warnings: [],
  };
}

const storePath = () => join(bookRoot, "story", "narrative_line.json");

async function storeNodeIds(): Promise<string[]> {
  const parsed = JSON.parse(await readFile(storePath(), "utf8")) as { nodes: Array<{ id: string }> };
  return parsed.nodes.map((node) => node.id);
}

describe("叙事线存储写盘安全", () => {
  it("narrative_line.json 写坏后 apply 抛错并留底，不会把已有节点抹成新的一条", async () => {
    const svc = service();
    await svc.applyChange({ bookId: BOOK_ID, preview: preview("p1", "node-a"), decision: "approved" });
    const good = await readFile(storePath(), "utf8");
    const broken = good.slice(0, Math.floor(good.length / 2));
    await writeFile(storePath(), broken, "utf8");

    await expect(svc.applyChange({ bookId: BOOK_ID, preview: preview("p2", "node-b"), decision: "approved" }))
      .rejects.toThrow(/narrative_line\.json\.corrupt-/u);

    const names = await readdir(join(bookRoot, "story"));
    const backup = names.find((name) => name.startsWith("narrative_line.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(bookRoot, "story", backup!), "utf8")).toBe(broken);
    expect(names).not.toContain("narrative_line.json");
  });

  it("读 narrative_line.json 遇到 EBUSY 时抛错，文件原样", async () => {
    const svc = service();
    await svc.applyChange({ bookId: BOOK_ID, preview: preview("p1", "node-a"), decision: "approved" });
    const before = await readFile(storePath(), "utf8");
    faults.readFile = (path) => {
      if (!path.replaceAll("\\", "/").endsWith("story/narrative_line.json")) return null;
      const error = new Error("EBUSY: resource busy or locked") as NodeJS.ErrnoException;
      error.code = "EBUSY";
      return error;
    };

    await expect(svc.applyChange({ bookId: BOOK_ID, preview: preview("p2", "node-b"), decision: "approved" }))
      .rejects.toThrow(/EBUSY/u);

    faults.readFile = null;
    expect(await readFile(storePath(), "utf8")).toBe(before);
  });

  it("同一本书并发 apply 串行执行，所有节点都保留", async () => {
    const svc = service();
    await Promise.all(Array.from({ length: 8 }, (_, i) => svc.applyChange({
      bookId: BOOK_ID,
      preview: preview(`p${i}`, `node-${i}`),
      decision: "approved",
    })));

    expect((await storeNodeIds()).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `node-${i}`).sort());
    const names = await readdir(join(bookRoot, "story"));
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("文件不存在时按空处理并正常创建", async () => {
    const svc = service();
    await svc.applyChange({ bookId: BOOK_ID, preview: preview("p1", "node-a"), decision: "approved" });
    expect(await storeNodeIds()).toEqual(["node-a"]);
  });
});
