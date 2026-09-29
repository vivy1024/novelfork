import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  resolveWritingLayers,
  saveBookDesign,
  saveBookRules,
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
  it("keeps book design and rules isolated per book", async () => {
    const bookA = await tempBook();
    const bookB = await tempBook();
    await saveBookRules(bookA, "---\nprohibitions:\n  - 本书 A 禁忌\n---\nA 的专属规则。\n");
    await saveBookRules(bookB, "---\nprohibitions:\n  - 本书 B 禁忌\n---\nB 的专属规则。\n");
    await saveBookDesign(bookA, { authorIntent: "A 的长期方向。", currentFocus: "A 近三章推进药园。" });
    await saveBookDesign(bookB, { authorIntent: "B 的长期方向。", currentFocus: "B 近三章推进朝堂。" });

    const resolvedA = await resolveWritingLayers({ bookRoot: bookA });
    const resolvedB = await resolveWritingLayers({ bookRoot: bookB });

    expect(resolvedA.bookRulesText).toContain("本书 A 禁忌");
    expect(resolvedA.bookDesignText).toContain("A 的长期方向");
    expect(resolvedB.bookRulesText).toContain("本书 B 禁忌");
    expect(resolvedB.bookRulesText).not.toContain("本书 A 禁忌");
    expect(resolvedB.bookDesignText).toContain("B 的长期方向");
    expect(resolvedB.bookDesignText).not.toContain("A 的长期方向");
    expect(resolvedB.bookRulesRaw).toContain("本书 B 禁忌");
    expect(resolvedA.bookRulesRaw).toContain("本书 A 禁忌");
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
