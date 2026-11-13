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
  it("只标出只读 / 不支持这类限制，可编辑、可删除这类常态不占行宽", () => {
    render(<WorkbenchResourceTree nodes={nodes} selectedNodeId="chapter:2" onOpen={vi.fn()} />);

    expect(screen.getByText("第一章")).toBeTruthy();
    // 「未知资源」既只读又不支持，只显示更强的「不支持」。
    expect(screen.getAllByText("只读")).toHaveLength(1);
    expect(screen.getByText("不支持")).toBeTruthy();
    expect(screen.queryByText("可编辑")).toBeNull();
    expect(screen.queryByText("可删除")).toBeNull();
    expect(screen.queryByText("可应用")).toBeNull();
    const selected = screen.getByRole("button", { name: /第二章/ });
    expect(selected.getAttribute("aria-current")).toBe("true");
    expect(selected.getAttribute("aria-selected")).toBe("true");
  });

  it("文件名占满剩余宽度、带完整名称提示，普通文件用文件图标而不是闪光图标", () => {
    const caps = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };
    const fileNodes: readonly WorkbenchResourceNode[] = [
      { id: "file:long", kind: "file", title: "道统统一详表_合并版.md", path: "道统统一详表_合并版.md", capabilities: caps },
    ];
    const { container } = render(<WorkbenchResourceTree nodes={fileNodes} onOpen={vi.fn()} toolbar={false} />);

    const name = screen.getByText("道统统一详表_合并版.md");
    expect(name.getAttribute("title")).toBe("道统统一详表_合并版.md");
    expect(name.className).toContain("flex-1");
    expect(name.className).toContain("min-w-0");
    expect(container.querySelector(".lucide-sparkles")).toBeNull();
    expect(container.querySelector(".lucide-file")).toBeTruthy();
  });

  it("toolbar=false 用于固定清单：不显示搜索/排序，分组不画多余花哨图标，各分析工具使用专属单色细线图标（不用小扳手 Wrench）", () => {
    const groupCaps = { open: false, readonly: true, unsupported: false, edit: false, apply: false, delete: false };
    const toolCaps = { open: true, readonly: true, unsupported: false, edit: false, apply: false, delete: false };
    const tools: readonly WorkbenchResourceNode[] = [
      { id: "tool-group:runtime", kind: "tool-group", title: "运行与协同", capabilities: groupCaps,
        children: [{ id: "tool:runtime", kind: "tool", title: "故事状态总览", metadata: { toolPanel: "runtime", icon: "layers" }, capabilities: toolCaps }] },
      { id: "tool-group:pre-writing", kind: "tool-group", title: "写前筹备", capabilities: groupCaps,
        children: [{ id: "tool:arcs", kind: "tool", title: "角色弧线", metadata: { toolPanel: "arcs", icon: "waypoints" }, capabilities: toolCaps }] },
    ];
    const onOpen = vi.fn();
    const { container } = render(<WorkbenchResourceTree nodes={tools} selectedNodeId="tool:arcs" onOpen={onOpen} toolbar={false} ariaLabel="分析工具" />);

    const tree = screen.getByRole("navigation", { name: "分析工具" });
    expect(screen.queryByLabelText("搜索文件树")).toBeNull();
    expect(screen.queryByLabelText("文件树排序")).toBeNull();
    // 按名称排序会把「写前筹备」排到「运行与协同」前面；固定清单保持传入顺序
    expect(tree.textContent!.indexOf("运行与协同")).toBeLessThan(tree.textContent!.indexOf("写前筹备"));
    // 废除一排小扳手和分组花哨图标
    expect(container.querySelector(".lucide-wrench")).toBeNull();
    expect(container.querySelector(".lucide-target")).toBeNull();
    // 具体工具使用各自语义图标，常态中性色、选中态主色
    const runtimeIcon = container.querySelector("[data-tool-icon='layers']");
    const arcsIcon = container.querySelector("[data-tool-icon='waypoints']");
    expect(runtimeIcon).not.toBeNull();
    expect(runtimeIcon?.getAttribute("class")).toContain("text-muted-foreground");
    expect(arcsIcon).not.toBeNull();
    expect(arcsIcon?.getAttribute("class")).toContain("text-primary");

    fireEvent.click(screen.getByRole("button", { name: /角色弧线/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "tool:arcs" }));
  });
});
