export type CacheStatus = "hit" | "miss" | "bypass";
export type RequestDomain = "admin" | "ai" | "system";
export type AiRequestStatus = "success" | "error" | "partial" | "unknown";

export interface RequestCacheMeta {
  status: CacheStatus;
  scope?: string;
  ageMs?: number;
}

export interface RequestTokenUsage {
  input?: number;
  output?: number;
  total?: number;
  estimated?: boolean;
  source?: "actual" | "estimated";
}

export interface RequestLog {
  id: string;
  timestamp: Date | string;
  method: string;
  endpoint: string;
  status: number;
  duration: number;
  userId: string;
  requestKind?: string;
  narrator?: string;
  provider?: string;
  model?: string;
  tokens?: RequestTokenUsage;
  ttftMs?: number;
  costUsd?: number;
  cache?: RequestCacheMeta;
  details?: string;
  runId?: string;
  requestDomain?: RequestDomain;
  source?: "live" | "runtime-log";
  aiStatus?: AiRequestStatus;
  errorSummary?: string;
  bookId?: string;
  sessionId?: string;
  chapterNumber?: number;
}

export interface RequestSummaryBucket {
  label: string;
  count: number;
}

export interface RequestSummary {
  successRate: number;
  slowRequests: number;
  errorRequests: number;
  averageDuration: number;
  averageTtftMs: number | null;
  totalTokens: number;
  totalCostUsd: number;
  cacheHitRate: number | null;
  topEndpoints: RequestSummaryBucket[];
  topNarrators: RequestSummaryBucket[];
}
