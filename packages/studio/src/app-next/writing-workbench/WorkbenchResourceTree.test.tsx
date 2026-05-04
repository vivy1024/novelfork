import { cleanup, render, screen } from "@testing-library/react";
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
      { id: "truth:1", kind: "truth", title: "真相文件", capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false } },
      { id: "candidate:1", kind: "candidate", title: "候选稿", capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: true } },
      { id: "unknown:1", kind: "unsupported", title: "未知资源", capabilities: { open: true, readonly: true, unsupported: true, edit: false, delete: false, apply: false } },
    ],
  },
];

afterEach(() => cleanup());

describe("WorkbenchResourceTree", () => {
  it("渲染 readonly/unsupported/edit/delete/apply capability 标记", () => {
    render(<WorkbenchResourceTree nodes={nodes} selectedNodeId="candidate:1" onOpen={vi.fn()} />);

    expect(screen.getByText("第一章")).toBeTruthy();
    expect(screen.getAllByText("可编辑")).toHaveLength(2);
    expect(screen.getAllByText("只读")).toHaveLength(2);
    expect(screen.getByText("不支持")).toBeTruthy();
    expect(screen.getByText("可删除")).toBeTruthy();
    expect(screen.getByText("可应用")).toBeTruthy();
    expect(screen.getByRole("button", { name: /候选稿/ }).getAttribute("aria-current")).toBe("true");
  });
});
