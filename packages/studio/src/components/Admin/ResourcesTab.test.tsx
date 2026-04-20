import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { ResourcesTab } from "./ResourcesTab";

describe("ResourcesTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders resource metrics from the admin API", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      stats: {
        cpu: { usage: 18.2, cores: 8 },
        memory: { used: 8 * 1024 * 1024 * 1024, total: 16 * 1024 * 1024 * 1024 },
        disk: { used: 32 * 1024 * 1024 * 1024, total: 128 * 1024 * 1024 * 1024 },
        network: { sent: 1024, received: 2048 },
      },
    });

    render(<ResourcesTab />);

    expect(await screen.findByRole("heading", { name: "资源监控" })).toBeTruthy();
    expect(screen.getByText("18.2%")).toBeTruthy();
    expect(screen.getByText("8 核心")).toBeTruthy();
    expect(screen.getByText("8.00 GB / 16.00 GB")).toBeTruthy();
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/admin/resources");
  });
});
