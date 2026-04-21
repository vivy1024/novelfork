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
        recovery: {
          ...DEFAULT_USER_CONFIG.runtimeControls.recovery,
          resumeOnStartup: false,
          maxRecoveryAttempts: 4,
          maxRetryAttempts: 6,
          initialRetryDelayMs: 1500,
          maxRetryDelayMs: 15000,
          backoffMultiplier: 1.8,
          jitterPercent: 15,
        },
        toolAccess: {
          ...DEFAULT_USER_CONFIG.runtimeControls.toolAccess,
          allowlist: ["Read"],
          blocklist: ["Delete"],
          mcpStrategy: "ask",
        },
        runtimeDebug: {
          ...DEFAULT_USER_CONFIG.runtimeControls.runtimeDebug,
          tokenDebugEnabled: true,
          rateDebugEnabled: false,
          dumpEnabled: true,
          traceEnabled: false,
          traceSampleRatePercent: 35,
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
        recovery: {
          ...DEFAULT_USER_CONFIG.runtimeControls.recovery,
          resumeOnStartup: true,
          maxRecoveryAttempts: 7,
          maxRetryAttempts: 9,
          initialRetryDelayMs: 2000,
          maxRetryDelayMs: 45000,
          backoffMultiplier: 2.4,
          jitterPercent: 12,
        },
        toolAccess: {
          ...DEFAULT_USER_CONFIG.runtimeControls.toolAccess,
          allowlist: ["Read", "Write", "Bash"],
          blocklist: ["Delete", "Shell"],
          mcpStrategy: "ask",
        },
        runtimeDebug: {
          ...DEFAULT_USER_CONFIG.runtimeControls.runtimeDebug,
          tokenDebugEnabled: true,
          rateDebugEnabled: true,
          dumpEnabled: false,
          traceEnabled: true,
          traceSampleRatePercent: 50,
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
    expect(screen.getByDisplayValue("4")).toBeTruthy();
    expect(screen.getByDisplayValue("6")).toBeTruthy();
    expect(screen.getByDisplayValue("1.8")).toBeTruthy();
    expect(screen.getByDisplayValue("15")).toBeTruthy();
    expect(screen.getByDisplayValue("Read")).toBeTruthy();
    expect(screen.getByDisplayValue("Delete")).toBeTruthy();
    expect(screen.getByDisplayValue("35")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("启动时自动恢复"));
    fireEvent.change(screen.getByLabelText("最大恢复次数"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("最大重试次数"), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("初始退避 (ms)"), {
      target: { value: "2000" },
    });
    fireEvent.change(screen.getByLabelText("最大退避 (ms)"), {
      target: { value: "45000" },
    });
    fireEvent.change(screen.getByLabelText("退避倍率"), {
      target: { value: "2.4" },
    });
    fireEvent.change(screen.getByLabelText("抖动 (%)"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("工具白名单"), {
      target: { value: "Read, Write, Bash" },
    });
    fireEvent.change(screen.getByLabelText("工具黑名单"), {
      target: { value: "Delete, Shell" },
    });
    fireEvent.click(screen.getByLabelText("速率调试"));
    fireEvent.click(screen.getByLabelText("Trace 调试"));
    fireEvent.change(screen.getByLabelText("Trace 采样 (%)"), {
      target: { value: "50" },
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
          contextCompressionThresholdPercent: 85,
          contextTruncateTargetPercent: 65,
          recovery: {
            ...DEFAULT_USER_CONFIG.runtimeControls.recovery,
            resumeOnStartup: true,
            maxRecoveryAttempts: 7,
            maxRetryAttempts: 9,
            initialRetryDelayMs: 2000,
            maxRetryDelayMs: 45000,
            backoffMultiplier: 2.4,
            jitterPercent: 12,
          },
          toolAccess: {
            ...DEFAULT_USER_CONFIG.runtimeControls.toolAccess,
            allowlist: ["Read", "Write", "Bash"],
            blocklist: ["Delete", "Shell"],
            mcpStrategy: "ask",
          },
          runtimeDebug: {
            ...DEFAULT_USER_CONFIG.runtimeControls.runtimeDebug,
            tokenDebugEnabled: true,
            rateDebugEnabled: true,
            dumpEnabled: true,
            traceEnabled: true,
            traceSampleRatePercent: 50,
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
});
