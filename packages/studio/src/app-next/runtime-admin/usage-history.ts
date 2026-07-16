import {
  createRuntimeAdminRequest,
  encodePathSegment,
  type RuntimeAdminClientOptions,
  withQuery,
} from "./client";

export interface UsageHistoryFilters {
  readonly narratorId?: string;
  readonly chapterId?: string;
  readonly projectId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly kind?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

export interface UsageHistoryListQuery extends UsageHistoryFilters {
  readonly page?: number;
  readonly pageSize?: number;
}

export type UsageHistoryGranularity = "hour" | "day" | "month";

export interface UsageHistoryRecord {
  readonly id: string;
  readonly narratorId: string | null;
  readonly kind: string;
  readonly provider: string | null;
  readonly credentialId: string | null;
  readonly credentialName: string | null;
  readonly model: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheCreation5mTokens: number;
  readonly cacheCreation1hTokens: number;
  readonly reasoningTokens: number;
  readonly ttftMs: number | null;
  readonly durationMs: number | null;
  readonly costUsd: number | null;
  readonly contextPercent: number | null;
  readonly meterUsage: number | null;
  readonly meterUnit: string | null;
  readonly createdAt: string;
  readonly errorMessage?: string | null;
  readonly narratorTitle?: string | null;
  readonly chapterTitle?: string | null;
  readonly chapterId?: string | null;
  readonly projectId?: string | null;
  readonly hasRawDump?: boolean;
  readonly rawDump?: Readonly<Record<string, unknown>> | null;
}

export interface UsageHistoryStats {
  readonly totalRequests: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly totalCacheReadTokens: number;
  readonly totalCacheCreation5mTokens: number;
  readonly totalCacheCreation1hTokens: number;
  readonly totalReasoningTokens: number;
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly averageDurationMs: number;
  readonly averageTtftMs: number;
}

export interface UsageHistoryTimeSeriesPoint {
  readonly timestamp: string;
  readonly requestCount: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly totalCacheReadTokens: number;
  readonly totalCacheCreation5mTokens: number;
  readonly totalCacheCreation1hTokens: number;
  readonly totalReasoningTokens: number;
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly averageDurationMs: number;
  readonly averageTtftMs: number;
  readonly errorCount: number;
  readonly meterUsage: number;
  readonly meterUnit: string | null;
}

export interface UsageHistoryTimeSeriesResponse {
  readonly granularity: UsageHistoryGranularity;
  readonly points: readonly UsageHistoryTimeSeriesPoint[];
  readonly bucketCount: number;
  readonly maxBuckets: number;
  readonly truncated: boolean;
  readonly requestedStartDate: string;
  readonly requestedEndDate: string;
  readonly effectiveStartDate: string;
  readonly effectiveEndDate: string;
  readonly generatedAt: string;
}

function filterQuery(filters: UsageHistoryFilters) {
  return {
    narratorId: filters.narratorId,
    chapterId: filters.chapterId,
    projectId: filters.projectId,
    provider: filters.provider,
    model: filters.model,
    kind: filters.kind,
    startDate: filters.startDate,
    endDate: filters.endDate,
  } as const;
}

export function createUsageHistoryClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    list: (query: UsageHistoryListQuery = {}) =>
      request<{
        readonly records: readonly UsageHistoryRecord[];
        readonly total: number;
        readonly page: number;
        readonly pageSize: number;
        readonly totalPages: number;
      }>(withQuery("/api/usage-history", { ...filterQuery(query), page: query.page, pageSize: query.pageSize })),
    providers: () =>
      request<{ readonly providers: readonly string[] }>("/api/usage-history/providers"),
    stats: (filters: UsageHistoryFilters = {}) =>
      request<UsageHistoryStats>(withQuery("/api/usage-history/stats", filterQuery(filters))),
    timeseries: (
      filters: UsageHistoryFilters = {},
      granularity?: UsageHistoryGranularity,
    ) =>
      request<UsageHistoryTimeSeriesResponse>(
        withQuery("/api/usage-history/timeseries", { ...filterQuery(filters), granularity }),
      ),
    detail: (id: string) =>
      request<UsageHistoryRecord>(`/api/usage-history/${encodePathSegment(id)}`),
  } as const;
}
