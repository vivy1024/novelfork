import type { BuildBibleContextResult } from "../types.js";

export function formatBibleContextForPrompt(context: BuildBibleContextResult): string {
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

export function mergeBibleContextWithExternalContext(
  context: BuildBibleContextResult,
  externalContext?: string,
): string | undefined {
  const bibleContext = formatBibleContextForPrompt(context).trim();
  const userContext = externalContext?.trim() ?? "";

  if (!bibleContext) return userContext || undefined;
  if (!userContext) return bibleContext;
  return `${bibleContext}\n\n---\n\n${userContext}`;
}
