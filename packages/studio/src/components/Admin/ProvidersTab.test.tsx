import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { ProvidersTab } from "./ProvidersTab";

describe("ProvidersTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders provider summary stats", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          type: "api-key",
          models: ["gpt-5", "gpt-5-mini"],
          enabled: true,
          priority: 1,
        },
        {
          id: "anthropic",
          name: "Anthropic",
          type: "api-key",
          models: ["claude-sonnet"],
          enabled: false,
          priority: 2,
        },
      ],
    });

    render(<ProvidersTab />);

    expect(await screen.findByText("供应商总数")).toBeTruthy();
    expect(screen.getByText("启用中")).toBeTruthy();
    expect(screen.getByText("模型总数")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("renders provider model objects from the admin API without crashing", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      providers: [
        {
          id: "anthropic",
          name: "Anthropic",
          type: "anthropic",
          models: [
            { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 200000 },
          ],
          enabled: true,
          priority: 1,
        },
      ],
    });

    render(<ProvidersTab />);

    expect(await screen.findByText("Claude Sonnet 4.6")).toBeTruthy();
  });

  it("shows inline connection feedback instead of alert", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            type: "api-key",
            models: ["gpt-5"],
            enabled: true,
            priority: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ success: true, latency: 128 });

    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProvidersTab />);

    fireEvent.click(await screen.findByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(screen.getByText(/连接成功/i)).toBeTruthy();
      expect(screen.getByText(/128ms/)).toBeTruthy();
    });

    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
