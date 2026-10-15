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
    expect(config.settlement.autoChapterSummary).toBe(true);
    expect(config.retrieval.waveEnabled).toBe(false);
    expect(config.retrieval.channels.facts).toBe(true);
  });

  it("merges partial stored config and persists patches", async () => {
    const root = await tempBook("book-1", {
      narrativeMemory: { settlement: { autoApplyMediumRisk: false, minConfidence: 0.9, autoChapterSummary: false } },
    });
    const loaded = await loadNarrativeMemoryConfig("book-1", root);
    expect(loaded.settlement.autoApplyMediumRisk).toBe(false);
    expect(loaded.settlement.minConfidence).toBe(0.9);
    expect(loaded.settlement.autoChapterSummary).toBe(false);
    expect(loaded.settlement.enabled).toBe(true);

    const saved = await saveNarrativeMemoryConfig("book-1", root, {
      retrieval: { maxTokens: 5000, waveEnabled: true, channels: { facts: false } },
    });
    expect(saved.retrieval.maxTokens).toBe(5000);
    expect(saved.retrieval.waveEnabled).toBe(true);
    expect(saved.retrieval.channels.facts).toBe(false);
    expect(saved.retrieval.channels.timeline).toBe(true);
    expect(saved.retrieval.writeProfile).toEqual({ coreCharacters: 6, activeHooks: 8, recentSummaries: 3 });
    expect(saved.settlement.autoApplyMediumRisk).toBe(false);

    const raw = JSON.parse(await readFile(join(root, "book.json"), "utf8")) as {
      narrativeMemory?: { retrieval?: { maxTokens?: number } };
    };
    expect(raw.narrativeMemory?.retrieval?.maxTokens).toBe(5000);
  });

  it("persists write-profile caps independently of other retrieval fields", async () => {
    const root = await tempBook("book-1");
    const saved = await saveNarrativeMemoryConfig("book-1", root, {
      retrieval: { writeProfile: { coreCharacters: 4, recentSummaries: 5 } },
    });
    expect(saved.retrieval.writeProfile).toEqual({ coreCharacters: 4, activeHooks: 8, recentSummaries: 5 });
    expect(saved.retrieval.maxTokens).toBe(DEFAULT_NARRATIVE_MEMORY_CONFIG.retrieval.maxTokens);

    const reloaded = await loadNarrativeMemoryConfig("book-1", root);
    expect(reloaded.retrieval.writeProfile.coreCharacters).toBe(4);
    expect(reloaded.retrieval.writeProfile.recentSummaries).toBe(5);
  });

  it("rejects invalid patch values", () => {
    expect(() => parseNarrativeMemoryConfigPatch({ settlement: { minConfidence: 2 } })).toThrow();
  });

  // 2026-10-15：高风险待确认事件一律停写，放行只走 NarraFork 的权限通道，NovelFork 不再有本书开关。
  it("高风险待确认没有本书开关：默认配置不含 blockWriteOnHighRiskPending", () => {
    expect(DEFAULT_NARRATIVE_MEMORY_CONFIG.settlement).not.toHaveProperty("blockWriteOnHighRiskPending");
  });

  it("旧书 book.json 残留 blockWriteOnHighRiskPending：读取时忽略、其他字段照常，下次保存时清掉", async () => {
    const root = await tempBook("book-1", {
      narrativeMemory: { settlement: { blockWriteOnHighRiskPending: true, minConfidence: 0.9 } },
    });

    const loaded = await loadNarrativeMemoryConfig("book-1", root);
    expect(loaded.settlement).not.toHaveProperty("blockWriteOnHighRiskPending");
    expect(loaded.settlement.minConfidence).toBe(0.9);

    const saved = await saveNarrativeMemoryConfig("book-1", root, { settlement: { autoApplyLowRisk: false } });
    expect(saved.settlement).not.toHaveProperty("blockWriteOnHighRiskPending");
    const raw = JSON.parse(await readFile(join(root, "book.json"), "utf8")) as {
      narrativeMemory?: { settlement?: Record<string, unknown> };
    };
    expect(raw.narrativeMemory?.settlement).not.toHaveProperty("blockWriteOnHighRiskPending");
    expect(raw.narrativeMemory?.settlement?.minConfidence).toBe(0.9);
    expect(raw.narrativeMemory?.settlement?.autoApplyLowRisk).toBe(false);
  });

  it("旧客户端仍提交该字段时不报错，也不落进配置", () => {
    expect(() => parseNarrativeMemoryConfigPatch({ settlement: { blockWriteOnHighRiskPending: false } })).not.toThrow();
  });
});
