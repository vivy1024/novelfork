import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  withQuery,
  type RuntimeAdminClientOptions,
} from "./client";

export interface RuntimeNugLoginResult {
  readonly apiKey?: string;
  readonly user?: Readonly<Record<string, unknown>>;
}

export interface RuntimeNugOAuthStartResult {
  readonly authorizeUrl: string;
}

export interface RuntimeNugQuota extends Readonly<Record<string, unknown>> {
  readonly balance?: number;
  readonly totalGranted?: number;
  readonly username?: string;
  readonly role?: string;
  readonly userId?: string;
  readonly currency?: string;
}

export interface RuntimeNugChannelHealthItem extends Readonly<Record<string, unknown>> {
  readonly id?: string;
  readonly name?: string;
  readonly channel?: string;
  readonly channelType?: string;
  readonly status?: string;
  readonly available?: boolean;
  readonly availability?: number;
  readonly availableRate?: number;
  readonly credentialCount?: number;
  readonly concurrency?: number;
  readonly queueDepth?: number;
  readonly error?: string;
  readonly message?: string;
}

export interface RuntimeNugChannelHealth extends Readonly<Record<string, unknown>> {
  readonly channels?: readonly RuntimeNugChannelHealthItem[];
}

export type RuntimeNugUsageRange = "today" | "7days" | "30days" | "all";

export interface RuntimeNugUsageRecord extends Readonly<Record<string, unknown>> {
  readonly id?: string;
  readonly createdAt?: string;
  readonly timestamp?: string;
  readonly model?: string;
  readonly channel?: string;
  readonly channelType?: string;
  readonly provider?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly quotaCost?: number;
  readonly meterUsage?: number;
  readonly status?: string;
  readonly durationMs?: number;
}

export interface RuntimeNugUsageResponse extends Readonly<Record<string, unknown>> {
  readonly records?: readonly RuntimeNugUsageRecord[];
  readonly usage?: readonly RuntimeNugUsageRecord[];
  readonly total?: number;
  readonly offset?: number;
  readonly limit?: number;
}

export interface RuntimeNugUsageSummary {
  readonly requestCount: number;
  readonly totalMeterUsage: number;
  readonly totalQuotaCost: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheWriteTokens: number;
  readonly totalCacheReadTokens: number;
}

export interface RuntimeNugBillingConfig extends RuntimeNugQuota {
  readonly providers?: readonly string[];
  readonly channels?: readonly string[];
  readonly minAmount?: number;
  readonly maxAmount?: number;
}

export interface RuntimeNugBillingOrder extends Readonly<Record<string, unknown>> {
  readonly id?: string;
  readonly orderId?: string;
  readonly status?: string;
  readonly amount?: number;
  readonly provider?: string;
  readonly channel?: string;
  readonly payUrl?: string;
  readonly paymentUrl?: string;
  readonly expiresAt?: string;
}

export interface RuntimeNugBillingOrderInput {
  readonly amount: number;
  readonly provider: string;
  readonly channel?: string;
}

export interface RuntimeNugUsageInput {
  readonly range?: RuntimeNugUsageRange;
  readonly limit?: number;
  readonly offset?: number;
}

export function createNugProviderClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  const providerPath = (providerId: string, suffix: string) =>
    `/api/nug/providers/${encodePathSegment(providerId)}${suffix}`;

  return {
    nugLogin: (providerId: string, username: string, password: string) =>
      request<RuntimeNugLoginResult>(
        providerPath(providerId, "/login"),
        jsonRequest("POST", { username, password }),
      ),
    nugOAuthStart: (providerId: string) =>
      request<RuntimeNugOAuthStartResult>(providerPath(providerId, "/oauth/start")),
    nugGetQuota: (providerId: string) =>
      request<RuntimeNugQuota>(providerPath(providerId, "/quota")),
    nugGetAllQuotas: () => request<Readonly<Record<string, RuntimeNugQuota>>>("/api/nug/quotas"),
    nugGetChannelsHealth: (providerId: string) =>
      request<RuntimeNugChannelHealth>(providerPath(providerId, "/channels/health")),
    nugGetUsage: (providerId: string, input: RuntimeNugUsageInput = {}) =>
      request<RuntimeNugUsageResponse>(withQuery(providerPath(providerId, "/usage"), {
        range: input.range,
        limit: input.limit,
        offset: input.offset,
      })),
    nugGetUsageSummary: (providerId: string, range: RuntimeNugUsageRange = "30days") =>
      request<RuntimeNugUsageSummary>(withQuery(providerPath(providerId, "/usage/summary"), { range })),
    nugGetBillingConfig: (providerId: string) =>
      request<RuntimeNugBillingConfig>(providerPath(providerId, "/billing/config")),
    nugCreateBillingOrder: (providerId: string, input: RuntimeNugBillingOrderInput) =>
      request<RuntimeNugBillingOrder>(providerPath(providerId, "/billing/orders"), jsonRequest("POST", input)),
    nugGetBillingOrder: (providerId: string, orderId: string) =>
      request<RuntimeNugBillingOrder>(providerPath(providerId, `/billing/orders/${encodePathSegment(orderId)}`)),
    nugRepayBillingOrder: (providerId: string, orderId: string) =>
      request<RuntimeNugBillingOrder>(providerPath(providerId, `/billing/orders/${encodePathSegment(orderId)}/repay`), { method: "POST" }),
  } as const;
}
