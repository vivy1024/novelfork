import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupChatPage } from "./GroupChatPage";
import { chatGroupsClient } from "../runtime-admin/chat-groups";

vi.mock("../runtime-admin/chat-groups", () => ({
  chatGroupsClient: {
    listGroups: vi.fn(),
    getGroup: vi.fn(),
    listMessages: vi.fn(),
    createGroup: vi.fn(),
    addMember: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

const group = {
  id: "group-1",
  title: "编辑群",
  originNarratorId: "origin-1",
  projectId: null,
  createdBy: "user-1",
  status: "active" as const,
  createdAt: "2026-05-07T12:00:00.000Z",
  updatedAt: "2026-05-07T12:00:00.000Z",
};

const member = {
  id: "member-1",
  groupId: "group-1",
  memberType: "narrator" as const,
  userId: null,
  narratorId: "origin-1",
  role: "origin" as const,
  canControl: false,
  joinedAt: "2026-05-07T12:00:00.000Z",
  handle: "origin",
  title: "主叙述者",
  status: "idle",
};

const message = {
  id: "message-1",
  groupId: "group-1",
  senderType: "user" as const,
  senderUserId: "user-1",
  senderNarratorId: null,
  senderLabel: "writer",
  content: "请检查这一段情节",
  urgent: false,
  createdAt: "2026-05-07T12:01:00.000Z",
};

const moreMessage = { ...message, id: "message-0", content: "更早的消息", createdAt: "2026-05-07T11:59:00.000Z" };

const mockedClient = vi.mocked(chatGroupsClient);

afterEach(() => cleanup());
beforeEach(() => {
  vi.resetAllMocks();
});

describe("GroupChatPage", () => {
  it("shows the Runtime list error instead of inventing groups", async () => {
    mockedClient.listGroups.mockRejectedValue(new Error("token expired"));

    render(<GroupChatPage />);

    expect((await screen.findByRole("alert")).textContent).toContain("token expired");
    expect(screen.getByText("群组列表加载失败")).toBeTruthy();
    expect(screen.queryByText("编辑群")).toBeNull();
  });

  it("loads messages and members, requests older pages, and sends member/message actions", async () => {
    mockedClient.listGroups.mockResolvedValue({ groups: [{ ...group, memberCount: 1 }] });
    mockedClient.getGroup.mockResolvedValue({ group, members: [member] });
    mockedClient.listMessages.mockResolvedValue({ messages: [message], nextCursor: "older-than-message-1" });
    mockedClient.addMember.mockResolvedValue({ members: [member] });
    mockedClient.sendMessage.mockResolvedValue(message);

    render(<GroupChatPage />);

    expect(await screen.findByText("请检查这一段情节")).toBeTruthy();
    expect(screen.getAllByText("编辑群").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(mockedClient.listMessages).toHaveBeenCalledWith("group-1", {
      cursor: "older-than-message-1",
      limit: 50,
    }));

    fireEvent.change(screen.getByLabelText("发送消息"), { target: { value: "需要立即处理" } });
    fireEvent.click(screen.getByRole("button", { name: "紧急发送" }));
    await waitFor(() => expect(mockedClient.sendMessage).toHaveBeenCalledWith("group-1", "需要立即处理", true));
  });
});
