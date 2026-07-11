import { capabilityFor } from "./tool-cancellation-policy.js";

const CONFIRMED_READ_ONLY_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  "GetGoals", "LearningGuide", "Recall",
  "jingwei.read", "chapter.read", "cockpit.snapshot",
  "chapter.list", "chapter.audit", "presets.read", "beat.read",
  "outline.suggest_next", "character.check_consistency",
  "presets.check_compliance",
]);

const PARALLEL_HOOK_ACTIONS = new Set(["list", "check_due"]);

/**
 * Returns true only for calls confirmed both read-only and cooperatively
 * cancellable by the current runtime. Unknown tools/actions fail closed.
 */
export function canRunToolInParallel(
  name: string,
  input: Record<string, unknown>,
): boolean {
  if (capabilityFor(name, input) !== "cooperative") return false;

  if (name === "hooks.manage") {
    const action = input.action;
    return typeof action === "string" && PARALLEL_HOOK_ACTIONS.has(action.toLowerCase());
  }

  return CONFIRMED_READ_ONLY_TOOLS.has(name);
}
