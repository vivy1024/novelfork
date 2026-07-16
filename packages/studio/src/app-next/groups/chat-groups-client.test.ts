import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/hooks/use-api";
import { chatGroupsClient } from "../runtime-admin/chat-groups";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatGroupsClient", () => {
  it("uses the authenticated fetchJson path for list, detail, and cursor pagination", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ groups: [], group: {}, members: [], messages: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await chatGroupsClient.listGroups(25);
    await chatGroupsClient.getGroup("group/one");
    await chatGroupsClient.listMessages("group/one", {
      cursor: "2026-05-07T12:30:00.000Z",
      limit: 20,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/chat-groups?limit=25");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/chat-groups/group%2Fone");
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "/api/chat-groups/group%2Fone/messages?cursor=2026-05-07T12%3A30%3A00.000Z&limit=20",
    );
  });

  it("sends the exact create, member, normal-message, and urgent-message request bodies", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await chatGroupsClient.createGroup({ originNarratorId: "narrator-origin", title: "编辑群" });
    await chatGroupsClient.addMember("group-1", "editor");
    await chatGroupsClient.sendMessage("group-1", "普通消息");
    await chatGroupsClient.sendMessage("group-1", "需要立刻处理", true);

    const expectedRequests = [
      ["/api/chat-groups", { originNarratorId: "narrator-origin", title: "编辑群" }],
      ["/api/chat-groups/group-1/members", { handle: "editor" }],
      ["/api/chat-groups/group-1/messages", { content: "普通消息", urgent: false }],
      ["/api/chat-groups/group-1/messages", { content: "需要立刻处理", urgent: true }],
    ] as const;

    expectedRequests.forEach(([path, body], index) => {
      const [actualPath, init] = fetchMock.mock.calls[index] ?? [];
      expect(actualPath).toBe(path);
      expect(init?.method).toBe("POST");
      expect((init?.headers as Headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual(body);
    });
  });

  it("preserves Runtime HTTP errors for the product error state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(
      { error: { code: "INVALID_CHAT_GROUP", message: "群组不可访问" } },
      { status: 404 },
    )));

    await expect(chatGroupsClient.getGroup("missing")).rejects.toEqual(
      expect.objectContaining<ApiRequestError>({
        name: "ApiRequestError",
        message: "群组不可访问",
        code: "INVALID_CHAT_GROUP",
        status: 404,
      }),
    );
  });
});
