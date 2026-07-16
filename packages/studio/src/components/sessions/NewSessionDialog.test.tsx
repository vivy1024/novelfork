import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { NewSessionDialog } from "./NewSessionDialog";

const fetchJsonMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (path: string) => fetchJsonMock(path),
}));

function mockRuntimeModels(models = [{ modelId: "sub2api:gpt-5.6", modelName: "GPT-5.6", providerName: "Sub2API" }]) {
  fetchJsonMock.mockResolvedValue({ models });
}

beforeAll(() => {
  (window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = vi.fn();
  (window.HTMLElement.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = vi.fn(() => false);
  (window.HTMLElement.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
});

describe("NewSessionDialog", () => {
  it("creates a canonical Runtime narrator with default settings", async () => {
    mockRuntimeModels();
    const onCreate = vi.fn();

    render(<NewSessionDialog open onOpenChange={vi.fn()} onCreate={onCreate} />);

    expect((await screen.findAllByText("Sub2API · GPT-5.6")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "创建叙述者" }));

    expect(onCreate).toHaveBeenCalledWith({
      title: "小说创作会话",
      model: "sub2api:gpt-5.6",
      permissionMode: "acceptEdits",
      startInPlanMode: false,
    });
  });

  it("captures title, plan mode, permission, reasoning, and cwd", async () => {
    mockRuntimeModels([
      { modelId: "sub2api:gpt-5.6", modelName: "GPT-5.6", providerName: "Sub2API" },
      { modelId: "anthropic:claude-sonnet-4-6", modelName: "Claude Sonnet 4.6", providerName: "Anthropic" },
    ]);
    const onCreate = vi.fn();

    render(<NewSessionDialog open onOpenChange={vi.fn()} onCreate={onCreate} />);
    await screen.findAllByText("Sub2API · GPT-5.6");

    fireEvent.change(screen.getByLabelText("叙述者标题"), { target: { value: "世界观规划室" } });
    fireEvent.change(screen.getByLabelText("工作目录"), { target: { value: "D:\\novels\\world" } });

    fireEvent.pointerDown(screen.getByLabelText("启动模式"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("option", { name: "计划模式" }));
    fireEvent.pointerDown(screen.getByLabelText("权限模式"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("option", { name: "只读" }));
    fireEvent.pointerDown(screen.getByLabelText("推理强度"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("option", { name: "极高" }));
    fireEvent.pointerDown(screen.getByLabelText("运行时模型"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("option", { name: "Anthropic · Claude Sonnet 4.6" }));

    fireEvent.click(screen.getByRole("button", { name: "创建叙述者" }));

    expect(onCreate).toHaveBeenCalledWith({
      title: "世界观规划室",
      model: "anthropic:claude-sonnet-4-6",
      permissionMode: "readOnly",
      reasoningEffort: "xhigh",
      startInPlanMode: true,
      cwd: "D:\\novels\\world",
    });
  });

  it("allows creation with the Runtime default when the model pool is empty", async () => {
    mockRuntimeModels([]);
    const onCreate = vi.fn();

    render(<NewSessionDialog open onOpenChange={vi.fn()} onCreate={onCreate} />);

    expect(await screen.findByText("将跟随 Runtime 默认模型；可在设置中稍后配置。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建叙述者" }));
    expect(onCreate).toHaveBeenCalledWith({
      title: "小说创作会话",
      permissionMode: "acceptEdits",
      startInPlanMode: false,
    });
  });
});
