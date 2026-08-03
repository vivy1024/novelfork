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

export interface GatewaySttConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
}

export interface GatewayProxyOverride {
  readonly mode: "default" | "direct" | "system" | "custom";
  readonly url?: string;
}

export interface GatewayPlatformConfig {
  platform: GatewayPlatform;
  enabled: boolean;
  proxy?: GatewayProxyOverride;
  token?: string;
  botToken?: string;
  appToken?: string;
  appId?: string;
  appSecret?: string;
  secret?: string;
  accountId?: string;
  baseUrl?: string;
  allowedUsers?: string[];
  // QQ Bot specific
  clientSecret?: string;
  allowedGroups?: string[];
  dmPolicy?: string;
  groupPolicy?: string;
  markdownSupport?: boolean;
  sandbox?: boolean;
  stt?: GatewaySttConfig;
}

export interface GatewayConfig {
  enabled?: boolean;
  defaultProjectId?: string;
  defaultChapterId?: string;
  defaultPermissionMode?: string;
  sessionIdleMinutes?: number;
  rateLimitPerMinute?: number;
  streaming?: boolean;
  platforms?: GatewayPlatformConfig[];
}

export interface WeixinQrStartResult {
  readonly qrcodeUrl: string;
  readonly qrcodeToken: string;
  readonly error?: string;
}

export interface WeixinQrPollResult {
  readonly status: "wait" | "scaned" | "expired" | "confirmed" | "error";
  readonly canRefresh?: boolean;
  readonly accountId?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  readonly message?: string;
  readonly reason?: string;
  readonly error?: string;
  readonly code?: string;
  readonly qrcodeUrl?: string;
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

    // Gateway config (stored in user preferences)
    getConfig: async () => {
      const prefs = await request<Record<string, unknown>>("/api/user-preferences");
      const raw = prefs.gatewayConfig;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw as GatewayConfig;
      }
      return {} as GatewayConfig;
    },
    saveConfig: (config: GatewayConfig) =>
      request<unknown>(
        "/api/user-preferences",
        jsonRequest("PATCH", { gatewayConfig: config }),
      ),

    // WeChat QR login
    weixinQrStart: () =>
      request<WeixinQrStartResult>(
        "/api/gateway/weixin/qr-start",
        jsonRequest("POST", {}),
      ),
    weixinQrPoll: () =>
      request<WeixinQrPollResult>("/api/gateway/weixin/qr-poll"),
  } as const;
}
