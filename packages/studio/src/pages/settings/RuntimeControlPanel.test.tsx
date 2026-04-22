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
        toolAccess: {
          allowlist: ["Read", "Write"],
          blocklist: ["Bash"],
          mcpStrategy: "ask",
        },
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
        toolAccess: {
          allowlist: ["Read", "Edit"],
          blocklist: ["Bash", "WebFetch"],
          mcpStrategy: "inherit",
        },
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
    expect(screen.getByText("命中允许列表 → 直接允许")).toBeTruthy();
    expect(screen.getByText("未命中允许列表 → 拒绝")).toBeTruthy();
    expect(screen.getByText("命中阻止列表 → 拒绝")).toBeTruthy();
    expect(screen.getByText("MCP 策略 ask → 需确认")).toBeTruthy();
    expect(screen.getByText(/Tools Execute \/ MCP Call \/ Context Manager 已接入这里的重试、退避、trace、dump 与上下文阈值配置。/)).toBeTruthy();

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
    fireEvent.change(screen.getByLabelText("允许工具列表"), {
      target: { value: "Read, Edit" },
    });
    fireEvent.change(screen.getByLabelText("阻止工具列表"), {
      target: { value: "Bash, WebFetch" },
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
          toolAccess: {
            allowlist: ["Read", "Edit"],
            blocklist: ["Bash", "WebFetch"],
            mcpStrategy: "ask",
          },
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

  it("hydrates model suggestions from the provider model registry route", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url === "/settings/user") {
        return {
          runtimeControls: DEFAULT_USER_CONFIG.runtimeControls,
          modelDefaults: DEFAULT_USER_CONFIG.modelDefaults,
        };
      }

      if (url === "/api/providers/models") {
        return {
          models: [
            {
              modelId: "local:novel-1",
              modelName: "Novel 1",
              providerId: "local",
              providerName: "本地网关",
              enabled: true,
              contextWindow: 32768,
              maxOutputTokens: 8192,
            },
          ],
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    render(<RuntimeControlPanel />);

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/providers/models");
    });
  });
});
