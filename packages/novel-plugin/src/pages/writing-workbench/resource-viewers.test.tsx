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
    id: "chapter:1",
    kind: "chapter",
    title: "城门片段",
    content: "风从城门洞里灌进来。",
    capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("resource viewer registry", () => {
  it("注册 writing workbench 支持的最小 viewer", () => {
    const kinds: ResourceViewerKind[] = ["chapter", "story", "jingwei", "storyline", "jingwei-section", "jingwei-entry", "narrative-line", "tool-result", "generic"];

    for (const kind of kinds) {
      expect(resourceViewerRegistry[kind]).toBeTruthy();
    }
  });

  it("按资源 kind 选择 viewer，并为未知 kind 回退 generic", () => {
    expect(getResourceViewer(node({ kind: "jingwei" })).kind).toBe("jingwei");
    expect(getResourceViewer(node({ kind: "jingwei-entry" })).kind).toBe("jingwei-entry");
    expect(getResourceViewer(node({ kind: "narrative-line" })).kind).toBe("narrative-line");
    expect(getResourceViewer(node({ kind: "tool-result" })).kind).toBe("tool-result");
    expect(getResourceViewer(node({ kind: "unsupported" })).kind).toBe("generic");
    expect(getResourceViewer(node({ kind: "mystery" as WorkbenchResourceNode["kind"] })).kind).toBe("generic");
  });
});

describe("ResourceViewer", () => {
  it("渲染章节正文，不提供假保存状态", () => {
    render(<ResourceViewer node={node({ kind: "chapter", title: "第一章", content: "开篇正文" })} />);
    expect(screen.getByRole("heading", { name: "第一章" })).toBeTruthy();
    const editor = screen.getByLabelText("章节正文");
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(editor.textContent).toContain("开篇正文");
    expect(screen.queryByText("已保存")).toBeNull();
  });

  it("渲染 story/file Markdown 为只读格式化编辑器，并显示来源路径", () => {
    render(
      <ResourceViewer
        node={node({
          id: "story-file:1",
          kind: "story",
          title: "原文片段.md",
          content: "# 原文标题\n\n正文内容\n\n|列1|列2|\n|---|---|\n|甲|乙|",
          path: "books/source/原文片段.md",
          capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        })}
      />,
    );

    const editor = screen.getByLabelText("Markdown 文件内容");
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(screen.getByRole("heading", { name: "原文标题" })).toBeTruthy();
    expect(screen.getByText("正文内容")).toBeTruthy();
    expect(screen.getByText("books/source/原文片段.md")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    cleanup();

    render(
      <ResourceViewer
        node={node({
          id: "truth-file:1",
          kind: "jingwei",
          title: "经纬资料.md",
          content: "真相内容",
          capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        })}
      />,
    );

    expect(screen.getByText("经纬资料")).toBeTruthy();
    expect(screen.queryByLabelText("文本文件正文")).toBeNull();
    expect(screen.getByText("暂无经纬内容")).toBeTruthy();
  });

  it("较大的 Markdown 文件默认懒加载预览，避免首次建立大编辑器文档", () => {
    const largeContent = `# 大文件\\n\\n${"长文本。".repeat(80_000)}`;
    render(
      <ResourceViewer
        node={node({
          id: "story-file:large",
          kind: "story",
          title: "大型设定.md",
          content: largeContent,
          capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        })}
      />,
    );

    expect(screen.getByText("这是一个较大的 Markdown 文件")).toBeTruthy();
    expect(screen.getByRole("button", { name: "加载 Markdown 预览" })).toBeTruthy();
    expect(screen.queryByLabelText("Markdown 文件内容")).toBeNull();
  });

  it("渲染真实合同中的经纬与叙事线节点为语义只读卡片", () => {
    render(
      <ResourceViewer
        node={node({
          id: "jingwei-entry:char-1",
          kind: "jingwei-entry",
          title: "沈舟",
          content: "主角，灵潮亲和。",
          capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
        })}
      />,
    );

    expect(screen.getByText("经纬条目")).toBeTruthy();
    expect(screen.getByText("主角，灵潮亲和。")).toBeTruthy();
    expect(screen.queryByLabelText("只读内容")).toBeNull();
    cleanup();

    render(
      <ResourceViewer
        node={node({
          id: "narrative-line:book-1",
          kind: "narrative-line",
          title: "叙事线快照",
          content: "主线：灵潮复苏。",
          capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        })}
      />,
    );

    expect(screen.getByText("叙事线")).toBeTruthy();
    expect(screen.getByDisplayValue("主线：灵潮复苏。")).toBeTruthy();
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
