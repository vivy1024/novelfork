/**
 * Shared router context — injected from server.ts into each route module.
 * Keeps route files decoupled from global singletons.
 */

import type { StateManager, PipelineConfig } from "@vivy1024/novelfork-core";
import type { RunStore } from "../lib/run-store.js";
import type { ProviderRuntimeStore } from "../lib/provider-runtime-store.js";
import type { StartupOrchestratorSummary } from "../lib/startup-orchestrator.js";
import type { Context } from "hono";

export interface RouterContext {
  /** StateManager instance (book/chapter/truth CRUD) */
  readonly state: StateManager;

  /** Project root directory */
  readonly root: string;

  /** Legacy SSE broadcast — will be replaced by RunStore events in Phase 2 */
  readonly broadcast: (event: string, data: unknown) => void;

  /** Build PipelineConfig with optional session LLM overrides */
  readonly buildPipelineConfig: (
    overrides?: Partial<Pick<PipelineConfig, "externalContext">> & {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      provider?: string;
    },
  ) => Promise<PipelineConfig>;

  /** Extract LLM credentials from session cookie */
  readonly getSessionLlm: (
    c: Context,
  ) => Promise<
    | { apiKey: string; baseUrl: string; model?: string; provider?: string }
    | undefined
  >;

  /** Per-run event store */
  readonly runStore: RunStore;

  /** Shared provider runtime store used by model gates and provider routes */
  readonly providerStore?: ProviderRuntimeStore;

  /** Startup recovery / delivery summary exposed to admin surfaces */
  readonly getStartupSummary: () => StartupOrchestratorSummary | null;
  readonly setStartupSummary: (summary: StartupOrchestratorSummary) => void;
  readonly setStartupRecoveryRunner: (runner: (() => Promise<StartupOrchestratorSummary>) | null) => void;
}
