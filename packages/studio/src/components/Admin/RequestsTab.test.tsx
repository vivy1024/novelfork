import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { RequestsTab } from "./RequestsTab";

describe("RequestsTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders request summary cards from admin request metrics", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 3,
      summary: {
        successRate: 67,
        slowRequests: 1,
        errorRequests: 1,
        averageDuration: 950,
        averageTtftMs: 180,
        totalTokens: 5400,
        totalCostUsd: 0.1234,
        cacheHitRate: 50,
        topEndpoints: [{ label: "/resources", count: 2 }],
        topNarrators: [{ label: "admin.resources", count: 2 }],
      },
      logs: [
        {
          id: "1",
          timestamp: "2026-04-20T10:00:00Z",
          method: "GET",
          endpoint: "/resources",
          status: 200,
          duration: 120,
          userId: "system",
          narrator: "admin.resources",
          requestKind: "resource-monitor",
          cache: { status: "hit", ageMs: 120 },
        },
        {
          id: "2",
          timestamp: "2026-04-20T10:01:00Z",
          method: "POST",
          endpoint: "/chat",
          status: 500,
          duration: 2100,
          userId: "writer",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          narrator: "pipeline.write",
          requestKind: "write",
          ttftMs: 180,
          tokens: { total: 5400 },
          costUsd: 0.1234,
          cache: { status: "miss" },
        },
        {
          id: "3",
          timestamp: "2026-04-20T10:02:00Z",
          method: "POST",
          endpoint: "/chat",
          status: 201,
          duration: 630,
          userId: "writer",
          narrator: "pipeline.write",
          requestKind: "write",
          cache: { status: "bypass" },
        },
      ],
    });

    render(<RequestsTab />);

    expect(await screen.findByText("总请求数")).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("180ms")).toBeTruthy();
    expect(screen.getByText("总 Tokens")).toBeTruthy();
    expect(screen.getByText(/热门 narrator/)).toBeTruthy();
  });

  it("renders expanded request metadata rows", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 1,
      summary: {
        successRate: 100,
        slowRequests: 0,
        errorRequests: 0,
        averageDuration: 320,
        averageTtftMs: 140,
        totalTokens: 1200,
        totalCostUsd: 0.0321,
        cacheHitRate: 100,
        topEndpoints: [{ label: "/resources", count: 1 }],
        topNarrators: [{ label: "admin.resources", count: 1 }],
      },
      logs: [
        {
          id: "1",
          timestamp: "2026-04-20T10:00:00Z",
          method: "POST",
          endpoint: "/chat",
          status: 200,
          duration: 320,
          userId: "writer",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          narrator: "pipeline.write",
          requestKind: "write",
          ttftMs: 140,
          tokens: { total: 1200 },
          costUsd: 0.0321,
          cache: { status: "hit", ageMs: 45 },
          details: "book=demo",
        },
      ],
    });

    render(<RequestsTab />);

    expect(await screen.findByText("/chat")).toBeTruthy();
    expect(screen.getByText("anthropic / claude-sonnet-4-6")).toBeTruthy();
    expect(screen.getByText("缓存命中 · 45ms")).toBeTruthy();
    expect(screen.getByText("pipeline.write")).toBeTruthy();
    expect(screen.getByText("Tokens 1,200")).toBeTruthy();
    expect(screen.getAllByText("成本 $0.0321").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("book=demo")).toBeTruthy();
  });
});
