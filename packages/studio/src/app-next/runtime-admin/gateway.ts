import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export type GatewayPlatform =
  | "telegram"
  | "discord"
  | "slack"
  | "feishu"
  | "webhook"
  | "weixin"
  | "qqbot";

export interface GatewayStatus {
  readonly started: boolean;
  readonly platforms: readonly GatewayPlatform[];
}

export interface GatewaySession {
  readonly id: string;
  readonly platform: GatewayPlatform | string;
  readonly chatId: string;
  readonly userId: string;
  readonly username: string | null;
  readonly narratorId: string;
  readonly appUserId: string | null;
  readonly projectId: string | null;
  readonly chapterId: string | null;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GatewayReloadResult extends OkResponse {
  readonly reloaded: readonly GatewayPlatform[];
  readonly status: GatewayStatus;
}

export function createGatewayClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    status: () => request<GatewayStatus>("/api/gateway/status"),
    reload: (platforms?: readonly GatewayPlatform[]) =>
      request<GatewayReloadResult>(
        "/api/gateway/reload",
        jsonRequest("POST", platforms ? { platforms } : {}),
      ),
    sessions: () => request<readonly GatewaySession[]>("/api/gateway/sessions"),
    deleteSession: (id: string) =>
      request<OkResponse>(`/api/gateway/sessions/${encodePathSegment(id)}`, {
        method: "DELETE",
      }),
  } as const;
}
