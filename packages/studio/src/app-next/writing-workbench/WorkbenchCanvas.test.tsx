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
  it("支持打开资源、标记 dirty 并触发保存回调", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<WorkbenchCanvas node={node()} onSave={onSave} />);

    expect(screen.getByRole("heading", { name: "城门片段" })).toBeTruthy();
    expect(screen.getByText("已保存")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("资源正文"), { target: { value: "修改正文" } });
    expect(screen.getByText("未保存")) .toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(node(), "修改正文"));
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("只读资源禁用编辑和保存", () => {
    const onSave = vi.fn();
    render(<WorkbenchCanvas node={node({ kind: "truth", title: "真相文件", capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false } })} onSave={onSave} />);

    expect(screen.getByLabelText("资源正文")).toHaveProperty("readOnly", true);
    expect(screen.getByRole("button", { name: "保存" })).toHaveProperty("disabled", true);
    expect(screen.getByText("只读资源，当前画布禁用编辑。")) .toBeTruthy();
  });

  it("未选择资源时显示占位状态", () => {
    render(<WorkbenchCanvas node={null} onSave={vi.fn()} />);

    expect(screen.getByText("选择左侧资源开始写作")) .toBeTruthy();
  });
});
