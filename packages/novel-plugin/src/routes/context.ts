import type { StateManager } from "@vivy1024/novelfork-core";
import type { Context } from "hono";
import type { PipelineConfig } from "../engine/index.js";

/** Runtime-facing model availability needed by novel-domain HTTP adapters. */
export interface RuntimeModelStatus {
  readonly hasUsableModel: boolean;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly lastConnectionError?: string;
}

/** Runtime-owned thresholds used by the legacy context-management projection. */
export interface ContextGovernance {
  readonly compressionThresholdPercent: number;
  readonly truncateTargetPercent: number;
  readonly compressionThresholdSource?: string;
  readonly truncateTargetSource?: string;
}

/** Product-neutral metadata emitted when a legacy novel HTTP route invokes AI. */
export interface AiObservationScope {
  readonly endpoint: string;
  readonly requestKind: string;
  readonly narrator: string;
  readonly provider?: string;
  readonly model?: string;
  readonly method?: string;
  readonly bookId?: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly chapterNumber?: number;
}

export interface AiObservationSuccess {
  readonly content?: string;
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
  };
  readonly ttftMs?: number;
}

/**
 * Host-owned AI auditing. Runtime can map this to its narrator audit trail;
 * the retiring Studio server maps it to its legacy request observer.
 */
export interface AiRequestObserver {
  readonly logSuccess: (
    logger: PipelineConfig["logger"],
    scope: AiObservationScope,
    startedAt: number,
    success?: AiObservationSuccess,
  ) => void;
  readonly logError: (
    logger: PipelineConfig["logger"],
    scope: AiObservationScope,
    startedAt: number,
    error: unknown,
  ) => void;
}

export interface SessionLlmOverrides {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model?: string;
  readonly provider?: string;
}

/**
 * Minimal host contract for the remaining novel HTTP adapters.
 *
 * This deliberately owns only novel-route dependencies. Runtime and the legacy
 * Studio server can each adapt their own services to this interface without
 * making novel-plugin import a Studio server type.
 */
export interface RouterContext {
  readonly state: StateManager;
  readonly root: string;
  readonly broadcast: (event: string, data: unknown) => void;
  readonly buildPipelineConfig: (
    overrides?: Partial<Pick<PipelineConfig, "externalContext">> & Partial<SessionLlmOverrides>,
  ) => Promise<PipelineConfig>;
  readonly getSessionLlm: (c: Context) => Promise<SessionLlmOverrides | undefined>;
  readonly getRuntimeModelStatus?: () => Promise<RuntimeModelStatus>;
  readonly getContextGovernance?: () => Promise<ContextGovernance>;
  readonly aiRequestObserver?: AiRequestObserver;
}
