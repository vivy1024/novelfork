import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchResourceTree } from "./WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

const nodes: readonly WorkbenchResourceNode[] = [
  {
    id: "group:root",
    kind: "group",
    title: "资源",
    capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
    children: [
      { id: "chapter:1", kind: "chapter", title: "第一章", capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } },
      { id: "truth:1", kind: "jingwei", title: "经纬资料", capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false } },
      { id: "chapter:2", kind: "chapter", title: "第二章", capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false } },
      { id: "unknown:1", kind: "unsupported", title: "未知资源", capabilities: { open: true, readonly: true, unsupported: true, edit: false, delete: false, apply: false } },
    ],
  },
];

afterEach(() => cleanup());

describe("WorkbenchResourceTree", () => {
  it("渲染 readonly/unsupported/edit/delete/apply capability 标记", () => {
    render(<WorkbenchResourceTree nodes={nodes} selectedNodeId="chapter:2" onOpen={vi.fn()} />);

    expect(screen.getByText("第一章")).toBeTruthy();
    expect(screen.getAllByText("可编辑")).toHaveLength(2);
    expect(screen.getAllByText("只读")).toHaveLength(2);
    expect(screen.getByText("不支持")).toBeTruthy();
    expect(screen.getByText("可删除")).toBeTruthy();
    expect(screen.queryByText("可应用")).toBeNull();
    const selected = screen.getByRole("button", { name: /第二章/ });
    expect(selected.getAttribute("aria-current")).toBe("true");
    expect(selected.getAttribute("aria-selected")).toBe("true");
  });

  it("toolbar=false 用于固定清单：不显示搜索/排序，节点保持传入顺序，分组显示 lucide 图标", () => {
    const groupCaps = { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false };
    const toolCaps = { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false };
    const tools: readonly WorkbenchResourceNode[] = [
      { id: "tool-group:runtime", kind: "tool-group", title: "运行与协同", metadata: { icon: "settings" }, capabilities: groupCaps,
        children: [{ id: "tool:runtime", kind: "tool", title: "底层状态总览", capabilities: toolCaps }] },
      { id: "tool-group:pre-writing", kind: "tool-group", title: "写前筹备", metadata: { icon: "target" }, capabilities: groupCaps,
        children: [{ id: "tool:arcs", kind: "tool", title: "角色弧线", capabilities: toolCaps }] },
    ];
    const onOpen = vi.fn();
    const { container } = render(<WorkbenchResourceTree nodes={tools} onOpen={onOpen} toolbar={false} ariaLabel="分析工具" />);

    const tree = screen.getByRole("navigation", { name: "分析工具" });
    expect(screen.queryByLabelText("搜索文件树")).toBeNull();
    expect(screen.queryByLabelText("文件树排序")).toBeNull();
    // 按名称排序会把「写前筹备」排到「运行与协同」前面；固定清单保持传入顺序
    expect(tree.textContent!.indexOf("运行与协同")).toBeLessThan(tree.textContent!.indexOf("写前筹备"));
    expect(container.querySelector("[data-icon='settings']")).not.toBeNull();
    expect(container.querySelector("[data-icon='target']")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /角色弧线/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "tool:arcs" }));
  });
});
