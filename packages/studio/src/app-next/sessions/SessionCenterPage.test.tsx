import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NarratorSessionRecord } from "../../shared/session-types";

const useWindowStoreMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("SessionCenterPage must not use windowStore");
}));

vi.mock("../../stores/windowStore", () => ({
  useWindowStore: useWindowStoreMock,
}));

vi.mock("../../components/sessions/SessionCenter", () => ({
  SessionCenter: ({ onOpenSession }: { readonly onOpenSession: (session: NarratorSessionRecord) => void }) => (
    <button
      type="button"
      onClick={() => onOpenSession({
        id: "session 1",
        title: "测试会话",
        agentId: "writer",
        kind: "standalone",
        sessionMode: "chat",
        status: "active",
        createdAt: "2026-05-06T00:00:00.000Z",
        lastModified: "2026-05-06T00:00:00.000Z",
        messageCount: 0,
        sortOrder: 0,
        sessionConfig: {
          providerId: "sub2api",
          modelId: "gpt-5.4",
          permissionMode: "edit",
          reasoningEffort: "medium",
        },
      })}
    >
      打开测试会话
    </button>
  ),
}));

import { SessionCenterPage } from "./SessionCenterPage";

describe("SessionCenterPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/next");
  });

  it("opens sessions through the live narrator route instead of windowStore shell windows", () => {
    window.history.replaceState(null, "", "/next/sessions");

    render(<SessionCenterPage />);
    fireEvent.click(screen.getByRole("button", { name: "打开测试会话" }));

    expect(useWindowStoreMock).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/next/narrators/session%201");
  });
});
