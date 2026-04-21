import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NewSessionDialog } from "./NewSessionDialog";

describe("NewSessionDialog", () => {
  it("creates a session from a preset agent with generated title", () => {
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <NewSessionDialog
        open
        onOpenChange={onOpenChange}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "writer",
      title: "Writer 会话",
      sessionMode: "chat",
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("allows overriding title and agent id before submit", () => {
    const onCreate = vi.fn();

    render(
      <NewSessionDialog
        open
        onOpenChange={() => {}}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /审计 Auditor/ }));
    fireEvent.change(screen.getAllByLabelText("Agent ID").at(-1) as HTMLElement, { target: { value: "continuity-auditor" } });
    fireEvent.change(screen.getAllByLabelText("会话标题").at(-1) as HTMLElement, { target: { value: "连续性排查" } });
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(onCreate).toHaveBeenCalledWith({
      agentId: "continuity-auditor",
      title: "连续性排查",
      sessionMode: "chat",
    });
  });
});
