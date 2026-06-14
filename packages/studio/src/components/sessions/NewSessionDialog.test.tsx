import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
      <NewSessionDialog
        open
        onOpenChange={onOpenChange}
        onCreate={onCreate}
      />,
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
      <NewSessionDialog
        open
        onOpenChange={() => {}}
        onCreate={onCreate}
      />,
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

  it("lets authors choose the permission mode during session creation", async () => {
    mockRuntimeModels();
    const onCreate = vi.fn();

    render(
      <NewSessionDialog
        open
        onOpenChange={() => {}}
        onCreate={onCreate}
      />,
    );

    await screen.findByText("Sub2API · GPT-5 Codex");

    fireEvent.click(screen.getByRole("button", { name: /全部允许/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "novelist",
      title: "小说创作会话",
      sessionMode: "chat",
      sessionConfig: {
        providerId: "sub2api",
        modelId: "gpt-5-codex",
        permissionMode: "allow",
      },
    });
  });

  it("captures workspace, model, permission and plan mode before creating", async () => {
    mockRuntimeModels([
      { modelId: "sub2api:gpt-5-codex", modelName: "GPT-5 Codex", providerName: "Sub2API" },
      { modelId: "anthropic:claude-sonnet-4-6", modelName: "Claude Sonnet 4.6", providerName: "Anthropic" },
    ]);
    const onCreate = vi.fn();

    render(
      <NewSessionDialog
        open
        onOpenChange={() => {}}
        onCreate={onCreate}
      />,
    );

    await screen.findByText("Sub2API · GPT-5 Codex");

    fireEvent.change(screen.getByLabelText("会话标题"), { target: { value: "世界观规划室" } });
    fireEvent.change(screen.getByLabelText("工作目录"), { target: { value: "D:\\novels\\lingchao" } });
    fireEvent.click(screen.getByRole("button", { name: "计划模式" }));
    const permissionRegion = screen.getByText("权限模式").closest("div")?.parentElement;
    if (!permissionRegion) throw new Error("权限模式区域缺失");
    fireEvent.click(within(permissionRegion).getByRole("button", { name: /只读/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "novelist",
      title: "世界观规划室",
      worktree: "D:\\novels\\lingchao",
      sessionMode: "plan",
      sessionConfig: {
        providerId: "sub2api",
        modelId: "gpt-5-codex",
        permissionMode: "read",
      },
    });
  });

  it("blocks creation when the unified runtime model pool is empty", async () => {
    mockRuntimeModels([]);
    const onCreate = vi.fn();

    render(
      <NewSessionDialog
        open
        onOpenChange={() => {}}
        onCreate={onCreate}
      />,
    );

    expect(await screen.findByText("尚未配置可用模型")).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建会话" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
