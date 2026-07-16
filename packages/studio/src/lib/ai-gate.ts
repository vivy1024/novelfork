/**
 * Compatibility export for Studio UI and legacy API callers. Model gating is a
 * product-neutral core policy consumed by both Studio and novel-plugin.
 */
export {
  requireModelForAiAction,
  type AiAction,
  type AiGateResult,
  type ProviderRuntimeStatus,
} from "@vivy1024/novelfork-core";
