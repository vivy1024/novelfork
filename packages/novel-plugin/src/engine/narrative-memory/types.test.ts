import { describe, expect, it } from "vitest";
import {
  BuildNarrativeContextInputSchema,
  NarrativeContextCardSchema,
  NarrativeEventSchema,
  NarrativeFactSchema,
  type NarrativeContextCard,
  type NarrativeEvent,
  type NarrativeFact,
} from "./types.js";

describe("Narrative Wave Memory types", () => {
  it("validates a complete context card with source, channel, reason, and token estimate", () => {
    const card: NarrativeContextCard = {
      id: "card-1",
      bookId: "book-1",
      sourceType: "jingwei",
      sourceId: "entry-1",
      channel: "hard",
      title: "世界硬规则",
      content: "此世界不能死而复生。",
      brief: "不能死而复生",
      tags: ["规则"],
      entities: ["世界"],
      priority: 900,
      importance: 90,
      accessCount: 0,
      reason: "canon 硬规则必须注入",
      estimatedTokens: 32,
      validFromChapter: 1,
    };

    expect(NarrativeContextCardSchema.parse(card)).toEqual(card);
  });

  it("rejects a context card without an explanation reason", () => {
    const invalid = {
      id: "card-1",
      bookId: "book-1",
      sourceType: "jingwei",
      sourceId: "entry-1",
      channel: "hard",
      title: "世界硬规则",
      content: "此世界不能死而复生。",
      brief: "不能死而复生",
      tags: [],
      entities: [],
      priority: 900,
      importance: 90,
      accessCount: 0,
      reason: "",
      estimatedTokens: 32,
    };

    expect(() => NarrativeContextCardSchema.parse(invalid)).toThrow();
  });

  it("validates narrative facts and events with chapter validity and lifecycle status", () => {
    const fact: NarrativeFact = {
      id: "fact-1",
      bookId: "book-1",
      subject: "林青",
      predicate: "境界",
      object: "金丹中期",
      category: "character-state",
      layer: "dynamic",
      confidence: 0.9,
      sourceType: "event",
      sourceId: "event-1",
      sourceChapter: 12,
      evidenceText: "林青终于稳住了金丹中期的气息。",
      validFromChapter: 12,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z",
    };

    const event: NarrativeEvent = {
      id: "event-1",
      bookId: "book-1",
      chapterNumber: 12,
      eventType: "character_state_changed",
      subject: "林青",
      predicate: "境界",
      object: "金丹中期",
      evidenceText: "林青终于稳住了金丹中期的气息。",
      confidence: 0.9,
      source: "settle",
      status: "applied",
      riskLevel: "low",
      createdAt: "2026-06-22T00:00:00.000Z",
      appliedAt: "2026-06-22T00:00:00.000Z",
    };

    expect(NarrativeFactSchema.parse(fact)).toEqual(fact);
    expect(NarrativeEventSchema.parse(event)).toEqual(event);
  });

  it("validates build context input purpose and token budget", () => {
    const input = BuildNarrativeContextInputSchema.parse({
      bookId: "book-1",
      purpose: "write_chapter",
      chapterNumber: 12,
      entities: ["林青", "师姐"],
      maxTokens: 12000,
    });

    expect(input.purpose).toBe("write_chapter");
    expect(input.entities).toEqual(["林青", "师姐"]);
  });
});
