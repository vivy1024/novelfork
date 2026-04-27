import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NewSessionDialog } from "./NewSessionDialog";

describe("NewSessionDialog", () => {
  it("creates a session from a preset agent with generated title", () => {
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();

    render(
      React.createElement(NewSessionDialog, {
        open: true,
        onOpenChange,
        onCreate,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "writer",
      title: "Writer 会话",
      sessionMode: "chat",
      sessionConfig: {
        permissionMode: "edit",
      },
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the current object overview with template, mode, and title semantics", () => {
    render(
      React.createElement(NewSessionDialog, {
        open: true,
        onOpenChange: () => {},
        onCreate: () => {},
      }),
    );

    const dialog = screen.getByRole("dialog");
    const overview = within(dialog).getByRole("heading", { name: "写作 Writer" }).closest("div")?.parentElement?.parentElement;
    expect(overview).not.toBeNull();

    const overviewText = (overview as HTMLElement).textContent ?? "";
    expect(overviewText).toContain("当前对象");
    expect(overviewText).toContain("Writer");
    expect(overviewText).toContain("对话模式");
    expect(overviewText).toContain("当前标题：Writer 会话");
    expect(overviewText).toContain("未手动编辑时会自动生成");
  });

  it("allows overriding title and agent id before submit", () => {
    const onCreate = vi.fn();

    render(
      React.createElement(NewSessionDialog, {
        open: true,
        onOpenChange: () => {},
        onCreate,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /审计 Auditor/ }));
    fireEvent.change(screen.getAllByLabelText("Agent ID").at(-1) as HTMLElement, { target: { value: "continuity-auditor" } });
    fireEvent.change(screen.getAllByLabelText("会话标题").at(-1) as HTMLElement, { target: { value: "连续性排查" } });
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "continuity-auditor",
      title: "连续性排查",
      sessionMode: "chat",
      sessionConfig: {
        permissionMode: "read",
      },
    });
  });
});
