import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ResourceViewer,
  getResourceViewer,
  resourceViewerRegistry,
  type ResourceViewerKind,
} from "./resource-viewers";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

function node(overrides: Partial<WorkbenchResourceNode> = {}): WorkbenchResourceNode {
  return {
    id: "draft:1",
    kind: "draft",
    title: "城门片段",
    content: "风从城门洞里灌进来。",
    capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("resource viewer registry", () => {
  it("注册 writing workbench 支持的最小 viewer", () => {
    const kinds: ResourceViewerKind[] = ["chapter", "candidate", "draft", "story", "truth", "bible-entry", "storyline", "generic"];

    for (const kind of kinds) {
      expect(resourceViewerRegistry[kind]).toBeTruthy();
    }
  });

  it("按资源 kind 选择 viewer，并为未知 kind 回退 generic", () => {
    expect(getResourceViewer(node({ kind: "candidate" })).kind).toBe("candidate");
    expect(getResourceViewer(node({ kind: "truth" })).kind).toBe("truth");
    expect(getResourceViewer(node({ kind: "unsupported" })).kind).toBe("generic");
    expect(getResourceViewer(node({ kind: "mystery" as WorkbenchResourceNode["kind"] })).kind).toBe("generic");
  });
});

describe("ResourceViewer", () => {
  it("渲染章节/候选稿/草稿正文，不提供假保存状态", () => {
    render(<ResourceViewer node={node({ kind: "chapter", title: "第一章", content: "开篇正文" })} />);
    expect(screen.getByRole("heading", { name: "第一章" })).toBeTruthy();
    expect(screen.getByLabelText("章节正文")).toHaveProperty("readOnly", false);
    expect(screen.getByDisplayValue("开篇正文")).toBeTruthy();
    expect(screen.queryByText("已保存")).toBeNull();
    cleanup();

    render(
      <ResourceViewer
        node={node({
          kind: "candidate",
          title: "候选稿 A",
          content: "候选内容",
          capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: true },
        })}
      />,
    );
    expect(screen.getByLabelText("候选稿正文")).toHaveProperty("readOnly", false);
    expect(screen.getByText("可应用")).toBeTruthy();
    cleanup();

    render(<ResourceViewer node={node({ kind: "draft", title: "草稿 A", content: "草稿内容" })} />);
    expect(screen.getByLabelText("草稿正文")).toHaveProperty("readOnly", false);
  });

  it("渲染 story/truth 文本文件为只读，并显示来源路径", () => {
    render(
      <ResourceViewer
        node={node({
          id: "story-file:1",
          kind: "story",
          title: "原文片段.txt",
          content: "原文内容",
          path: "books/source/原文片段.txt",
          capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        })}
      />,
    );

    expect(screen.getByLabelText("文本文件正文")).toHaveProperty("readOnly", true);
    expect(screen.getByText("books/source/原文片段.txt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    cleanup();

    render(
      <ResourceViewer
        node={node({
          id: "truth-file:1",
          kind: "truth",
          title: "真相文件.md",
          content: "真相内容",
          capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        })}
      />,
    );

    expect(screen.getByLabelText("文本文件正文")).toHaveProperty("readOnly", true);
    expect(screen.getByText("只读资源")) .toBeTruthy();
  });

  it("unsupported 与 unknown/generic fallback 会保留 raw node 数据", () => {
    render(<ResourceViewer node={node({ kind: "unsupported", title: "未知资源", capabilities: { open: true, readonly: true, unsupported: true, edit: false, delete: false, apply: false } })} />);

    expect(screen.getByText("不支持的资源类型")) .toBeTruthy();
    expect(screen.getByTestId("raw-resource-node").textContent).toContain('"kind": "unsupported"');
    cleanup();

    render(<ResourceViewer node={node({ kind: "mystery" as WorkbenchResourceNode["kind"], title: "神秘资源" })} />);

    expect(screen.getByText("通用资源")) .toBeTruthy();
    expect(screen.getByTestId("raw-resource-node").textContent).toContain('"title": "神秘资源"');
  });
});
