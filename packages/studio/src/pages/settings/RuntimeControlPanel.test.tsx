import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_CONFIG } from "@/types/settings";
import { RuntimeControlPanel } from "./RuntimeControlPanel";

const fetchJsonMock = vi.fn();
const putApiMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  putApi: (...args: unknown[]) => putApiMock(...args),
}));

describe("RuntimeControlPanel", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    putApiMock.mockReset();

    fetchJsonMock.mockResolvedValue({
      runtimeControls: {
        ...DEFAULT_USER_CONFIG.runtimeControls,
        defaultPermissionMode: "ask",
        defaultReasoningEffort: "high",
        contextCompressionThresholdPercent: 85,
        contextTruncateTargetPercent: 65,
      },
      modelDefaults: {
        ...DEFAULT_USER_CONFIG.modelDefaults,
        defaultSessionModel: "openai:gpt-4-turbo",
        summaryModel: "anthropic:claude-haiku-4-5",
        subagentModelPool: ["openai:gpt-4-turbo", "deepseek:deepseek-chat"],
      },
    });

    putApiMock.mockResolvedValue({
      ...DEFAULT_USER_CONFIG,
      runtimeControls: {
        ...DEFAULT_USER_CONFIG.runtimeControls,
        defaultPermissionMode: "ask",
        defaultReasoningEffort: "high",
        contextCompressionThresholdPercent: 82,
        contextTruncateTargetPercent: 60,
      },
      modelDefaults: {
        ...DEFAULT_USER_CONFIG.modelDefaults,
        defaultSessionModel: "anthropic:claude-opus-4-7",
        summaryModel: "anthropic:claude-haiku-4-5",
        subagentModelPool: ["anthropic:claude-opus-4-7", "deepseek:deepseek-chat"],
      },
    });
  });

  it("loads runtime controls from /settings/user and saves them back through the same config flow", async () => {
    render(<RuntimeControlPanel />);

    expect(fetchJsonMock).toHaveBeenCalledWith("/settings/user");
    expect(await screen.findByDisplayValue("85")).toBeTruthy();
    expect(screen.getByDisplayValue("65")).toBeTruthy();
    expect(screen.getByDisplayValue("openai:gpt-4-turbo")).toBeTruthy();
    expect(screen.getByDisplayValue("anthropic:claude-haiku-4-5")).toBeTruthy();
    expect(screen.getByDisplayValue("openai:gpt-4-turbo, deepseek:deepseek-chat")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("压缩阈值 (%)"), {
      target: { value: "82" },
    });
    fireEvent.change(screen.getByLabelText("截断目标 (%)"), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByLabelText("默认会话模型"), {
      target: { value: "anthropic:claude-opus-4-7" },
    });
    fireEvent.change(screen.getByLabelText("子代理模型池"), {
      target: { value: "anthropic:claude-opus-4-7, deepseek:deepseek-chat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存运行控制" }));

    await waitFor(() => {
      expect(putApiMock).toHaveBeenCalledWith("/settings/user", {
        runtimeControls: {
          ...DEFAULT_USER_CONFIG.runtimeControls,
          defaultPermissionMode: "ask",
          defaultReasoningEffort: "high",
          contextCompressionThresholdPercent: 82,
          contextTruncateTargetPercent: 60,
        },
        modelDefaults: {
          ...DEFAULT_USER_CONFIG.modelDefaults,
          defaultSessionModel: "anthropic:claude-opus-4-7",
          summaryModel: "anthropic:claude-haiku-4-5",
          subagentModelPool: ["anthropic:claude-opus-4-7", "deepseek:deepseek-chat"],
        },
      });
    });

    expect(await screen.findByText("运行控制已保存。")).toBeTruthy();
  });
});
