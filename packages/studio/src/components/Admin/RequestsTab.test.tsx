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

  it("renders request summary cards", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 3,
      logs: [
        { id: "1", timestamp: "2026-04-20T10:00:00Z", method: "GET", endpoint: "/api/books", status: 200, duration: 120, userId: "u1" },
        { id: "2", timestamp: "2026-04-20T10:01:00Z", method: "POST", endpoint: "/api/chat", status: 500, duration: 2100, userId: "u1" },
        { id: "3", timestamp: "2026-04-20T10:02:00Z", method: "POST", endpoint: "/api/chat", status: 201, duration: 430, userId: "u2" },
      ],
    });

    render(<RequestsTab />);

    expect(await screen.findByText("总请求数")).toBeTruthy();
    expect(screen.getByText("成功率")).toBeTruthy();
    expect(screen.getByText("慢请求")).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("renders endpoint rows after loading", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 1,
      logs: [
        { id: "1", timestamp: "2026-04-20T10:00:00Z", method: "POST", endpoint: "/api/chat", status: 200, duration: 320, userId: "writer" },
      ],
    });

    render(<RequestsTab />);

    expect(await screen.findByText("/api/chat")).toBeTruthy();
    expect(screen.getByText("writer")).toBeTruthy();
    expect(screen.getAllByText("320ms").length).toBeGreaterThanOrEqual(1);
  });
});
