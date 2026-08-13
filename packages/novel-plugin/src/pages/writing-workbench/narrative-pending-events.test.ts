import { describe, expect, it, vi } from "vitest";

import {
  bulkMutatePendingEvents,
  fetchPendingEvents,
  groupProposalsByChapter,
  mutatePendingEvent,
  riskLabel,
  type PendingEvent,
} from "./narrative-pending-events";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchPendingEvents", () => {
  it("reads the book-scoped pending queue", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ events: [{ id: "e1", chapterNumber: 3 }] }));

    const events = await fetchPendingEvents("book-1", { fetchImpl });

    expect(events).toEqual([{ id: "e1", chapterNumber: 3 }]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/books/book-1/narrative-memory/events/pending");
  });

  it("passes the limit through and encodes the book id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ events: [] }));

    await fetchPendingEvents("book/with space", { limit: 20, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("/api/books/book%2Fwith%20space/narrative-memory/events/pending?limit=20");
  });

  it("treats a missing events array as an empty queue", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));

    await expect(fetchPendingEvents("book-1", { fetchImpl })).resolves.toEqual([]);
  });

  it("surfaces transport failures instead of silently emptying the queue", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "boom" }, { status: 500 }));

    await expect(fetchPendingEvents("book-1", { fetchImpl })).rejects.toThrow("events 500");
  });
});

describe("mutatePendingEvent", () => {
  it("posts approve with the default author reason", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    await mutatePendingEvent("book-1", "event-9", "approve", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/events/event-9/approve");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "工作台确认 Narrative Memory 事件" });
  });

  it("posts reject with its own default reason", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    await mutatePendingEvent("book-1", "event-9", "reject", { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/events/event-9/reject");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "工作台拒绝 Narrative Memory 事件" });
  });

  it("keeps a caller-supplied reason", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    await mutatePendingEvent("book-1", "e1", "approve", { reason: "写作视图确认本章提议", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ reason: "写作视图确认本章提议" });
  });

  it("encodes the event id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    await mutatePendingEvent("book-1", "event/1 2", "approve", { fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/events/event%2F1%202/approve");
  });

  it("reports the server explanation rather than a bare status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "该事件已被结算" }, { status: 409 }));

    await expect(mutatePendingEvent("book-1", "e1", "approve", { fetchImpl })).rejects.toThrow("该事件已被结算");
  });

  it("falls back to a status message when the body is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));

    await expect(mutatePendingEvent("book-1", "e1", "reject", { fetchImpl })).rejects.toThrow("事件操作失败（503）");
  });
});

describe("bulkMutatePendingEvents", () => {
  it("posts bulk approve to the queue endpoint with ids and reason", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "ok", approved: ["e1", "e2"], skipped: [], failed: [] }));

    const result = await bulkMutatePendingEvents("book-1", "approve", ["e1", "e2"], { reason: "批量确认", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/events/bulk");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ action: "approve", eventIds: ["e1", "e2"], reason: "批量确认" });
    expect(result.approved).toEqual(["e1", "e2"]);
  });

  it("posts bulk delete and returns the server summary", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ summary: "已删 2", deleted: ["e3"] }));

    const result = await bulkMutatePendingEvents("book-1", "delete", ["e3"], { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/books/book-1/narrative-memory/events/bulk");
    expect(JSON.parse(String(init.body))).toEqual({ action: "delete", eventIds: ["e3"] });
    expect(result.deleted).toEqual(["e3"]);
  });

  it("surfaces server-side rejection instead of returning a bare status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "invalid-input", summary: "eventIds 不能为空。" }, { status: 400 }));

    await expect(bulkMutatePendingEvents("book-1", "approve", [], { fetchImpl }))
      .rejects.toThrow(/eventIds 不能为空/u);
  });
});

describe("groupProposalsByChapter", () => {
  const events: PendingEvent[] = [
    { id: "cur", chapterNumber: 32 },
    { id: "old", chapterNumber: 30, risk: "high" },
    { id: "future", chapterNumber: 33 },
    { id: "no-chapter" },
  ];

  it("splits current-and-later from earlier chapters", () => {
    const groups = groupProposalsByChapter(events, 32);

    expect(groups.current.map((event) => event.id)).toEqual(["cur", "future", "no-chapter"]);
    expect(groups.earlier.map((event) => event.id)).toEqual(["old"]);
  });

  it("counts high risk across both groups", () => {
    const groups = groupProposalsByChapter(
      [{ id: "a", chapterNumber: 32, risk: "high" }, { id: "b", chapterNumber: 1, risk: "high" }, { id: "c", chapterNumber: 32 }],
      32,
    );

    expect(groups.highRiskCount).toBe(2);
  });

  it("never drops entries with an unusable chapter number", () => {
    const groups = groupProposalsByChapter([{ id: "nan", chapterNumber: Number.NaN }], 10);

    expect(groups.current.map((event) => event.id)).toEqual(["nan"]);
    expect(groups.earlier).toEqual([]);
  });

  it("returns empty groups for an empty queue", () => {
    const groups = groupProposalsByChapter([], 5);

    expect(groups.current).toEqual([]);
    expect(groups.earlier).toEqual([]);
    expect(groups.highRiskCount).toBe(0);
  });
});

describe("riskLabel", () => {
  it("maps known levels", () => {
    expect(riskLabel("high")).toBe("高风险");
    expect(riskLabel("medium")).toBe("中风险");
    expect(riskLabel("low")).toBe("低风险");
  });

  it("falls back to 待审 when the level is absent", () => {
    expect(riskLabel(undefined)).toBe("待审");
  });

  it("keeps an unmapped level visible rather than inventing a label", () => {
    expect(riskLabel("critical")).toBe("critical");
  });
});
