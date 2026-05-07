import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("creates a session from a preset agent with generated title and runtime model", async () => {
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

  it("lets authors choose the permission mode during session creation", async () => {
    mockRuntimeModels();
    const onCreate = vi.fn();

    render(
      <NewSessionDialog
        open
        initialPresetId="architect"
        onOpenChange={() => {}}
        onCreate={onCreate}
      />,
    );

    await screen.findByText("Sub2API · GPT-5 Codex");

    expect(screen.getAllByText(/默认权限：逐项询问/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /全部允许/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "architect",
      title: "Architect 会话",
      sessionMode: "chat",
      sessionConfig: {
        providerId: "sub2api",
        modelId: "gpt-5-codex",
        permissionMode: "allow",
      },
    });
  });

  it("RED: captures independent narrator workspace, binding, model, permission and plan mode before creating", async () => {
    mockRuntimeModels([
      { modelId: "sub2api:gpt-5-codex", modelName: "GPT-5 Codex", providerName: "Sub2API" },
      { modelId: "anthropic:claude-sonnet-4-6", modelName: "Claude Sonnet 4.6", providerName: "Anthropic" },
    ]);
    const onCreate = vi.fn();

    render(
      <NewSessionDialog
        open
        initialPresetId="planner"
        onOpenChange={() => {}}
        onCreate={onCreate}
      />,
    );

    await screen.findByText("Sub2API · GPT-5 Codex");

    fireEvent.change(screen.getByLabelText("会话标题"), { target: { value: "世界观规划室" } });
    fireEvent.change(screen.getByLabelText("工作目录"), { target: { value: "D:\\novels\\lingchao" } });
    fireEvent.change(screen.getByLabelText("绑定对象"), { target: { value: "standalone" } });
    fireEvent.change(screen.getByLabelText("运行时模型"), { target: { value: "anthropic:claude-sonnet-4-6" } });
    fireEvent.click(screen.getByRole("button", { name: "计划模式" }));
    fireEvent.click(screen.getByRole("button", { name: /只读/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "planner",
      title: "世界观规划室",
      worktree: "D:\\novels\\lingchao",
      binding: { type: "standalone" },
      sessionMode: "plan",
      sessionConfig: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
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
