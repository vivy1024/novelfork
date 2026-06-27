import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { packNarrativeContext, type NarrativeBudgetResult } from "./budget.js";
import type { ChannelResult } from "./channels.js";
import { buildNarrativeRetrievalDiagnostics, formatNarrativeSections, persistNarrativeRetrievalLog } from "./diagnostics.js";
import type { NarrativeContextCard } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-diagnostics-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function card(input: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "channel" | "title" | "content">): NarrativeContextCard {
  return {
    id: input.id,
    bookId: "book-1",
    sourceType: input.sourceType ?? "jingwei",
    sourceId: input.sourceId ?? input.id,
    channel: input.channel,
    title: input.title,
    content: input.content,
    normal: input.normal,
    summary: input.summary,
    brief: input.brief ?? input.title,
    tags: input.tags ?? [],
    entities: input.entities ?? [],
    priority: input.priority ?? 50,
    importance: input.importance ?? 50,
    accessCount: input.accessCount ?? 0,
    lastAccessedAt: input.lastAccessedAt,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    reason: input.reason ?? "召回原因",
    estimatedTokens: input.estimatedTokens ?? 100,
    score: input.score,
    scoreBreakdown: input.scoreBreakdown,
  };
}

function channelResult(input: Partial<ChannelResult> & Pick<ChannelResult, "channel" | "status">): ChannelResult {
  return {
    channel: input.channel,
    status: input.status,
    cards: input.cards ?? [],
    latencyMs: input.latencyMs ?? 12,
    candidateCount: input.candidateCount ?? input.cards?.length ?? 0,
    returnedCount: input.returnedCount ?? input.cards?.length ?? 0,
    estimatedTokens: input.estimatedTokens ?? input.cards?.reduce((sum, item) => sum + item.estimatedTokens, 0) ?? 0,
    warnings: input.warnings ?? [],
    error: input.error,
  };
}

describe("Narrative diagnostics and section formatting", () => {
  it("formats stable narrative section tags and preserves recall reasons", () => {
    const packed = packNarrativeContext([
      card({ id: "hard", channel: "hard", title: "硬规则", content: "不得违背 canon", reason: "canon 硬约束" }),
      card({ id: "state", channel: "state", title: "当前状态", content: "韩立受伤", reason: "角色命中" }),
      card({ id: "timeline", channel: "timeline", title: "前章", content: "上一章逃离坊市" }),
      card({ id: "hook", channel: "hooks", title: "小瓶伏笔", content: "小瓶未回收" }),
      card({ id: "fact", channel: "facts", title: "韩立 持有 小瓶", content: "事实内容" }),
      card({ id: "style", channel: "style", title: "文风", content: "克制冷静" }),
      card({ id: "semantic", channel: "semantic", title: "相似记忆", content: "旧战斗回声" }),
    ], { maxTokens: 10_000 });

    const sections = formatNarrativeSections(packed.cards);

    expect(sections.hard).toContain("<hard_constraints>");
    expect(sections.state).toContain("<narrative_state>");
    expect(sections.timeline).toContain("<timeline_context>");
    expect(sections.hooks).toContain("<active_hooks>");
    expect(sections.facts).toContain("<known_facts>");
    expect(sections.style).toContain("<style_rules>");
    expect(sections.semantic).toContain("<semantic_memory>");
    expect(sections.hard).toContain("reason: canon 硬约束");
    expect(sections.state).toContain("reason: 角色命中");
  });

  it("builds diagnostics with channel stats, tokens, dropped/degraded ids and warnings", () => {
    const cards = [
      card({ id: "hard", channel: "hard", title: "硬规则", content: "hard", brief: "h", estimatedTokens: 100 }),
      card({ id: "style", channel: "style", title: "风格", content: "style", brief: "s", estimatedTokens: 100, priority: 1 }),
    ];
    const budget = packNarrativeContext(cards, { maxTokens: 1, channelBudgets: { hard: 1, style: 0 } });
    const diagnostics = buildNarrativeRetrievalDiagnostics({
      startedAt: 100,
      endedAt: 145,
      channelResults: [channelResult({ channel: "hard", status: "ok", cards: [cards[0]!] }), channelResult({ channel: "style", status: "skipped", warnings: ["missing style"] })],
      budget,
      warnings: ["manual warning"],
    });

    expect(diagnostics.totalMs).toBe(45);
    expect(diagnostics.channelStats).toHaveLength(2);
    expect(diagnostics.totalEstimatedTokens).toBe(budget.totalEstimatedTokens);
    expect(diagnostics.injectedTokensByChannel.hard).toBeGreaterThan(0);
    expect(diagnostics.degradedCards.map((item) => item.id)).toContain("hard");
    expect(diagnostics.droppedCardIds).toContain("style");
    expect(diagnostics.warnings).toEqual(expect.arrayContaining(["missing style", "manual warning"]));
  });

  it("persists retrieval diagnostics into narrative_retrieval_log", async () => {
    const storage = await createStorage();
    try {
      const budget: NarrativeBudgetResult = packNarrativeContext([card({ id: "hard", channel: "hard", title: "硬规则", content: "hard", brief: "h" })], { maxTokens: 100 });
      const diagnostics = buildNarrativeRetrievalDiagnostics({ startedAt: 0, endedAt: 5, channelResults: [], budget });
      const record = persistNarrativeRetrievalLog(storage, {
        id: "log-1",
        bookId: "book-1",
        chapterNumber: 12,
        purpose: "write_chapter",
        diagnostics,
      });

      expect(record.id).toBe("log-1");
      expect(record.totalTokens).toBe(diagnostics.totalEstimatedTokens);
      expect(record.diagnostics.totalMs).toBe(5);
    } finally {
      storage.close();
    }
  });
});
