import type { BuildJingweiLegacyContextResult } from "../types.js";

export function formatJingweiContextForPrompt(context: BuildJingweiLegacyContextResult): string {
  if (context.items.length === 0) return "";

  return [
    "# Novel Bible Context",
    "",
    `mode: ${context.mode}`,
    `totalTokens: ${context.totalTokens}`,
    `droppedIds: ${context.droppedIds.length ? context.droppedIds.join(", ") : "none"}`,
    "",
    ...context.items.map((item) => item.content),
  ].join("\n");
}

export function mergeJingweiContextWithExternalContext(
  context: BuildJingweiLegacyContextResult,
  externalContext?: string,
): string | undefined {
  const jingweiContext = formatJingweiContextForPrompt(context).trim();
  const userContext = externalContext?.trim() ?? "";

  if (!jingweiContext) return userContext || undefined;
  if (!userContext) return jingweiContext;
  return `${jingweiContext}\n\n---\n\n${userContext}`;
}

// --- Deprecated aliases ---
/** @deprecated Use formatJingweiContextForPrompt instead */
export const formatBibleContextForPrompt = formatJingweiContextForPrompt;
/** @deprecated Use mergeJingweiContextWithExternalContext instead */
export const mergeBibleContextWithExternalContext = mergeJingweiContextWithExternalContext;
