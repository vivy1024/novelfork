/**
 * Relay-layer type definitions.
 *
 * These types decouple the AI execution interface from concrete
 * PipelineRunner / LLM-client internals, enabling remote relay
 * implementations in the future.
 */

// ---------------------------------------------------------------------------
// LLM configuration carried per-call
// ---------------------------------------------------------------------------

export interface LLMRelayConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly provider?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stream?: boolean;
  readonly modelOverrides?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunHandle {
  readonly runId: string;
}

export interface RunState {
  readonly runId: string;
  readonly status: RunStatus;
  readonly stage?: string;
  readonly progress?: number;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Run events (SSE / polling)
// ---------------------------------------------------------------------------

export type RunEventType =
  | "status"
  | "progress"
  | "log"
  | "result"
  | "error";

export interface RunEvent {
  readonly eventId: string;
  readonly seq: number;
  readonly event: RunEventType;
  readonly data: unknown;
}
