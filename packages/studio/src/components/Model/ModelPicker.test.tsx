import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelPicker } from "./ModelPicker";

const fetchJsonMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (path: string) => fetchJsonMock(path),
}));

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
});

describe("ModelPicker", () => {
  it("uses the unified runtime model pool and emits provider/model selection", async () => {
    fetchJsonMock.mockResolvedValue({
      models: [
        {
          modelId: "sub2api:gpt-5-codex",
          modelName: "GPT-5 Codex",
          providerId: "sub2api",
          providerName: "Sub2API",
          enabled: true,
          contextWindow: 192000,
          maxOutputTokens: 8192,
          source: "detected",
          lastTestStatus: "success",
          capabilities: { streaming: true },
        },
      ],
    });
    const onChange = vi.fn();

    render(<ModelPicker theme="light" onChange={onChange} />);

    expect((await screen.findAllByText("Sub2API · GPT-5 Codex")).length).toBeGreaterThan(0);
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/providers/models");

    onChange.mockClear();
    fireEvent.change(screen.getByLabelText("运行时模型"), { target: { value: "sub2api:gpt-5-codex" } });

    expect(onChange).toHaveBeenCalledWith("sub2api", "gpt-5-codex");
  });

  it("shows an empty runtime model pool state", async () => {
    fetchJsonMock.mockResolvedValue({ models: [] });

    render(<ModelPicker theme="light" onChange={() => {}} />);

    expect(await screen.findByText("尚未配置可用模型")).toBeTruthy();
    expect(screen.getByLabelText("运行时模型")).toHaveProperty("disabled", true);
  });
});
