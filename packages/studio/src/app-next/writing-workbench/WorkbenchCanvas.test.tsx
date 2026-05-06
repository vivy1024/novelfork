import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchCanvas } from "./WorkbenchCanvas";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

function node(overrides: Partial<WorkbenchResourceNode> = {}): WorkbenchResourceNode {
  return {
    id: "draft:1",
    kind: "draft",
    title: "城门片段",
    content: "初始正文",
    capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("WorkbenchCanvas", () => {
  it("支持打开资源、标记 dirty、输出 canvasContext 并触发保存回调", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCanvasContextChange = vi.fn();
    render(<WorkbenchCanvas node={node()} onSave={onSave} onCanvasContextChange={onCanvasContextChange} />);

    expect(screen.getAllByRole("heading", { name: "城门片段" }).length).toBeGreaterThan(0);
    expect(screen.getByText("已保存")).toBeTruthy();
    await waitFor(() => expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ activeResourceId: "draft:1", dirty: false })));

    fireEvent.change(screen.getByLabelText("草稿正文"), { target: { value: "修改正文" } });
    expect(screen.getByText("未保存")).toBeTruthy();
    await waitFor(() => expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ activeResourceId: "draft:1", dirty: true, contentPreview: "修改正文" })));

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(node(), "修改正文"));
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("只读资源禁用编辑和保存", () => {
    const onSave = vi.fn();
    render(<WorkbenchCanvas node={node({ kind: "truth", title: "真相文件", capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false } })} onSave={onSave} />);

    expect(screen.getByLabelText("文本文件正文")).toHaveProperty("readOnly", true);
    expect(screen.getByRole("button", { name: "保存" })).toHaveProperty("disabled", true);
    expect(screen.getByText("只读资源，当前画布禁用编辑。")) .toBeTruthy();
  });

  it("未选择资源时显示占位状态", () => {
    render(<WorkbenchCanvas node={null} onSave={vi.fn()} />);

    expect(screen.getByText("选择左侧资源开始写作")).toBeTruthy();
  });

  it("保存失败时保持 dirty 并显示真实错误", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("草稿保存失败"));
    render(<WorkbenchCanvas node={node()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("草稿正文"), { target: { value: "保存失败正文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect((await screen.findByRole("alert")).textContent).toContain("保存失败：草稿保存失败");
    expect(screen.getByText("未保存")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toHaveProperty("disabled", false);
  });

  it("输出可注入会话的 active resource、open tabs 与 dirty canvasContext", async () => {
    const onCanvasContextChange = vi.fn();
    render(<WorkbenchCanvas node={node()} onSave={vi.fn()} onCanvasContextChange={onCanvasContextChange} />);

    await waitFor(() => expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({
      activeResourceId: "draft:1",
      activeResource: expect.objectContaining({ kind: "draft", id: "draft:1", title: "城门片段" }),
      activeTabId: "draft:1",
      openTabs: [expect.objectContaining({ id: "draft:1", nodeId: "draft:1", kind: "draft-editor", title: "城门片段", dirty: false, source: "user" })],
      dirty: false,
    })));

    fireEvent.change(screen.getByLabelText("草稿正文"), { target: { value: "带上下文正文" } });

    await waitFor(() => expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({
      activeResource: expect.objectContaining({ kind: "draft", id: "draft:1", title: "城门片段" }),
      openTabs: [expect.objectContaining({ id: "draft:1", dirty: true })],
      dirty: true,
      contentPreview: "带上下文正文",
    })));
  });

  it("artifact 打开后可渲染工具结果 viewer 并输出 canvasContext", async () => {
    const onCanvasContextChange = vi.fn();
    render(
      <WorkbenchCanvas
        node={node({ id: "tool-result:1", kind: "tool-result", title: "生成结果", content: JSON.stringify({ renderer: "candidate.created", data: { title: "候选稿" } }) })}
        onSave={vi.fn()}
        onCanvasContextChange={onCanvasContextChange}
      />,
    );

    expect(screen.getByText("工具结果")).toBeTruthy();
    expect(screen.getByTestId("raw-resource-node").textContent).toContain("candidate.created");
    await waitFor(() => expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ activeResourceId: "tool-result:1", activeKind: "tool-result" })));
  });

  it("RED: 不把未 hydrate 的章节列表预览当作已加载正文编辑器", () => {
    render(
      <WorkbenchCanvas
        node={node({
          id: "chapter:book-1:1",
          kind: "chapter",
          title: "第一章",
          content: "",
          metadata: { bookId: "book-1", chapterNumber: 1, source: "list-preview" },
          capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
        })}
        onSave={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("章节正文")).toBeNull();
    expect(screen.getByText(/章节详情.*加载|未完成详情 hydrate/)).toBeTruthy();
  });

  it("RED: 详情未 hydrate 前禁止把章节 textarea 内容保存回正式资源", () => {
    const onSave = vi.fn();
    render(
      <WorkbenchCanvas
        node={node({
          id: "chapter:book-1:1",
          kind: "chapter",
          title: "第一章",
          content: "",
          metadata: { bookId: "book-1", chapterNumber: 1, source: "list-preview" },
          capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
        })}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toMatch(/详情.*未加载|hydrate/);
  });
});
