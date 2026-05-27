export interface BudgetedItem<T> {
  readonly item: T;
  readonly estimatedTokens: number;
  readonly priority: number;
  readonly id: string;
}

export interface BudgetResult<T> {
  readonly items: T[];
  readonly estimatedTokens: number;
  readonly droppedEntryIds: string[];
}

export function applyTokenBudget<T extends { id: string; estimatedTokens: number; priority: number }>(
  items: readonly T[],
  tokenBudget: number,
): BudgetResult<T> {
  const kept = [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  let estimatedTokens = kept.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const droppedEntryIds: string[] = [];

  if (tokenBudget < 0) {
    return { items: [], estimatedTokens: 0, droppedEntryIds: kept.map((item) => item.id) };
  }

  if (estimatedTokens <= tokenBudget) {
    return { items: kept, estimatedTokens, droppedEntryIds };
  }

  const dropOrder = [...kept].sort((a, b) => a.priority - b.priority || b.estimatedTokens - a.estimatedTokens || a.id.localeCompare(b.id));
  for (const candidate of dropOrder) {
    if (estimatedTokens <= tokenBudget) break;
    const index = kept.findIndex((item) => item.id === candidate.id);
    if (index === -1) continue;
    const [removed] = kept.splice(index, 1);
    if (!removed) continue;
    estimatedTokens -= removed.estimatedTokens;
    droppedEntryIds.push(removed.id);
  }

  return { items: kept, estimatedTokens: Math.max(0, estimatedTokens), droppedEntryIds };
}

export function paginateItems<T>(items: readonly T[], page = 1, limit = 20): { items: T[]; page: number; limit: number; hasMore: boolean; nextPage?: number } {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
  const start = (normalizedPage - 1) * normalizedLimit;
  const paged = items.slice(start, start + normalizedLimit);
  const hasMore = start + normalizedLimit < items.length;
  return {
    items: paged,
    page: normalizedPage,
    limit: normalizedLimit,
    hasMore,
    nextPage: hasMore ? normalizedPage + 1 : undefined,
  };
}
