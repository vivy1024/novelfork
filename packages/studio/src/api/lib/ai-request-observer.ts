import type { Logger } from "@vivy1024/novelfork-core";

import { getModel } from "../../shared/provider-catalog.js";
import type { RequestTokenUsage } from "./request-observability.js";

export interface AiObservationScope {
  endpoint: string;
  requestKind: string;
  narrator: string;
  provider?: string;
  model?: string;
  method?: string;
  bookId?: string;
  sessionId?: string;
  runId?: string;
  chapterNumber?: number;
}

export interface AiObservationSuccess {
  content?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  ttftMs?: number;
}

export function summarizeError(error: unknown, maxLength = 160): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}

export function estimateTokensFromText(text: string): number {
  const normalized = text.replace(/\s+/g, "").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 2));
}

export function estimateTokensFromMessages(messages: ReadonlyArray<{ content: string }>): number {
  return messages.reduce((sum, message) => sum + estimateTokensFromText(message.content), 0);
}

function buildTokens(success?: AiObservationSuccess): RequestTokenUsage | undefined {
  const input = success?.usage?.promptTokens;
  const output = success?.usage?.completionTokens;
  const total = success?.usage?.totalTokens;
  const hasActual = typeof input === "number" || typeof output === "number" || typeof total === "number";
  if (hasActual) {
    return {
      input,
      output,
      total: total ?? ((input ?? 0) + (output ?? 0) || undefined),
      estimated: false,
      source: "actual",
    };
  }

  const estimatedOutput = success?.content ? estimateTokensFromText(success.content) : 0;
  if (!estimatedOutput) return undefined;

  return {
    output: estimatedOutput,
    total: estimatedOutput,
    estimated: true,
    source: "estimated",
  };
}

export function estimateCostUsd(provider: string | undefined, model: string | undefined, tokens?: RequestTokenUsage): number | undefined {
  if (!provider || !model || !tokens) return undefined;
  const catalogModel = getModel(provider, model);
  if (!catalogModel || (catalogModel.inputPrice === undefined && catalogModel.outputPrice === undefined)) {
    return undefined;
  }
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const inputCost = ((catalogModel.inputPrice ?? 0) / 1_000_000) * input;
  const outputCost = ((catalogModel.outputPrice ?? 0) / 1_000_000) * output;
  const totalCost = inputCost + outputCost;
  return totalCost > 0 ? Number(totalCost.toFixed(6)) : undefined;
}

export function logObservedAiSuccess(logger: Logger | undefined, scope: AiObservationScope, startedAt: number, success?: AiObservationSuccess): void {
  if (!logger) return;
  const tokens = buildTokens(success);
  logger.info(`AI request completed (${scope.requestKind})`, {
    eventType: "ai.request",
    requestDomain: "ai",
    endpoint: scope.endpoint,
    method: scope.method ?? "POST",
    requestKind: scope.requestKind,
    narrator: scope.narrator,
    provider: scope.provider,
    model: scope.model,
    bookId: scope.bookId,
    sessionId: scope.sessionId,
    runId: scope.runId,
    chapterNumber: scope.chapterNumber,
    durationMs: Date.now() - startedAt,
    ...(typeof success?.ttftMs === "number" ? { ttftMs: success.ttftMs } : {}),
    status: "success",
    ...(tokens?.input !== undefined ? { promptTokens: tokens.input } : {}),
    ...(tokens?.output !== undefined ? { completionTokens: tokens.output } : {}),
    ...(tokens?.total !== undefined ? { totalTokens: tokens.total } : {}),
    ...(tokens?.estimated !== undefined ? { tokensEstimated: tokens.estimated } : {}),
    ...(tokens?.source ? { tokenSource: tokens.source } : {}),
    ...(estimateCostUsd(scope.provider, scope.model, tokens) !== undefined ? { costUsd: estimateCostUsd(scope.provider, scope.model, tokens) } : {}),
  });
}

export function logObservedAiError(logger: Logger | undefined, scope: AiObservationScope, startedAt: number, error: unknown): void {
  if (!logger) return;
  logger.error(`AI request failed (${scope.requestKind})`, {
    eventType: "ai.request",
    requestDomain: "ai",
    endpoint: scope.endpoint,
    method: scope.method ?? "POST",
    requestKind: scope.requestKind,
    narrator: scope.narrator,
    provider: scope.provider,
    model: scope.model,
    bookId: scope.bookId,
    sessionId: scope.sessionId,
    runId: scope.runId,
    chapterNumber: scope.chapterNumber,
    durationMs: Date.now() - startedAt,
    status: "error",
    errorSummary: summarizeError(error),
  });
}
