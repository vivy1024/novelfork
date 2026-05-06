import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeControlPanel } from "./RuntimeControlPanel";

const fetchJsonMock = vi.fn();
const putApiMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (path: string) => fetchJsonMock(path),
  putApi: (path: string, body: unknown) => putApiMock(path, body),
}));

const runtimeControls = {
  defaultPermissionMode: "edit",
  defaultReasoningEffort: "medium",
  contextCompressionThresholdPercent: 80,
  contextTruncateTargetPercent: 70,
  recovery: {
    resumeOnStartup: true,
    maxRecoveryAttempts: 3,
    maxRetryAttempts: 5,
    initialRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
    backoffMultiplier: 2,
    jitterPercent: 20,
  },
  toolAccess: { allowlist: [], blocklist: [], mcpStrategy: "inherit" },
  runtimeDebug: { tokenDebugEnabled: false, rateDebugEnabled: false, dumpEnabled: false, traceEnabled: false, traceSampleRatePercent: 0 },
};

function mockConfigAndModels(models = [{ modelId: "sub2api:gpt-5-codex", modelName: "GPT-5 Codex", providerName: "Sub2API" }]) {
  fetchJsonMock.mockImplementation((path: string) => {
    if (path === "/settings/user") {
      return Promise.resolve({
        runtimeControls,
        modelDefaults: {
          defaultSessionModel: models[0]?.modelId ?? "",
          summaryModel: models[0]?.modelId ?? "",
          subagentModelPool: models[0] ? [models[0].modelId] : [],
          validation: { defaultSessionModel: models[0] ? "valid" : "empty", summaryModel: models[0] ? "valid" : "empty", subagentModelPool: {}, invalidModelIds: [] },
        },
      });
    }
    if (path === "/api/providers/models") {
      return Promise.resolve({ models });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  putApiMock.mockImplementation(async (_path: string, body: any) => ({
    runtimeControls: body.runtimeControls,
    modelDefaults: body.modelDefaults,
  }));
}

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
  putApiMock.mockReset();
});

describe("RuntimeControlPanel", () => {
  it("uses the unified runtime model pool for model defaults", async () => {
    mockConfigAndModels();

    render(<RuntimeControlPanel />);

    expect(await screen.findByRole("option", { name: "Sub2API · GPT-5 Codex（会话）" })).toBeTruthy();
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/providers/models");

    fireEvent.change(screen.getByLabelText("默认会话模型"), { target: { value: "sub2api:gpt-5-codex" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(putApiMock).toHaveBeenCalledWith("/settings/user", expect.objectContaining({
      modelDefaults: expect.objectContaining({ defaultSessionModel: "sub2api:gpt-5-codex" }),
    })));
  });

  it("shows an empty model pool state and disables model selectors", async () => {
    mockConfigAndModels([]);

    render(<RuntimeControlPanel />);

    expect(await screen.findByText("尚未配置可用模型")).toBeTruthy();
    expect(screen.getByLabelText("默认会话模型")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("摘要模型")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("子代理模型池")).toHaveProperty("disabled", true);
  });

  it("RED: 不用模型池第一项冒充未配置的默认模型", async () => {
    const models = [{ modelId: "sub2api:gpt-5-codex", modelName: "GPT-5 Codex", providerName: "Sub2API" }];
    fetchJsonMock.mockImplementation((path: string) => {
      if (path === "/settings/user") {
        return Promise.resolve({
          runtimeControls,
          modelDefaults: {
            defaultSessionModel: "",
            summaryModel: "",
            subagentModelPool: [],
            validation: { defaultSessionModel: "empty", summaryModel: "empty", subagentModelPool: {}, invalidModelIds: [] },
          },
        });
      }
      if (path === "/api/providers/models") {
        return Promise.resolve({ models });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<RuntimeControlPanel />);

    expect(await screen.findByLabelText("默认会话模型")).toHaveProperty("value", "");
    expect(screen.queryByText("Sub2API · GPT-5 Codex")).toBeNull();
    expect(screen.getByText(/默认会话模型未配置，请选择模型池中的可用模型/)).toBeTruthy();
  });

  it("RED: 保存运行控制后重新读取服务器配置作为最终事实", async () => {
    const models = [{ modelId: "sub2api:gpt-5-codex", modelName: "GPT-5 Codex", providerName: "Sub2API" }];
    let userReads = 0;
    const modelDefaults = {
      defaultSessionModel: "sub2api:gpt-5-codex",
      summaryModel: "sub2api:gpt-5-codex",
      subagentModelPool: ["sub2api:gpt-5-codex"],
      validation: { defaultSessionModel: "valid", summaryModel: "valid", subagentModelPool: {}, invalidModelIds: [] },
    };
    fetchJsonMock.mockImplementation((path: string) => {
      if (path === "/settings/user") {
        userReads += 1;
        return Promise.resolve({
          runtimeControls: {
            ...runtimeControls,
            defaultReasoningEffort: userReads === 1 ? "medium" : "low",
          },
          modelDefaults,
        });
      }
      if (path === "/api/providers/models") {
        return Promise.resolve({ models });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    putApiMock.mockResolvedValue({
      runtimeControls: { ...runtimeControls, defaultReasoningEffort: "high" },
      modelDefaults,
    });

    render(<RuntimeControlPanel />);

    fireEvent.change(await screen.findByDisplayValue("中"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(fetchJsonMock.mock.calls.filter(([path]) => path === "/settings/user")).toHaveLength(2));
    await waitFor(() => expect(screen.getByDisplayValue("低")).toBeTruthy());
  });
});
