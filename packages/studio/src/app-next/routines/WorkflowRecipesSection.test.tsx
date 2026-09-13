// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const dummyRecipe = {
  id: "write-next",
  name: "写下一章",
  commandId: "/novel:write-next",
  description: "写下一章描述",
  steps: [
    {
      id: "step-1",
      kind: "context-load" as const,
      label: "加载上下文",
      enabled: true,
      tools: ["cockpit.snapshot"],
    },
    {
      id: "step-2",
      kind: "writer-generate" as const,
      label: "生成章节结果",
      enabled: true,
      tools: ["pipeline.write"],
    },
  ],
  resultStrategy: "formal-chapter" as const,
  requireFinalApproval: true,
  maxRetries: 1,
};

const mockList = vi.fn().mockResolvedValue([dummyRecipe]);
const mockSave = vi.fn().mockResolvedValue([dummyRecipe]);

vi.mock("../runtime/workflow-client", () => ({
  createWorkflowClient: () => ({
    list: (...args: unknown[]) => mockList(...args),
    save: (...args: unknown[]) => mockSave(...args),
  }),
}));

vi.mock("../runtime-admin/custom-subagents", () => ({
  createCustomSubagentsClient: () => ({
    list: () =>
      Promise.resolve([
        {
          name: "plot-checker",
          description: "剧情伏笔核查员",
          toolAccess: "custom",
          customTools: ["memory.read"],
          defaultModel: "deepseek-v4-pro",
          prompt: "检查剧情",
        },
        {
          name: "anti-slop-reviewer",
          description: "网文去AI味审查",
          toolAccess: "readOnly",
          customTools: [],
          defaultModel: "",
          prompt: "去AI味",
        },
      ]),
  }),
}));

import { WorkflowRecipesSection } from "./WorkflowRecipesSection";

describe("WorkflowRecipesSection (Backend-integrated)", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockSave.mockReset();
    mockList.mockResolvedValue([dummyRecipe]);
    mockSave.mockResolvedValue([dummyRecipe]);
  });

  afterEach(() => {
    cleanup();
  });

  it("通过 workflowClient 从后端拉取作品流水线并渲染", async () => {
    render(<WorkflowRecipesSection bookId="book-1" bookTitle="长夜" />);
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith("book-1", expect.any(AbortSignal))
    );
    expect(screen.getByText(/创作工作流装配平台/)).toBeTruthy();
    expect(screen.getByText(/当前作品：《长夜》/)).toBeTruthy();
    expect(screen.getAllByText("写下一章").length).toBeGreaterThan(0);
  });

  it("支持修改流水线并点击「保存工作流」落盘到后端", async () => {
    render(<WorkflowRecipesSection bookId="book-1" bookTitle="长夜" />);
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith("book-1", expect.any(AbortSignal))
    );

    const switchEls = screen.getAllByRole("switch");
    fireEvent.click(switchEls[0]);

    expect(screen.getByText("有未保存改动")).toBeTruthy();
    const saveBtn = screen.getByRole("button", { name: /保存工作流/ });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith("book-1", expect.any(Array)));
  });

  it("展开装配后支持自定义子代理选择与工具点选", async () => {
    render(<WorkflowRecipesSection bookId="book-1" />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const expandButtons = screen.getAllByRole("button", { name: /展开装配/ });
    fireEvent.click(expandButtons[0]);

    expect(screen.getByText("执行模式与角色挂载")).toBeTruthy();
    const toolBtn = screen.getByRole("button", { name: "scene.spec" });
    fireEvent.click(toolBtn);
    expect(screen.getByText("有未保存改动")).toBeTruthy();
  });

  it("后端拉取失败时展示错误提示", async () => {
    mockList.mockRejectedValueOnce(new Error("网络超时"));
    render(<WorkflowRecipesSection bookId="book-err" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText("网络超时")).toBeTruthy();
    });
  });

  it("切换不同作品时能取消上一个作品的请求以防串书", async () => {
    const { rerender } = render(<WorkflowRecipesSection bookId="book-prev" />);
    await waitFor(() => expect(mockList).toHaveBeenCalledWith("book-prev", expect.any(AbortSignal)));

    const firstCallSignal = mockList.mock.calls[0][1] as AbortSignal;
    rerender(<WorkflowRecipesSection bookId="book-next" />);

    expect(firstCallSignal.aborted).toBe(true);
  });
});

