import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  testModel: vi.fn(),
}));

const preferencesClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

// Spread the real module so unrelated exports the panel imports keep working.
vi.mock("../../runtime-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../runtime-admin")>()),
  createSettingsClient: () => settingsClientMock,
  createUserPreferencesClient: () => preferencesClientMock,
}));

vi.mock("@/components/ui/simple-select", () => ({
  SimpleSelect: ({ value, onValueChange, options, "aria-label": ariaLabel }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    "aria-label"?: string;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {options.map((option) => <option key={`${ariaLabel}-${option.value}`} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

import { AgentSettingsPanel } from "./AgentSettingsPanel";

const settings = {
  agent: {
    defaultPermissionMode: "acceptEdits",
    maxTurns: 200,
    silentToolCallThreshold: 20,
    pipelineUnusedToolCallThreshold: 10,
  },
};

beforeEach(() => {
  settingsClientMock.get.mockResolvedValue(settings);
  settingsClientMock.patch.mockImplementation(async (patch: Record<string, unknown>) => ({
    ...settings,
    ...patch,
  }));
  preferencesClientMock.get.mockResolvedValue({ expandReasoning: false });
  preferencesClientMock.patch.mockImplementation(async (patch: Record<string, unknown>) => patch);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AgentSettingsPanel", () => {
  it("暴露 Pipeline 未使用结果清理阈值并按 Runtime 范围提交", async () => {
    render(<AgentSettingsPanel />);
    await waitFor(() => expect(settingsClientMock.get).toHaveBeenCalledTimes(1));

    // This was the only one of Runtime's agent keys with no product入口.
    const field = await screen.findByLabelText("Pipeline 未使用结果清理阈值");
    expect((field as HTMLInputElement).value).toBe("10");

    fireEvent.change(field, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledTimes(1));
    const patch = settingsClientMock.patch.mock.calls[0][0] as { agent: Record<string, unknown> };
    expect(patch.agent.pipelineUnusedToolCallThreshold).toBe(25);
  });

  it("阈值按 Runtime 约定夹在 -1..1000 之间", async () => {
    render(<AgentSettingsPanel />);
    await waitFor(() => expect(settingsClientMock.get).toHaveBeenCalledTimes(1));

    const field = await screen.findByLabelText("Pipeline 未使用结果清理阈值");
    fireEvent.change(field, { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledTimes(1));
    const patch = settingsClientMock.patch.mock.calls[0][0] as { agent: Record<string, unknown> };
    expect(patch.agent.pipelineUnusedToolCallThreshold).toBe(1000);
  });
});
