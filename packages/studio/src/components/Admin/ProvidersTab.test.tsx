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
          type: "openai",
          models: [
            { id: "gpt-5", name: "GPT-5", contextWindow: 128000, maxOutputTokens: 16384 },
            { id: "gpt-5-mini", name: "GPT-5 Mini", contextWindow: 128000, maxOutputTokens: 16384 },
          ],
          enabled: true,
          priority: 1,
          config: {},
          apiKeyRequired: true,
          baseUrl: "https://api.openai.com/v1",
        },
        {
          id: "anthropic",
          name: "Anthropic",
          type: "anthropic",
          models: [{ id: "claude-sonnet", name: "Claude Sonnet", contextWindow: 200000, maxOutputTokens: 16384 }],
          enabled: false,
          priority: 2,
          config: {},
          apiKeyRequired: true,
          baseUrl: "https://api.anthropic.com",
        },
      ],
    });

    render(<ProvidersTab />);

    expect(await screen.findByText("供应商总数")).toBeTruthy();
    expect(screen.getByText("启用中")).toBeTruthy();
    expect(screen.getByText("模型总数")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("GPT-5")).toBeTruthy();
  });

  it("shows inline connection feedback instead of alert", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            type: "openai",
            models: [{ id: "gpt-5", name: "GPT-5", contextWindow: 128000, maxOutputTokens: 16384 }],
            enabled: true,
            priority: 1,
            config: {},
            apiKeyRequired: true,
            baseUrl: "https://api.openai.com/v1",
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
