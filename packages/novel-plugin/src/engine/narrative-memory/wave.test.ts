import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import type { NarrativeContextCard } from "./types.js";
import {
  buildNarrativeTagGraph,
  calculateBellSemanticGain,
  calculateResidualAnchor,
  rebuildNarrativeTagGraph,
} from "./wave/tag-graph.js";
import { analyzeEPA } from "./wave/epa.js";
import { buildResidualPyramid } from "./wave/residual-pyramid.js";
import { routeNarrativeSpikes } from "./wave/spike-routing.js";
import { rerankByGeodesicEnergy } from "./wave/geodesic-rerank.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-wave-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function card(input: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "sourceType" | "sourceId" | "channel" | "title" | "content">): NarrativeContextCard {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    channel: input.channel,
    title: input.title,
    content: input.content,
    normal: input.normal,
    summary: input.summary,
    brief: input.brief ?? input.summary ?? input.content,
    tags: input.tags ?? [],
    entities: input.entities ?? [],
    priority: input.priority ?? 50,
    importance: input.importance ?? 50,
    accessCount: input.accessCount ?? 0,
    lastAccessedAt: input.lastAccessedAt,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    reason: input.reason ?? "test reason",
    estimatedTokens: input.estimatedTokens ?? 20,
    score: input.score,
    scoreBreakdown: input.scoreBreakdown,
  };
}

const cards = [
  card({ id: "c1", sourceType: "jingwei", sourceId: "entry-1", channel: "hooks", title: "小瓶伏笔", content: "韩立的小瓶秘密尚未暴露。", entities: ["韩立", "小瓶"], tags: ["hook", "item"], validFromChapter: 2 }),
  card({ id: "c2", sourceType: "jingwei", sourceId: "entry-2", channel: "timeline", title: "药园", content: "药园最近出现异常。", entities: ["药园"], tags: ["location", "event"], validFromChapter: 10 }),
];

describe("Wave tag graph and algorithms", () => {
  it("builds deterministic narrative tag graph and persists rebuilds idempotently", async () => {
    const graph = buildNarrativeTagGraph(cards, { currentChapter: 12 });
    expect(graph.tags.map((tag) => tag.label)).toEqual(expect.arrayContaining(["韩立", "小瓶", "药园", "hook", "item", "location", "event"]));
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.edges.every((edge) => edge.weight >= 0 && edge.weight <= 1)).toBe(true);

    const storage = await createStorage();
    try {
      const first = rebuildNarrativeTagGraph(storage, "book-1", cards, { currentChapter: 12 });
      const second = rebuildNarrativeTagGraph(storage, "book-1", cards, { currentChapter: 12 });
      expect(second).toEqual(first);
      const tagRows = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_tag WHERE book_id = ?").get("book-1");
      const edgeRows = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_tag_edge WHERE book_id = ?").get("book-1");
      expect(tagRows?.count).toBe(first.tagCount);
      expect(edgeRows?.count).toBe(first.edgeCount);
    } finally {
      storage.close();
    }
  });

  it("computes bell-shaped semantic gain and residual anchor fallback", () => {
    const far = calculateBellSemanticGain(0.05);
    const middle = calculateBellSemanticGain(0.62);
    const tooNear = calculateBellSemanticGain(0.98);
    expect(middle).toBeGreaterThan(far);
    expect(middle).toBeGreaterThan(tooNear);

    const anchored = calculateResidualAnchor([1, 1], [1, 0]);
    expect(anchored.fallback).toBeUndefined();
    expect(anchored.residualVector[0]).toBeCloseTo(0, 5);
    expect(anchored.residualVector[1]).toBeCloseTo(1, 5);
    expect(calculateResidualAnchor([], [1, 0]).fallback).toBe("missing_vector");
  });

  it("returns deterministic EPA values and neutral fallback", () => {
    const epa = analyzeEPA({ queryVector: [1, 0], tagVectors: [[1, 0], [0.2, 0.8], [0, 1]] });
    expect(epa.entropy).toBeGreaterThanOrEqual(0);
    expect(epa.entropy).toBeLessThanOrEqual(1);
    expect(epa.logicDepth).toBeGreaterThanOrEqual(0);
    expect(epa.logicDepth).toBeLessThanOrEqual(1);
    expect(analyzeEPA({}).fallback).toBe("neutral");
  });

  it("builds residual pyramid for compound queries and stops on low residual energy", () => {
    const result = buildResidualPyramid({
      queryVector: [1, 1, 0],
      facets: [
        { tagId: "character:hanli", vector: [1, 0, 0] },
        { tagId: "item:bottle", vector: [0, 1, 0] },
        { tagId: "place:garden", vector: [0, 0, 1] },
      ],
      config: { maxLevels: 3, topK: 1, minEnergyRatio: 0.05 },
    });
    expect(result.levels.map((level) => level.facets[0]?.tagId)).toEqual(["character:hanli", "item:bottle"]);
    expect(result.finalEnergyRatio).toBeLessThan(0.05);
    expect(buildResidualPyramid({ queryVector: [], facets: [] }).fallback).toBe("missing_embedding");
  });

  it("routes narrative spikes with limits and logicDepth momentum", () => {
    const focused = routeNarrativeSpikes({
      seedTagIds: ["tag:a"],
      edges: [
        { sourceTagId: "tag:a", targetTagId: "tag:b", weight: 0.9 },
        { sourceTagId: "tag:b", targetTagId: "tag:c", weight: 0.9 },
      ],
      logicDepth: 0.9,
      config: { maxHops: 3, firingThreshold: 0.1, maxEmergentNodes: 5, maxNeighborsPerNode: 5 },
    });
    const diffuse = routeNarrativeSpikes({
      seedTagIds: ["tag:a"],
      edges: [
        { sourceTagId: "tag:a", targetTagId: "tag:b", weight: 0.9 },
        { sourceTagId: "tag:b", targetTagId: "tag:c", weight: 0.9 },
      ],
      logicDepth: 0.1,
      config: { maxHops: 3, firingThreshold: 0.1, maxEmergentNodes: 5, maxNeighborsPerNode: 5 },
    });
    expect(focused.activatedTags.length).toBeLessThan(diffuse.activatedTags.length);
    expect(diffuse.activatedTags.map((tag) => tag.tagId)).toContain("tag:c");
  });

  it("reranks graph-linked cards without downgrading hard cards and falls back safely", () => {
    const hard = card({ id: "hard", sourceType: "jingwei", sourceId: "rule", channel: "hard", title: "硬规则", content: "不可违背", score: 1, tags: ["rule"] });
    const oldHook = card({ id: "hook", sourceType: "hook", sourceId: "hook", channel: "hooks", title: "旧伏笔", content: "小瓶伏笔", score: 0.2, tags: ["hook"] });
    const ordinary = card({ id: "ordinary", sourceType: "jingwei", sourceId: "ordinary", channel: "state", title: "普通状态", content: "普通", score: 0.5, tags: ["state"] });

    const ranked = rerankByGeodesicEnergy([ordinary, oldHook, hard], { hook: 3, rule: 0 }, { alpha: 0.5 });
    expect(ranked.cards[0]?.id).toBe("hard");
    expect(ranked.cards[1]?.id).toBe("hook");
    expect(ranked.fallbackLevel).toBe("L0");
    expect(rerankByGeodesicEnergy([ordinary], {}, { alpha: 0.5 }).fallbackLevel).toBe("L2");
  });
});
