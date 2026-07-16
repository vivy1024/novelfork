import { fetchJson } from "@/hooks/use-api";

export interface ChatGroup {
  readonly id: string;
  readonly title: string | null;
  readonly originNarratorId: string | null;
  readonly projectId: string | null;
  readonly createdBy: string | null;
  readonly status: "active" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatGroupSummary extends ChatGroup {
  readonly memberCount: number;
}

export interface ChatGroupMember {
  readonly id: string;
  readonly groupId: string;
  readonly memberType: "user" | "narrator";
  readonly userId: string | null;
  readonly narratorId: string | null;
  readonly role: "origin" | "named" | "participant";
  readonly canControl: boolean;
  readonly joinedAt: string;
  readonly handle?: string | null;
  readonly title?: string | null;
  readonly status?: string | null;
  readonly substatus?: readonly string[] | null;
}

export interface ChatGroupMessage {
  readonly id: string;
  readonly groupId: string;
  readonly senderType: "user" | "narrator" | "system";
  readonly senderUserId: string | null;
  readonly senderNarratorId: string | null;
  readonly senderLabel?: string;
  readonly content: string;
  readonly urgent: boolean;
  readonly createdAt: string;
}

export interface ChatGroupDetail {
  readonly group: ChatGroup;
  readonly members: readonly ChatGroupMember[];
}

export interface ChatGroupMessagePage {
  readonly messages: readonly ChatGroupMessage[];
  readonly nextCursor: string | null;
}

const CHAT_GROUPS_PATH = "/api/chat-groups";

function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const chatGroupsClient = {
  listGroups(limit = 50): Promise<{ readonly groups: readonly ChatGroupSummary[] }> {
    const params = new URLSearchParams({ limit: String(limit) });
    return fetchJson(`${CHAT_GROUPS_PATH}?${params.toString()}`);
  },

  getGroup(groupId: string): Promise<ChatGroupDetail> {
    return fetchJson(`${CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}`);
  },

  listMessages(
    groupId: string,
    options: { readonly cursor?: string; readonly limit?: number } = {},
  ): Promise<ChatGroupMessagePage> {
    const params = new URLSearchParams();
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit) params.set("limit", String(options.limit));
    const query = params.toString();
    return fetchJson(
      `${CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/messages${query ? `?${query}` : ""}`,
    );
  },

  createGroup(input: { readonly originNarratorId: string; readonly title?: string }): Promise<ChatGroup> {
    return postJson(CHAT_GROUPS_PATH, input);
  },

  addMember(groupId: string, handle: string): Promise<{ readonly members: readonly ChatGroupMember[] }> {
    return postJson(`${CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/members`, { handle });
  },

  sendMessage(groupId: string, content: string, urgent = false): Promise<ChatGroupMessage> {
    return postJson(`${CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/messages`, { content, urgent });
  },
};
