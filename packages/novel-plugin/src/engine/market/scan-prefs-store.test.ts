import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadScanPrefs, normalizeScanPrefs, saveScanPrefs } from "./scan-prefs-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("market scan prefs store", () => {
  it("normalizes platform, ranks, genres and book count", () => {
    expect(normalizeScanPrefs({
      platform: "qidian",
      rankTypes: ["newbook", ""],
      categories: [" 玄幻 ", "玄幻"],
      limit: 12.8,
    })).toEqual({
      platform: "qidian",
      rankTypes: ["newbook"],
      categories: ["玄幻"],
      limit: 12,
    });
    expect(normalizeScanPrefs({ platform: "jjwxc", limit: 0 })).toBeUndefined();
  });

  it("round-trips prefs through the config directory", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "novelfork-prefs-"));
    tempDirs.push(rootDir);
    const saved = await saveScanPrefs({
      platform: "fanqie",
      rankTypes: ["male_read"],
      categories: ["都市"],
      limit: 8,
    }, { rootDir });
    expect(saved).toEqual({
      platform: "fanqie",
      rankTypes: ["male_read"],
      categories: ["都市"],
      limit: 8,
    });
    expect(await loadScanPrefs({ rootDir })).toEqual(saved);
  });
});
