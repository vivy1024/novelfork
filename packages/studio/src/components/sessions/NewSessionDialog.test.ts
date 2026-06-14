import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { NewSessionDialog } from "./NewSessionDialog";

const fetchJsonMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (path: string) => fetchJsonMock(path),
}));

function mockRuntimeModels(models = [{ modelId: "sub2api:gpt-5-codex", modelName: "GPT-5 Codex", providerName: "Sub2API" }]) {
  fetchJsonMock.mockResolvedValue({ models });
}

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
});

describe("NewSessionDialog", () => {
  it("creates a session with novelist agent and default title", async () => {
    mockRuntimeModels();
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();

    render(
      React.createElement(NewSessionDialog, {
        open: true,
        onOpenChange,
        onCreate,
      }),
    );

    expect(await screen.findByText("Sub2API · GPT-5 Codex")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "novelist",
      title: "小说创作会话",
      sessionMode: "chat",
      sessionConfig: {
        providerId: "sub2api",
        modelId: "gpt-5-codex",
        permissionMode: "edit",
      },
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("allows overriding title and agent id before submit", async () => {
    mockRuntimeModels();
    const onCreate = vi.fn();

    render(
      React.createElement(NewSessionDialog, {
        open: true,
        onOpenChange: () => {},
        onCreate,
      }),
    );

    await screen.findByText("Sub2API · GPT-5 Codex");
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "custom-agent" } });
    fireEvent.change(screen.getByLabelText("会话标题"), { target: { value: "自定义会话" } });
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "custom-agent",
      title: "自定义会话",
      sessionMode: "chat",
      sessionConfig: {
        providerId: "sub2api",
        modelId: "gpt-5-codex",
        permissionMode: "ask",
      },
    });
  });

  it("shows novelist role description", async () => {
    mockRuntimeModels();

    render(
      React.createElement(NewSessionDialog, {
        open: true,
        onOpenChange: () => {},
        onCreate: () => {},
      }),
    );

    await screen.findByText("Sub2API · GPT-5 Codex");
    expect(screen.getByText(/Novelist · 小说创作/)).toBeTruthy();
    expect(screen.getByText(/写作、规划、审计、世界观构建、伏笔管理/)).toBeTruthy();
  });
});
