/**
 * Lightweight local token estimate for budgeting and display only.
 * Provider usage remains the authoritative token accounting source.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
