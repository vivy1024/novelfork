/**
 * PipelineConfig — runtime configuration for AI pipeline operations.
 * Previously defined in runner.ts, extracted here after PipelineRunner removal.
 */

import type { LLMClient, LLMConfig, Logger } from "@vivy1024/novelfork-core";

export interface StreamProgress {
  readonly status: "streaming" | "complete";
  readonly elapsedMs: number;
  readonly totalChars: number;
  readonly chineseChars: number;
}

export interface PipelineConfig {
  /** LLM client instance */
  readonly client: LLMClient;
  /** Model identifier */
  readonly model: string;
  /** Project root directory */
  readonly projectRoot: string;
  /** Full LLM config for creating additional clients */
  readonly defaultLLMConfig?: LLMConfig;
  /** Per-agent model overrides (string model ID or full override config) */
  readonly modelOverrides?: Record<string, unknown>;
  /** Notification channels */
  readonly notifyChannels?: unknown;
  /** Logger instance */
  readonly logger?: Logger;
  /** Stream progress callback */
  readonly onStreamProgress?: (progress: StreamProgress) => void;
  /** External context / brief injected by user */
  readonly externalContext?: string;
}
