import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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
  it("creates a session from a preset agent with generated title", async () => {
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
      agentId: "writer",
      title: "Writer 会话",
      sessionMode: "chat",
      sessionConfig: {
        providerId: "sub2api",
        modelId: "gpt-5-codex",
        permissionMode: "edit",
      },
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the current object overview with template, mode, and title semantics", async () => {
    mockRuntimeModels();

    render(
      React.createElement(NewSessionDialog, {
        open: true,
        onOpenChange: () => {},
        onCreate: () => {},
      }),
    );

    await screen.findByText("Sub2API · GPT-5 Codex");
    const dialog = screen.getByRole("dialog");
    const overview = within(dialog).getByRole("heading", { name: "写作 Writer" }).closest("div")?.parentElement?.parentElement;
    expect(overview).not.toBeNull();

    const overviewText = (overview as HTMLElement).textContent ?? "";
    expect(overviewText).toContain("当前对象");
    expect(overviewText).toContain("Writer");
    expect(overviewText).toContain("对话模式");
    expect(overviewText).toContain("当前标题：Writer 会话");
    expect(overviewText).toContain("未手动编辑时会自动生成");
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
    fireEvent.click(screen.getByRole("button", { name: /审计 Auditor/ }));
    fireEvent.change(screen.getAllByLabelText("Agent ID").at(-1) as HTMLElement, { target: { value: "continuity-auditor" } });
    fireEvent.change(screen.getAllByLabelText("会话标题").at(-1) as HTMLElement, { target: { value: "连续性排查" } });
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "continuity-auditor",
      title: "连续性排查",
      sessionMode: "chat",
      sessionConfig: {
        providerId: "sub2api",
        modelId: "gpt-5-codex",
        permissionMode: "read",
      },
    });
  });
});
