import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_MODELS_API_PATH, USER_SETTINGS_API_PATH } from "@/app-next/backend-contract";
import { RuntimeControlPanel } from "./RuntimeControlPanel";

const fetchJsonMock = vi.fn();
const putApiMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (path: string) => fetchJsonMock(path),
  putApi: (path: string, body: unknown) => putApiMock(path, body),
}));

vi.mock("@/components/ui/simple-select", () => ({
  SimpleSelect: ({ value, onValueChange, options, disabled, placeholder, className, "aria-label": ariaLabel }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.filter((option) => option.value !== "").map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  ),
}));

const runtimeControls = {
  defaultPermissionMode: "edit",
  defaultReasoningEffort: "medium",
  contextCompressionThresholdPercent: 80,
  contextTruncateTargetPercent: 70,
  largeWindowCompressionThresholdPercent: 60,
  largeWindowTruncateTargetPercent: 50,
  maxTurnSteps: 200,
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
  sendMode: "enter",
};

function mockConfigAndModels(models = [{ modelId: "sub2api:gpt-5-codex", modelName: "GPT-5 Codex", providerName: "Sub2API" }]) {
  fetchJsonMock.mockImplementation((path: string) => {
    if (path === USER_SETTINGS_API_PATH) {
      return Promise.resolve({
        runtimeControls,
        modelDefaults: {
          defaultSessionModel: models[0]?.modelId ?? "",
          summaryModel: models[0]?.modelId ?? "",
          exploreSubagentModel: models[0]?.modelId ?? "",
          planSubagentModel: models[0]?.modelId ?? "",
          generalSubagentModel: models[0]?.modelId ?? "",
          codexReasoningEffort: "high",
          subagentModelPool: models[0] ? [models[0].modelId] : [],
          validation: { defaultSessionModel: models[0] ? "valid" : "empty", summaryModel: models[0] ? "valid" : "empty", subagentModelPool: {}, invalidModelIds: [] },
        },
        proxy: { webFetch: "http://127.0.0.1:7890", providers: {}, platforms: {} },
      });
    }
    if (path === PROVIDER_MODELS_API_PATH) {
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
  vi.useRealTimers();
});

async function waitForPanelReady() {
  expect(await screen.findByText("模型设置")).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 120));
}

async function chooseSelectOption(label: string, optionName: string) {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  const option = Array.from(select.options).find((item) => item.textContent === optionName);
  if (!option) throw new Error(`Missing option ${optionName} for ${label}`);
  fireEvent.change(select, { target: { value: option.value } });
}

