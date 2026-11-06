import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  resolveWritingLayers,
  saveBookDesign,
} from "./layer-store.js";

const tempDirs: string[] = [];

async function tempBook(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-book-layers-"));
  tempDirs.push(dir);
  await mkdir(join(dir, "story"), { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writing layers", () => {
  it("作者意图按书隔离", async () => {
    const bookA = await tempBook();
    const bookB = await tempBook();
    await saveBookDesign(bookA, { authorIntent: "A 的长期方向。" });
    await saveBookDesign(bookB, { authorIntent: "B 的长期方向。" });

    const resolvedA = await resolveWritingLayers({ bookRoot: bookA });
    const resolvedB = await resolveWritingLayers({ bookRoot: bookB });

    expect(resolvedA.bookDesignText).toContain("A 的长期方向");
    expect(resolvedB.bookDesignText).toContain("B 的长期方向");
    expect(resolvedB.bookDesignText).not.toContain("A 的长期方向");
  });

  it("不传经纬存储时，旧 current_focus.md / book_rules.md 不再被当作当前聚焦与本书规则", async () => {
    const bookRoot = await tempBook();
    await writeFile(join(bookRoot, "story", "current_focus.md"), "旧聚焦\n", "utf8");
    await writeFile(join(bookRoot, "story", "book_rules.md"), "---\nprohibitions:\n  - 旧禁忌\n---\n", "utf8");

    const resolved = await resolveWritingLayers({ bookRoot });

    expect(resolved.bookDesign.currentFocus).toBe("");
    expect(resolved.bookDesignText).not.toContain("旧聚焦");
    expect(resolved.bookRulesText).toBe("");
    expect(resolved.bookRuleEntries).toEqual([]);
  });

  it("treats missing files as empty layers instead of failing", async () => {
    const bookRoot = await tempBook();
    const resolved = await resolveWritingLayers({ bookRoot });
    expect(resolved.bookDesignText).toBe("");
    expect(resolved.bookRulesText).toBe("");
    expect(resolved.styleGuideText).toBe("");
    expect(resolved.stylePreset).toBeNull();
  });

  it("旧统计指纹只作写后对照，不再作为写作指南注入", async () => {
    const bookRoot = await tempBook();
    await writeFile(join(bookRoot, "story", "style_profile.json"), JSON.stringify({ avgSentenceLength: 18, sentenceLengthStdDev: 6, vocabularyDiversity: 0.5 }));
    const resolved = await resolveWritingLayers({ bookRoot });
    expect(resolved.bookDesign.stylePresetSource).toBe("legacy");
    expect(JSON.parse(resolved.bookDesign.styleProfileRaw).avgSentenceLength).toBe(18);
    expect(resolved.styleGuideText).toBe("");
    expect(resolved.stylePreset).toBeNull();
  });
});
