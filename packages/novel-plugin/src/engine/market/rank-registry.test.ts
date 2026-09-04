import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveRankKeys } from "./index.js";
import { deleteCustomRank, listRankRegistry, upsertCustomRank, validateCustomRank } from "./rank-registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("market rank registry", () => {
  it("rejects off-platform URLs as SSRF", () => {
    const result = validateCustomRank({
      key: "evil",
      name: "外站",
      platform: "qidian",
      url: "https://example.com/rank",
    }, { customKeys: new Set() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((item) => item.includes("qidian.com"))).toBe(true);
  });

  it("rejects keys that would shadow a builtin rank", () => {
    const result = validateCustomRank({
      key: "newbook",
      name: "伪新书榜",
      platform: "qidian",
      url: "https://www.qidian.com/rank/newbook/",
    }, { customKeys: new Set() });
    expect(result.ok).toBe(false);
  });

  it("stores a same-host custom rank and keeps it off the other platform", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "novelfork-ranks-"));
    tempDirs.push(rootDir);
    const saved = await upsertCustomRank({
      key: "male_collect",
      name: "男频收藏榜",
      platform: "fanqie",
      url: "https://fanqienovel.com/rank/male_collect",
    }, { rootDir });
    expect(saved.ok).toBe(true);
    const registry = await listRankRegistry({ rootDir });
    expect(registry.platformOf.get("male_collect")).toBe("fanqie");
    expect(registry.lookup.get("male_collect")?.name).toBe("男频收藏榜");
    expect(resolveRankKeys("qidian", ["male_collect"], registry)).toEqual([]);
    expect(resolveRankKeys("fanqie", ["male_collect"], registry)).toEqual(["male_collect"]);
    expect(await deleteCustomRank("male_collect", { rootDir })).toBe(true);
    expect((await listRankRegistry({ rootDir })).lookup.has("male_collect")).toBe(false);
  });
});
