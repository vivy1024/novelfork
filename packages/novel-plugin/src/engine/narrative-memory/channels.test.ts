import { describe, expect, it } from "vitest";

import { runChannelWithTimeout, type NarrativeRetrievalChannel } from "./channels.js";
import type { NarrativeContextCard } from "./types.js";

function card(id: string): NarrativeContextCard {
  return {
    id,
    bookId: "book-1",
    sourceType: "scene-spec",
    sourceId: id,
    channel: "state",
    title: id,
    content: id,
    brief: id,
    tags: [],
    entities: [],
    priority: 50,
    importance: 50,
    accessCount: 0,
    reason: "test",
    estimatedTokens: 1,
  };
}

describe("Narrative retrieval channel protocol", () => {
  it("wraps successful channel output with latency and token stats", async () => {
    const channel: NarrativeRetrievalChannel = {
      name: "scene-spec",
      run: async () => ({ cards: [card("a")], warnings: ["ok warning"] }),
    };

    const result = await runChannelWithTimeout(channel, {}, { timeoutMs: 100 });

    expect(result.channel).toBe("scene-spec");
    expect(result.status).toBe("ok");
    expect(result.cards.map((item) => item.id)).toEqual(["a"]);
    expect(result.returnedCount).toBe(1);
    expect(result.estimatedTokens).toBe(1);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.warnings).toEqual(["ok warning"]);
  });

  it("preserves skipped channel status", async () => {
    const channel: NarrativeRetrievalChannel = {
      name: "optional",
      run: async () => ({ status: "skipped", cards: [], warnings: ["missing input"] }),
    };

    const result = await runChannelWithTimeout(channel, {}, { timeoutMs: 100 });

    expect(result.status).toBe("skipped");
    expect(result.cards).toEqual([]);
    expect(result.warnings).toEqual(["missing input"]);
  });

  it("captures channel errors without throwing", async () => {
    const channel: NarrativeRetrievalChannel = {
      name: "facts",
      run: async () => {
        throw new Error("boom");
      },
    };

    const result = await runChannelWithTimeout(channel, {}, { timeoutMs: 100 });

    expect(result.status).toBe("error");
    expect(result.cards).toEqual([]);
    expect(result.error).toContain("boom");
  });

  it("returns timeout status when channel exceeds timeout", async () => {
    const channel: NarrativeRetrievalChannel = {
      name: "slow",
      run: () => new Promise((resolve) => setTimeout(() => resolve({ cards: [card("late")] }), 50)),
    };

    const result = await runChannelWithTimeout(channel, {}, { timeoutMs: 1 });

    expect(result.status).toBe("timeout");
    expect(result.cards).toEqual([]);
    expect(result.error).toContain("timed out");
  });
});
