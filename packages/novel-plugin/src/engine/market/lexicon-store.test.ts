import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MARKET_LEXICON,
  loadMarketLexicon,
  matchCategoryAgainstTerms,
  recordMatchesContext,
  saveMarketLexicon,
} from "./lexicon-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("market lexicon", () => {
  it("uses exact, alias, then substring fallback", () => {
    expect(matchCategoryAgainstTerms("玄幻", ["玄幻"])).toBe("exact");
    expect(recordMatchesContext("都市生活", ["都市"], DEFAULT_MARKET_LEXICON)).toBe(true);
    expect(recordMatchesContext("玄幻诸天", ["玄幻"], DEFAULT_MARKET_LEXICON)).toBe(true);
    expect(recordMatchesContext("历史军事", ["游戏"], DEFAULT_MARKET_LEXICON)).toBe(false);
  });

  it("merges user aliases onto the builtin lexicon", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "novelfork-lexicon-"));
    tempDirs.push(rootDir);
    const saved = await saveMarketLexicon({
      aliases: { 诸天: ["无限", "诸天流"] },
    }, { rootDir });
    expect(saved.aliases["诸天"]).toEqual(expect.arrayContaining(["诸天", "无限", "诸天流"]));
    expect(saved.aliases["玄幻"]).toEqual(expect.arrayContaining(["玄幻", "东方玄幻"]));
    expect(await loadMarketLexicon({ rootDir })).toEqual(saved);
    expect(recordMatchesContext("无限", ["诸天"], saved)).toBe(true);
  });

  it("lets a later PUT drop a previously added alias", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "novelfork-lexicon-"));
    tempDirs.push(rootDir);
    await saveMarketLexicon({ aliases: { 诸天: ["无限", "诸天流"] } }, { rootDir });
    const next = await saveMarketLexicon({ aliases: { 诸天: ["无限"] } }, { rootDir });
    expect(next.aliases["诸天"]).toEqual(["诸天", "无限"]);
  });
});
