import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createMarketRouter } from "./market.js";

const tempDirs: string[] = [];
const previousMarketDir = process.env.NOVELFORK_MARKET_DIR;

afterEach(async () => {
  if (previousMarketDir === undefined) delete process.env.NOVELFORK_MARKET_DIR;
  else process.env.NOVELFORK_MARKET_DIR = previousMarketDir;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function isolatedApp(): Promise<ReturnType<typeof createMarketRouter>> {
  const rootDir = await mkdtemp(join(tmpdir(), "novelfork-market-api-"));
  tempDirs.push(rootDir);
  process.env.NOVELFORK_MARKET_DIR = rootDir;
  return createMarketRouter();
}

describe("market router", () => {
  it("lists rank catalogs including an empty custom list", async () => {
    const app = await isolatedApp();
    const response = await app.request("/api/market/ranks");
    expect(response.status).toBe(200);
    const body = await response.json() as { qidian: unknown[]; fanqie: unknown[]; custom: unknown[] };
    expect(body.qidian).toHaveLength(4);
    expect(body.fanqie).toHaveLength(4);
    expect(body.custom).toEqual([]);
  });

  it("rejects off-platform custom ranks and round-trips a same-host rank", async () => {
    const app = await isolatedApp();
    const blocked = await app.request("/api/market/ranks/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "evil",
        name: "外站",
        platform: "qidian",
        url: "https://example.com/rank",
      }),
    });
    expect(blocked.status).toBe(400);

    const created = await app.request("/api/market/ranks/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "male_collect",
        name: "男频收藏榜",
        platform: "fanqie",
        url: "https://fanqienovel.com/rank/male_collect",
      }),
    });
    expect(created.status).toBe(200);
    const listed = await app.request("/api/market/ranks");
    const body = await listed.json() as { custom: Array<{ key: string }> };
    expect(body.custom.map((rank) => rank.key)).toEqual(["male_collect"]);

    const removed = await app.request("/api/market/ranks/custom/male_collect", { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await app.request("/api/market/ranks/custom/missing", { method: "DELETE" })).status).toBe(404);

    const probeBlocked = await app.request("/api/market/ranks/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "qidian", url: "https://evil.com" }),
    });
    expect(probeBlocked.status).toBe(400);
  });

  it("round-trips scan prefs and merges lexicon aliases", async () => {
    const app = await isolatedApp();
    const emptyPrefs = await app.request("/api/market/scan-prefs");
    expect(await emptyPrefs.json()).toEqual({ ok: true, prefs: null });

    const saved = await app.request("/api/market/scan-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "qidian",
        rankTypes: ["newbook"],
        categories: ["玄幻"],
        limit: 12,
      }),
    });
    expect(saved.status).toBe(200);
    const loaded = await app.request("/api/market/scan-prefs");
    expect(await loaded.json()).toEqual({
      ok: true,
      prefs: {
        platform: "qidian",
        rankTypes: ["newbook"],
        categories: ["玄幻"],
        limit: 12,
      },
    });

    const lexicon = await app.request("/api/market/lexicon", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aliases: { 诸天: ["无限"] } }),
    });
    expect(lexicon.status).toBe(200);
    const body = await lexicon.json() as { lexicon: { aliases: Record<string, string[]> } };
    expect(body.lexicon.aliases["诸天"]).toEqual(expect.arrayContaining(["诸天", "无限"]));
    expect(body.lexicon.aliases["玄幻"]).toEqual(expect.arrayContaining(["玄幻"]));
  });
});
