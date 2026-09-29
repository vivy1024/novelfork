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

/** Tool-free text generation request; same shape as the narrator tools' generateText. */
export interface HostTextGenerationRequest {
  readonly messages: ReadonlyArray<{ readonly role: "system" | "user" | "assistant"; readonly content: string }>;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface HostTextGenerationResult {
  readonly text: string;
  /** Concrete provider:model that served the request, when the host reports it. */
  readonly model?: string;
  readonly outputTruncated?: boolean;
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
  };
}

export type HostTextGenerator = (request: HostTextGenerationRequest) => Promise<HostTextGenerationResult>;

/**
 * Whether the host can generate text for this authenticated request. The host
 * binds the generator to the request's user (model choice and usage accounting
 * stay in the host); routes never see provider credentials.
 */
export type HostTextGenerationAvailability =
  | {
    readonly available: true;
    /** provider:model the host will use, for display only. */
    readonly model?: string;
    readonly generateText: HostTextGenerator;
  }
  | {
    readonly available: false;
    /** MODEL_NOT_CONFIGURED / MODEL_PROVIDER_UNAVAILABLE / UNAUTHENTICATED / … */
    readonly code: string;
    /** 发生了什么（面向作者的中文）。 */
    readonly message: string;
    /** 建议怎么做（面向作者的中文）。 */
    readonly suggestedAction: string;
  };

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
  /**
   * Host-owned server-side text generation for this request (writing modes,
   * web style distillation, character voice enrichment). Absent means the host
   * offers none; routes then fall back to prompt previews / rule drafts.
   */
  readonly resolveTextGeneration?: (c: Context) => Promise<HostTextGenerationAvailability>;
  readonly getRuntimeModelStatus?: () => Promise<RuntimeModelStatus>;
  readonly getContextGovernance?: () => Promise<ContextGovernance>;
  readonly aiRequestObserver?: AiRequestObserver;
}
