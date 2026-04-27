import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { EmptyState, InlineError, RunStatus, SaveStatus, ConnectionFeedback } from "./feedback";

describe("EmptyState", () => {
  it("renders title and CTA", () => {
    const onAction = vi.fn();
    render(<EmptyState title="暂无数据" description="请添加内容" actionLabel="添加" onAction={onAction} />);
    expect(screen.getByText("暂无数据")).toBeTruthy();
    expect(screen.getByText("请添加内容")).toBeTruthy();
    fireEvent.click(screen.getByText("添加"));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("renders without CTA when no action", () => {
    const { container } = render(<EmptyState title="空列表" />);
    expect(screen.getByText("空列表")).toBeTruthy();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("InlineError", () => {
  it("renders error message", () => {
    render(<InlineError message="加载失败" />);
    expect(screen.getByText("加载失败")).toBeTruthy();
  });

  it("renders retry button when provided", () => {
    const onRetry = vi.fn();
    render(<InlineError message="网络错误" onRetry={onRetry} />);
    fireEvent.click(screen.getByText("重试"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("RunStatus", () => {
  it("renders when running", () => {
    render(<RunStatus action="生成下一章" running />);
    expect(screen.getByText("生成下一章")).toBeTruthy();
  });

  it("renders nothing when not running", () => {
    const { container } = render(<RunStatus action="生成下一章" running={false} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("SaveStatus", () => {
  it("shows dirty state", () => {
    render(<SaveStatus state="dirty" />);
    expect(screen.getByText("未保存")).toBeTruthy();
  });

  it("shows saving state", () => {
    render(<SaveStatus state="saving" />);
    expect(screen.getByText("保存中…")).toBeTruthy();
  });

  it("shows saved state", () => {
    render(<SaveStatus state="saved" />);
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("shows error state", () => {
    render(<SaveStatus state="error" error="磁盘满" />);
    expect(screen.getByText("保存失败")).toBeTruthy();
  });

  it("renders nothing when clean", () => {
    const { container } = render(<SaveStatus state="clean" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ConnectionFeedback", () => {
  it("shows connected status", () => {
    render(<ConnectionFeedback status="connected" />);
    expect(screen.getByText("已连接")).toBeTruthy();
  });

  it("shows custom label", () => {
    render(<ConnectionFeedback status="error" label="MCP 连接失败" />);
    expect(screen.getByText("MCP 连接失败")).toBeTruthy();
  });
});
