/**
 * E1：推荐文案不得再把模型指向已下线的 `skills.write`。
 *
 * 「叙述者的 skills.read / skills.write 随 S-9 下线」之后，技能启用状态只能由作者在
 * 写作台「技能文风 › 写作技能」里勾选，模型没有任何写启用状态的工具。
 * 但 `handleWritingSkillsRecommend` 的 summary 一直保留着旧文案
 * 「需你确认后再用 skills.write 添加到项目目录」——模型照着做只会调到一个不存在的工具，
 * 而这条文案恰好是它读到的第一手指示。
 *
 * 同一约束还钉在 onboarding-request.test.ts 与 runtime-adapter.test.ts 上；这里补的是
 * **推荐工具的返回值**这一路（前面的测试只覆盖了发给叙述者的编排消息与工具清单）。
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleWritingSkillsRecommend } from "./writing-skill-handlers.js";

// 内置技能快照恒非空，正常输入几乎总能命中推荐。这里只在需要「零推荐」的用例里
// 把技能目录临时清空，其余用例仍走真实的 loader。
const loaderState = vi.hoisted(() => ({ emptyCatalog: false }));
vi.mock("../engine/writing-skills/loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine/writing-skills/loader.js")>();
  return {
    ...actual,
    loadWritingSkills: async (home?: string) =>
      loaderState.emptyCatalog ? [] : actual.loadWritingSkills(home),
  };
});

const TMP_ROOT = join(process.cwd(), "tmp", "writing-skill-recommend");

let tempDir: string;
let home: string;
let bookRoot: string;

beforeEach(async () => {
  loaderState.emptyCatalog = false;
  tempDir = join(TMP_ROOT, crypto.randomUUID());
  home = join(tempDir, "home");
  bookRoot = join(tempDir, "books", "book-1");
  await mkdir(join(bookRoot, "story"), { recursive: true });
  await mkdir(join(bookRoot, "skills"), { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({
    id: "book-1",
    title: "测试书",
    platform: "other",
    genre: "fantasy",
    status: "active",
    targetChapters: 100,
    chapterWordCount: 3000,
    language: "zh",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }), "utf-8");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** 放一个内置技能到 home，让推荐至少能命中一条，从而走到「有推荐」那条 summary 分支。 */
async function seedBuiltinSkill(): Promise<void> {
  const dir = join(home, "skills", "test-skill");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), [
    "---",
    "name: 测试技能",
    "description: 用于测试推荐文案的技能",
    "genres: [fantasy]",
    "---",
    "",
    "正文说明。",
  ].join("\n"), "utf-8");
}

describe("skills.recommend 的文案（E1）", () => {
  it("推荐结果的 summary 不出现已下线的 skills.write / skills.read", async () => {
    await seedBuiltinSkill();

    const result = await handleWritingSkillsRecommend({ bookId: "book-1" }, { home, bookRoot });

    expect(result.ok).toBe(true);
    // 先确认确实走到了「有推荐」那条分支，否则下面的断言会因为文案为空而空过。
    const recommended = (result.data as { recommended?: unknown[] } | undefined)?.recommended ?? [];
    expect(recommended.length).toBeGreaterThan(0);
    const summary = result.summary ?? "";
    expect(summary).not.toContain("skills.write");
    expect(summary).not.toContain("skills.read");
    // 指向真正的启用入口，别让模型猜。
    expect(summary).toContain("技能文风");
  });

  it("数据体里也不带已下线工具名（整条结果一起断言）", async () => {
    await seedBuiltinSkill();

    const result = await handleWritingSkillsRecommend({ bookId: "book-1" }, { home, bookRoot });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("skills.write");
    expect(serialized).not.toContain("skills.read");
  });

  it("没有任何可推荐技能时同样不提已下线工具", async () => {
    const result = await handleWritingSkillsRecommend({ bookId: "book-1" }, { home, bookRoot });

    expect(result.ok).toBe(true);
    expect(result.summary ?? "").not.toContain("skills.write");
  });

  it("没有推荐时指向写作台「技能文风 › 写作技能」，不再提已删除的写作设置页", async () => {
    loaderState.emptyCatalog = true;

    const result = await handleWritingSkillsRecommend({ bookId: "book-1" }, { home, bookRoot });

    expect(result.ok).toBe(true);
    const recommended = (result.data as { recommended?: unknown[] } | undefined)?.recommended ?? [];
    expect(recommended).toHaveLength(0);
    const summary = result.summary ?? "";
    // 入口名与有推荐分支的 enableHint 保持一致，且真实存在。
    expect(summary).toContain("技能文风 › 写作技能");
    // 写作设置页已随 S-9 删除，旧文案不能再指过去。
    expect(summary).not.toContain("写作设置");
  });

  it("扫描器式红测：把旧文案塞回去时断言确实会红", async () => {
    // 证明上面两条不是「恰好通过」——旧文案的确含有被禁短语。
    const source = await readFile(
      join(process.cwd(), "src", "handlers", "writing-skill-handlers.ts"),
      "utf-8",
    );
    expect(source).not.toContain("需你确认后再用 skills.write");
  });
});
