import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeCapability } from "../backend-contract/capability-status";
import { WorkbenchWritingActions, buildDefaultWorkbenchWritingActions } from "./WorkbenchWritingActions";

function ok<T>(data: T) {
  return { ok: true as const, data, raw: data, httpStatus: 200, capability: normalizeCapability({ id: "test", status: "current" }) };
}

function createSessions(overrides: Partial<{ existingId: string | null }> = {}) {
  const existingId = overrides.existingId ?? null;
  return {
    listActiveSessions: vi.fn(async () => ok(existingId ? [{ id: existingId, title: "已有工作台会话" }] : [])),
    createSession: vi.fn(async () => ok({ id: "session-new", title: "新建工作台会话" })),
  };
}

afterEach(() => cleanup());

describe("WorkbenchWritingActions", () => {
  it("没有绑定会话时创建 book session 并跳转到 Conversation", async () => {
    const sessions = createSessions();
    const onNavigateToConversation = vi.fn();

    render(<WorkbenchWritingActions bookId="book-1" sessions={sessions as any} onNavigateToConversation={onNavigateToConversation} />);

    fireEvent.click(screen.getByRole("button", { name: /生成下一章/ }));

    await waitFor(() => expect(sessions.createSession).toHaveBeenCalledWith(expect.objectContaining({ projectId: "book-1", agentId: "writer", kind: "standalone", sessionMode: "chat" })));
    expect(onNavigateToConversation).toHaveBeenCalledWith("session-new", expect.objectContaining({ id: "session-native.write-next" }));
  });

  it("已有绑定会话时复用 session，不重复创建", async () => {
    const sessions = createSessions({ existingId: "session-existing" });
    const onNavigateToConversation = vi.fn();

    render(<WorkbenchWritingActions bookId="book-1" sessions={sessions as any} onNavigateToConversation={onNavigateToConversation} />);

    fireEvent.click(screen.getByRole("button", { name: /连续性审校/ }));

    await waitFor(() => expect(sessions.listActiveSessions).toHaveBeenCalledWith(expect.objectContaining({ binding: "book:book-1" })));
    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(onNavigateToConversation).toHaveBeenCalledWith("session-existing", expect.objectContaining({ id: "ai.audit" }));
  });

  it("unsupported 动作禁用并展示合同原因", () => {
    const sessions = createSessions();
    const unsupportedActions = [
      {
        id: "ai.detect",
        label: "去 AI 味检测",
        capability: normalizeCapability({ id: "ai.detect", status: "unsupported" }),
      },
    ];

    render(<WorkbenchWritingActions bookId="book-1" sessions={sessions as any} actions={unsupportedActions} onNavigateToConversation={vi.fn()} />);

    const button = screen.getByRole("button", { name: /去 AI 味检测/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("当前后端或模型适配器不支持该能力。")) .toBeTruthy();
  });

  it("默认动作来自 writing action descriptors，覆盖生成、续写、扩写、审校和检测入口", () => {
    const labels = buildDefaultWorkbenchWritingActions().map((action) => action.label);

    expect(labels).toEqual(expect.arrayContaining(["生成下一章", "续写草稿", "扩写/改写", "连续性审校", "去 AI 味检测"]));
  });

  it("RED: 发布级写作动作卡片必须展示结果边界", () => {
    render(<WorkbenchWritingActions bookId="book-1" sessions={createSessions() as any} onNavigateToConversation={vi.fn()} />);

    expect(screen.getByText("结果边界：session → candidate")).toBeTruthy();
    expect(screen.getByText("结果边界：prompt-preview")).toBeTruthy();
    expect(screen.getAllByText("结果边界：audit").length).toBeGreaterThan(0);
  });
});
