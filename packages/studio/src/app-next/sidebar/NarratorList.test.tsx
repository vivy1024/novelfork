import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NarratorList, NarratorActions, type NarratorSession } from "./NarratorList";

afterEach(() => { cleanup(); });

const sessions: NarratorSession[] = [
  { id: "s1", title: "凡人修仙写作", status: "active", projectName: "凡人修仙传" },
  { id: "s2", title: "独立对话", status: "active" },
  { id: "s3", title: "已归档会话", status: "archived" },
];

describe("NarratorList", () => {
  it("renders active sessions and hides archived ones", () => {
    render(<NarratorList sessions={sessions} activeSessionId={null} onSessionClick={vi.fn()} />);

    expect(screen.getByText("凡人修仙写作")).toBeTruthy();
    expect(screen.getByText("独立对话")).toBeTruthy();
    expect(screen.queryByText("已归档会话")).toBeNull();
  });

  it("highlights the active session", () => {
    render(<NarratorList sessions={sessions} activeSessionId="s1" onSessionClick={vi.fn()} />);

    expect(screen.getByText("凡人修仙写作").closest("button")?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("独立对话").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("shows project name for bound sessions", () => {
    render(<NarratorList sessions={sessions} activeSessionId={null} onSessionClick={vi.fn()} />);

    expect(screen.getByText("凡人修仙传")).toBeTruthy();
  });

  it("calls onSessionClick when a session is clicked", () => {
    const onClick = vi.fn();
    render(<NarratorList sessions={sessions} activeSessionId={null} onSessionClick={onClick} />);

    fireEvent.click(screen.getByText("独立对话"));
    expect(onClick).toHaveBeenCalledWith("s2");
  });

  it("shows empty state when no active sessions", () => {
    render(<NarratorList sessions={[]} activeSessionId={null} onSessionClick={vi.fn()} />);
    expect(screen.getByText("暂无活跃会话")).toBeTruthy();
  });
});

describe("NarratorActions", () => {
  it("renders new session and cleanup buttons", () => {
    const onNew = vi.fn();
    const onClean = vi.fn();
    render(<NarratorActions onNewSession={onNew} onCleanup={onClean} />);

    fireEvent.click(screen.getByLabelText("新建会话"));
    expect(onNew).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("清空空闲叙述者"));
    expect(onClean).toHaveBeenCalledOnce();
  });
});
