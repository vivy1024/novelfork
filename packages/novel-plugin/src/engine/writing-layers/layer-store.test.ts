import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  formatAuthorProfileForInjection,
  parseAuthorProfile,
} from "@vivy1024/novelfork-core";

import {
  AUTHOR_PROFILE_RELATIVE_PATH,
  isAuthorProfileEnabled,
  loadAuthorProfile,
  resolveAuthorHome,
  resolveWritingLayers,
  saveAuthorProfile,
  saveBookDesign,
  saveBookRules,
} from "./layer-store.js";

const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-author-profile-"));
  tempDirs.push(dir);
  return dir;
}

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
  it("keeps author habits off unless a book explicitly enables them", () => {
    expect(isAuthorProfileEnabled(undefined)).toBe(false);
    expect(isAuthorProfileEnabled({})).toBe(false);
    expect(isAuthorProfileEnabled({ authorProfileEnabled: false })).toBe(false);
    expect(isAuthorProfileEnabled({ authorProfileEnabled: true })).toBe(true);
  });

  it("does not inject author habits into an unrelated book", async () => {
    const home = await tempHome();
    const bookA = await tempBook();
    const bookB = await tempBook();
    await saveAuthorProfile({
      version: 1,
      habits: "短句推进，少抒情。",
      styleNotes: "对话要硬。",
      avoidances: ["圣母"],
    }, home);
    await saveBookRules(bookA, "---\nprohibitions:\n  - 本书 A 禁忌\n---\nA 的专属规则。\n");
    await saveBookRules(bookB, "---\nprohibitions:\n  - 本书 B 禁忌\n---\nB 的专属规则。\n");
    await saveBookDesign(bookA, { authorIntent: "A 的长期方向。", currentFocus: "A 近三章推进药园。" });
    await saveBookDesign(bookB, { authorIntent: "B 的长期方向。", currentFocus: "B 近三章推进朝堂。" });

    const enabledA = await resolveWritingLayers({
      bookRoot: bookA,
      book: { authorProfileEnabled: true },
      home,
    });
    const isolatedB = await resolveWritingLayers({
      bookRoot: bookB,
      book: { authorProfileEnabled: false },
      home,
    });

    expect(enabledA.authorHabitsText).toContain("短句推进");
    expect(enabledA.bookRulesText).toContain("本书 A 禁忌");
    expect(enabledA.bookDesignText).toContain("A 的长期方向");
    expect(isolatedB.authorHabitsText).toBe("");
    expect(isolatedB.bookRulesText).toContain("本书 B 禁忌");
    expect(isolatedB.bookRulesText).not.toContain("本书 A 禁忌");
    expect(isolatedB.bookDesignText).toContain("B 的长期方向");
    expect(isolatedB.bookDesignText).not.toContain("A 的长期方向");
    expect(isolatedB.bookRulesRaw).toContain("本书 B 禁忌");
    expect(enabledA.bookRulesRaw).toContain("本书 A 禁忌");
  });

  it("persists author profile under the author home, not the book root", async () => {
    const home = await tempHome();
    await saveAuthorProfile({
      version: 1,
      habits: "跨书习惯只存在作者目录。",
      styleNotes: "",
      avoidances: [],
    }, home);
    const loaded = await loadAuthorProfile(home);
    expect(loaded.habits).toContain("跨书习惯只存在作者目录");
    expect(formatAuthorProfileForInjection(parseAuthorProfile(loaded))).toContain("跨书习惯");
    const persisted = await readFile(join(home, AUTHOR_PROFILE_RELATIVE_PATH), "utf8");
    expect(persisted).toContain("跨书习惯只存在作者目录");
  });

  it("uses NOVELFORK_PROJECT_ROOT instead of the real user home", () => {
    const previous = process.env.NOVELFORK_PROJECT_ROOT;
    process.env.NOVELFORK_PROJECT_ROOT = join(tmpdir(), "novelfork-isolated-home");
    try {
      expect(resolveAuthorHome()).toBe(process.env.NOVELFORK_PROJECT_ROOT);
      expect(resolveAuthorHome("D:/explicit-author-home")).toBe("D:/explicit-author-home");
    } finally {
      if (previous === undefined) delete process.env.NOVELFORK_PROJECT_ROOT;
      else process.env.NOVELFORK_PROJECT_ROOT = previous;
    }
  });

  it("treats missing files as empty layers instead of failing", async () => {
    const bookRoot = await tempBook();
    const resolved = await resolveWritingLayers({
      bookRoot,
      book: { authorProfileEnabled: true },
      home: await tempHome(),
    });
    expect(resolved.authorHabitsText).toBe("");
    expect(resolved.bookRulesRaw).toBe("");
    expect(resolved.bookRulesText).toBe("");
    expect(resolved.bookDesignText).toBe("");
  });
});
