import type { NarrativeContextCard, NarrativeChannelStatus } from "./types.js";

export interface ChannelRunResult {
  readonly status?: Extract<NarrativeChannelStatus, "ok" | "skipped">;
  readonly cards: readonly NarrativeContextCard[];
  readonly warnings?: readonly string[];
  readonly error?: string;
  readonly diagnostics?: Readonly<Record<string, unknown>>;
}

class ChannelTimeoutError extends Error {
  constructor(channel: string, timeoutMs: number) {
    super(`Channel ${channel} timed out after ${timeoutMs}ms.`);
    this.name = "ChannelTimeoutError";
  }
}

export interface NarrativeRetrievalChannel<TInput = unknown> {
  readonly name: string;
  run(input: TInput): Promise<ChannelRunResult> | ChannelRunResult;
}

export interface ChannelResult {
  readonly channel: string;
  readonly status: NarrativeChannelStatus;
  readonly cards: readonly NarrativeContextCard[];
  readonly latencyMs: number;
  readonly candidateCount: number;
  readonly returnedCount: number;
  readonly estimatedTokens: number;
  readonly warnings: readonly string[];
  readonly error?: string;
  readonly diagnostics?: Readonly<Record<string, unknown>>;
}

export interface RunChannelWithTimeoutOptions {
  readonly timeoutMs?: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function createTimeout(channel: string, timeoutMs: number): { readonly promise: Promise<never>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ChannelTimeoutError(channel, timeoutMs)), timeoutMs);
  });
  return {
    promise,
    clear() {
      if (timer) clearTimeout(timer);
    },
  };
}

export async function runChannelWithTimeout<TInput>(
  channel: NarrativeRetrievalChannel<TInput>,
  input: TInput,
  options: RunChannelWithTimeoutOptions = {},
): Promise<ChannelResult> {
  const timeoutMs = options.timeoutMs ?? 2500;
  const startedAt = performance.now();
  const timeout = createTimeout(channel.name, timeoutMs);
  try {
    const result = await Promise.race([
      Promise.resolve(channel.run(input)),
      timeout.promise,
    ]);
    timeout.clear();
    const cards = result.cards ?? [];
    return {
      channel: channel.name,
      status: result.status ?? "ok",
      cards,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      candidateCount: cards.length,
      returnedCount: cards.length,
      estimatedTokens: cards.reduce((sum, card) => sum + card.estimatedTokens, 0),
      warnings: result.warnings ?? [],
      error: result.error,
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    timeout.clear();
    const message = errorMessage(error);
    const status: NarrativeChannelStatus = error instanceof ChannelTimeoutError ? "timeout" : "error";
    return {
      channel: channel.name,
      status,
      cards: [],
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      candidateCount: 0,
      returnedCount: 0,
      estimatedTokens: 0,
      warnings: [],
      error: message,
    };
  }
}
