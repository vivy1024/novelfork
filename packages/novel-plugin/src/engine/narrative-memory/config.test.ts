import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_NARRATIVE_MEMORY_CONFIG,
  loadNarrativeMemoryConfig,
  parseNarrativeMemoryConfigPatch,
  saveNarrativeMemoryConfig,
} from "./config.js";

const tempDirs: string[] = [];

async function tempBook(bookId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const dir = join(tmpdir(), `novelfork-nm-config-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  await writeFile(
    join(dir, "book.json"),
    `${JSON.stringify({ id: bookId, title: "t", ...extra }, null, 2)}\n`,
    "utf8",
  );
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("narrative memory config", () => {
  it("returns product defaults when narrativeMemory is absent", async () => {
    const root = await tempBook("book-1");
    const config = await loadNarrativeMemoryConfig("book-1", root);
    expect(config).toEqual(DEFAULT_NARRATIVE_MEMORY_CONFIG);
    expect(config.settlement.autoApplyMediumRisk).toBe(true);
    expect(config.retrieval.waveEnabled).toBe(false);
    expect(config.retrieval.channels.facts).toBe(true);
  });

  it("merges partial stored config and persists patches", async () => {
    const root = await tempBook("book-1", {
      narrativeMemory: { settlement: { autoApplyMediumRisk: false, minConfidence: 0.9 } },
    });
    const loaded = await loadNarrativeMemoryConfig("book-1", root);
    expect(loaded.settlement.autoApplyMediumRisk).toBe(false);
    expect(loaded.settlement.minConfidence).toBe(0.9);
    expect(loaded.settlement.enabled).toBe(true);

    const saved = await saveNarrativeMemoryConfig("book-1", root, {
      retrieval: { maxTokens: 5000, waveEnabled: true, channels: { facts: false } },
    });
    expect(saved.retrieval.maxTokens).toBe(5000);
    expect(saved.retrieval.waveEnabled).toBe(true);
    expect(saved.retrieval.channels.facts).toBe(false);
    expect(saved.retrieval.channels.timeline).toBe(true);
    expect(saved.settlement.autoApplyMediumRisk).toBe(false);

    const raw = JSON.parse(await readFile(join(root, "book.json"), "utf8")) as {
      narrativeMemory?: { retrieval?: { maxTokens?: number } };
    };
    expect(raw.narrativeMemory?.retrieval?.maxTokens).toBe(5000);
  });

  it("rejects invalid patch values", () => {
    expect(() => parseNarrativeMemoryConfigPatch({ settlement: { minConfidence: 2 } })).toThrow();
  });
});
