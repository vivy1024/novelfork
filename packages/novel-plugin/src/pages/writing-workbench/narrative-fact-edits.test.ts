import { describe, expect, it, vi } from "vitest";

import {
  correctFact,
  createFact,
  fetchFactsByEntity,
  retireFact,
} from "./narrative-fact-edits";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function bodyOf(call: unknown): Record<string, unknown> {
  const [, init] = call as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("fetchFactsByEntity", () => {
  it("reads the book-scoped entity groups", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ groups: [{ entity: "林渊", facts: [] }], total: 0 }));

    const groups = await fetchFactsByEntity("book-1", { fetchImpl });

    expect(groups).toEqual([{ entity: "林渊", facts: [] }]);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/facts/by-entity");
  });

  it("passes asOfChapter through", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ groups: [] }));

    await fetchFactsByEntity("book-1", { asOfChapter: 92, fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/facts/by-entity?asOfChapter=92");
  });
});

describe("correctFact", () => {
  it("PUTs the correction to the fact-scoped endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已纠正" }));

    await correctFact("book-1", "fact-9", { object: "金丹", reason: "体检纠正" }, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/facts/fact-9/correct");
    expect(init.method).toBe("PUT");
    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({ object: "金丹", reason: "体检纠正" });
  });

  /**
   * 后端 correctNarrativeFact 一直接受 predicate/category/confidence，但此前封装
   * 只透出 object。机器把「修为」抽成「实力」时，只能改值救不回谓词。
   */
  it("carries predicate, category, confidence and evidence through to the backend", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已纠正" }));

    await correctFact("book-1", "fact-9", {
      object: "金丹",
      predicate: "修为",
      category: "character_state",
      confidence: 1,
      evidenceText: "第 92 章原文",
      reason: "体检纠正",
    }, { fetchImpl });

    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({
      object: "金丹",
      predicate: "修为",
      category: "character_state",
      confidence: 1,
      evidenceText: "第 92 章原文",
      reason: "体检纠正",
    });
  });

  it("drops undefined fields instead of sending them as null-ish keys", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已纠正" }));

    await correctFact("book-1", "fact-9", { object: "金丹", predicate: undefined }, { fetchImpl });

    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({ object: "金丹" });
  });

  it("encodes the fact id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已纠正" }));

    await correctFact("book-1", "fact/1 2", { object: "金丹" }, { fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/facts/fact%2F1%202/correct");
  });

  it("surfaces the server summary rather than a bare status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "not-found", summary: "找不到该叙事事实。" }, { status: 404 }));

    await expect(correctFact("book-1", "missing", { object: "金丹" }, { fetchImpl }))
      .rejects.toThrow(/找不到该叙事事实|not-found/);
  });
});

describe("createFact", () => {
  it("POSTs a manual fact to the collection endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ fact: { id: "fact-new" }, summary: "已新增" }));

    const result = await createFact("book-1", {
      subject: "林渊",
      predicate: "修为",
      object: "金丹",
      category: "character_state",
    }, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/facts");
    expect(init.method).toBe("POST");
    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({
      subject: "林渊",
      predicate: "修为",
      object: "金丹",
      category: "character_state",
    });
    expect(result.fact?.id).toBe("fact-new");
  });

  it("trims the four required fields so stray spaces do not become part of the slot key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已新增" }));

    await createFact("book-1", {
      subject: "  林渊 ",
      predicate: " 修为 ",
      object: " 金丹 ",
      category: " character_state ",
    }, { fetchImpl });

    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({
      subject: "林渊",
      predicate: "修为",
      object: "金丹",
      category: "character_state",
    });
  });

  it("forwards the optional chapter, evidence and closeSuperseded switches", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已新增" }));

    await createFact("book-1", {
      subject: "林渊",
      predicate: "位于",
      object: "落云城",
      category: "location",
      validFromChapter: 95,
      evidenceText: "第 95 章原文",
      closeSuperseded: false,
      confidence: 0.8,
    }, { fetchImpl });

    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({
      subject: "林渊",
      predicate: "位于",
      object: "落云城",
      category: "location",
      validFromChapter: 95,
      evidenceText: "第 95 章原文",
      closeSuperseded: false,
      confidence: 0.8,
    });
  });

  it("encodes the book id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已新增" }));

    await createFact("book/with space", {
      subject: "林渊",
      predicate: "修为",
      object: "金丹",
      category: "character_state",
    }, { fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book%2Fwith%20space/narrative-memory/facts");
  });

  it("surfaces backend validation failures", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { error: "invalid-input", summary: "subject / predicate / object 不能为空。" },
      { status: 400 },
    ));

    await expect(createFact("book-1", { subject: "", predicate: "", object: "", category: "" }, { fetchImpl }))
      .rejects.toThrow(/不能为空|invalid-input/);
  });
});

describe("retireFact", () => {
  it("DELETEs with the author reason", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已作废" }));

    await retireFact("book-1", "fact-9", { reason: "体检判定误报", fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/facts/fact-9");
    expect(init.method).toBe("DELETE");
    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({ reason: "体检判定误报" });
  });

  it("sends an empty body when no reason is given", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已作废" }));

    await retireFact("book-1", "fact-9", { fetchImpl });

    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({});
  });
});