describe("RuntimeControlPanel", () => {
  it("uses the unified runtime model pool for model defaults", async () => {
    mockConfigAndModels();

    render(<RuntimeControlPanel />);

    await waitForPanelReady();

    expect(screen.getByLabelText("默认会话模型").textContent).toContain("Sub2API · GPT-5 Codex（会话）");
    expect(fetchJsonMock).toHaveBeenCalledWith(PROVIDER_MODELS_API_PATH);
    expect(screen.getByLabelText("Explore 子代理模型").textContent).toContain("Sub2API · GPT-5 Codex");
    expect(screen.getByLabelText("Plan 子代理模型").textContent).toContain("Sub2API · GPT-5 Codex");
    expect(screen.getByText("Codex 推理强度")).toBeTruthy();

    await chooseSelectOption("Codex 推理强度", "低");

    await waitFor(() => expect(putApiMock).toHaveBeenCalledWith(USER_SETTINGS_API_PATH, expect.objectContaining({
      modelDefaults: expect.objectContaining({ codexReasoningEffort: "low" }),
    })), { timeout: 2000 });
  });

  it("shows an empty model pool state and disables model selectors", async () => {
    mockConfigAndModels([]);

    render(<RuntimeControlPanel />);

    await waitForPanelReady();

    expect(screen.getByText(/尚未配置可用模型/)).toBeTruthy();
    expect(screen.getByLabelText("默认会话模型")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("摘要模型")).toHaveProperty("disabled", true);
    expect(screen.getByText(/无可用模型/)).toBeTruthy();
  });

  it("RED: 不用模型池第一项冒充未配置的默认模型", async () => {
    const models = [{ modelId: "sub2api:gpt-5-codex", modelName: "GPT-5 Codex", providerName: "Sub2API" }];
    fetchJsonMock.mockImplementation((path: string) => {
      if (path === USER_SETTINGS_API_PATH) {
        return Promise.resolve({
          runtimeControls,
          modelDefaults: {
            defaultSessionModel: "",
            summaryModel: "",
            exploreSubagentModel: "",
            planSubagentModel: "",
            generalSubagentModel: "",
            codexReasoningEffort: "high",
            subagentModelPool: [],
            validation: { defaultSessionModel: "empty", summaryModel: "empty", subagentModelPool: {}, invalidModelIds: [] },
          },
          proxy: { webFetch: "", providers: {}, platforms: {} },
        });
      }
      if (path === PROVIDER_MODELS_API_PATH) {
        return Promise.resolve({ models });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<RuntimeControlPanel />);

    await waitForPanelReady();

    expect((screen.getByLabelText("默认会话模型") as HTMLSelectElement).value).toBe("");
    expect(screen.getByLabelText("默认会话模型").textContent).toContain("请选择模型");
    expect(screen.getByText(/默认会话模型未配置，请选择模型池中的可用模型/)).toBeTruthy();
  });

  it("does not mix Agent runtime controls into the model defaults panel", async () => {
    mockConfigAndModels();

    render(<RuntimeControlPanel />);

    await waitForPanelReady();

    expect(screen.getByText("模型设置")).toBeTruthy();
    expect(screen.getByText("默认模型")).toBeTruthy();
    expect(screen.getByText("Codex 推理强度")).toBeTruthy();
    expect(screen.queryByText("最大轮次")).toBeNull();
    expect(screen.queryByText("大窗口压缩阈值 %")).toBeNull();
    expect(screen.queryByText("WebFetch 代理")).toBeNull();
    expect(screen.queryByText("首 token 超时")).toBeNull();
  });

  it("RED: 保存运行控制后重新读取服务器配置作为最终事实", async () => {
    const models = [{ modelId: "sub2api:gpt-5-codex", modelName: "GPT-5 Codex", providerName: "Sub2API" }];
    let userReads = 0;
    const modelDefaults = {
      defaultSessionModel: "sub2api:gpt-5-codex",
      summaryModel: "sub2api:gpt-5-codex",
      exploreSubagentModel: "sub2api:gpt-5-codex",
      planSubagentModel: "sub2api:gpt-5-codex",
      generalSubagentModel: "sub2api:gpt-5-codex",
      codexReasoningEffort: "high",
      subagentModelPool: ["sub2api:gpt-5-codex"],
      validation: { defaultSessionModel: "valid", summaryModel: "valid", subagentModelPool: {}, invalidModelIds: [] },
    };
    fetchJsonMock.mockImplementation((path: string) => {
      if (path === USER_SETTINGS_API_PATH) {
        userReads += 1;
        return Promise.resolve({
          runtimeControls: {
            ...runtimeControls,
            defaultReasoningEffort: userReads === 1 ? "medium" : "low",
          },
          modelDefaults,
          proxy: { webFetch: "http://127.0.0.1:7890", providers: {}, platforms: {} },
        });
      }
      if (path === PROVIDER_MODELS_API_PATH) {
        return Promise.resolve({ models });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    putApiMock.mockResolvedValue({
      runtimeControls: { ...runtimeControls, defaultReasoningEffort: "high" },
      modelDefaults,
    });

    render(<RuntimeControlPanel />);

    await waitForPanelReady();

    await chooseSelectOption("全局默认推理强度", "高");

    await waitFor(() => expect(putApiMock).toHaveBeenCalledWith(USER_SETTINGS_API_PATH, expect.objectContaining({
      runtimeControls: expect.objectContaining({ defaultReasoningEffort: "high" }),
    })), { timeout: 2000 });
  });
});
