import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { LogEntry, LogSink } from "@vivy1024/novelfork-core";

import { getModel } from "../../shared/provider-catalog.js";
import { logRequest, type RequestLog, type RequestTokenUsage } from "./request-observability.js";

interface AiRuntimeLogContext {
  eventType?: string;
  provider?: string;
  model?: string;
  endpoint?: string;
  method?: string;
  requestKind?: string;
  narrator?: string;
  requestDomain?: "ai" | "admin" | "system";
  bookId?: string;
  sessionId?: string;
  runId?: string;
  chapterNumber?: number;
  durationMs?: number;
  ttftMs?: number;
  status?: string;
  errorSummary?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokensEstimated?: boolean;
  tokenSource?: "actual" | "estimated";
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

function estimateCostUsd(provider: string | undefined, model: string | undefined, tokens?: RequestTokenUsage): number | undefined {
  if (!provider || !model || !tokens) {
    return undefined;
  }

  const catalogModel = getModel(provider, model);
  if (!catalogModel || (catalogModel.inputPrice === undefined && catalogModel.outputPrice === undefined)) {
    return undefined;
  }

  const inputTokens = tokens.input ?? 0;
  const outputTokens = tokens.output ?? 0;
  const totalTokens = tokens.total ?? 0;
  const normalizedInput = inputTokens > 0 ? inputTokens : totalTokens > 0 && outputTokens === 0 ? totalTokens : 0;
  const normalizedOutput = outputTokens > 0 ? outputTokens : totalTokens > 0 && inputTokens === 0 ? totalTokens : 0;
  const inputCost = ((catalogModel.inputPrice ?? 0) / 1_000_000) * normalizedInput;
  const outputCost = ((catalogModel.outputPrice ?? 0) / 1_000_000) * normalizedOutput;
  const totalCost = inputCost + outputCost;
  return totalCost > 0 ? roundUsd(totalCost) : undefined;
}

function extractAiRequestLog(entry: LogEntry): RequestLog | null {
  const ctx = (entry.ctx ?? {}) as AiRuntimeLogContext;
  if (ctx.eventType !== "ai.request") {
    return null;
  }

  const tokens: RequestTokenUsage | undefined =
    typeof ctx.promptTokens === "number" || typeof ctx.completionTokens === "number" || typeof ctx.totalTokens === "number"
      ? {
          input: typeof ctx.promptTokens === "number" ? ctx.promptTokens : undefined,
          output: typeof ctx.completionTokens === "number" ? ctx.completionTokens : undefined,
          total: typeof ctx.totalTokens === "number" ? ctx.totalTokens : undefined,
          estimated: ctx.tokensEstimated,
          source: ctx.tokenSource,
        }
      : undefined;

  return {
    id: `${entry.timestamp}:${ctx.endpoint ?? entry.tag}:${ctx.runId ?? ctx.bookId ?? "no-scope"}`,
    timestamp: entry.timestamp,
    method: ctx.method ?? "AI",
    endpoint: ctx.endpoint ?? entry.tag,
    status: ctx.status === "error" ? 500 : 200,
    duration: Math.max(1, Math.round(ctx.durationMs ?? 0)),
    userId: "system",
    requestKind: ctx.requestKind ?? "ai-request",
    narrator: ctx.narrator ?? entry.tag,
    provider: ctx.provider,
    model: ctx.model,
    tokens,
    ttftMs: typeof ctx.ttftMs === "number" ? ctx.ttftMs : undefined,
    costUsd: estimateCostUsd(ctx.provider, ctx.model, tokens),
    details: entry.message,
    runId: ctx.runId,
    requestDomain: ctx.requestDomain ?? "ai",
    source: "runtime-log",
    aiStatus: ctx.status === "success" || ctx.status === "error" || ctx.status === "partial" ? ctx.status : "unknown",
    errorSummary: ctx.errorSummary,
    bookId: ctx.bookId,
    sessionId: ctx.sessionId,
    chapterNumber: typeof ctx.chapterNumber === "number" ? ctx.chapterNumber : undefined,
  } satisfies RequestLog;
}

export function createRuntimeJsonLineSink(logPath: string): LogSink {
  return {
    write(entry: LogEntry): void {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
      const requestLog = extractAiRequestLog(entry);
      if (requestLog) {
        logRequest(requestLog);
      }
    },
  };
}
