// Relay — AI execution interface + local implementation
export type {
  LLMRelayConfig,
  RunStatus,
  RunHandle,
  RunState,
  RunEventType,
  RunEvent,
} from "./types.js";

export type {
  AIRelay,
  WriteSnapshot,
  RunResult,
} from "./relay.js";

// LocalAIRelay was removed with PipelineRunner; callers must use Runtime-backed routes.
