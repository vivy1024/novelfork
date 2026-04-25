import type { BibleContextItem } from "../types.js";

export interface TokenBudgetResult<TItem extends BibleContextItem = BibleContextItem> {
  items: TItem[];
  totalTokens: number;
  droppedIds: string[];
}

export interface BudgetedBibleContextItem extends BibleContextItem {
  updatedAt?: Date;
}

const sourceRank: Record<BibleContextItem["source"], number> = {
  global: 3,
  nested: 2,
  tracked: 1,
};

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length * 0.6);
}

function updatedAtMs(item: BudgetedBibleContextItem): number {
  return item.updatedAt?.getTime() ?? 0;
}

export function sortByContextPriority<TItem extends BudgetedBibleContextItem>(items: readonly TItem[]): TItem[] {
  return [...items].sort((a, b) => (
    sourceRank[b.source] - sourceRank[a.source]
    || updatedAtMs(b) - updatedAtMs(a)
    || b.priority - a.priority
    || a.id.localeCompare(b.id)
  ));
}

function sortByDropPriority<TItem extends BudgetedBibleContextItem>(items: readonly TItem[]): TItem[] {
  return [...items].sort((a, b) => (
    sourceRank[a.source] - sourceRank[b.source]
    || updatedAtMs(a) - updatedAtMs(b)
    || a.priority - b.priority
    || a.id.localeCompare(b.id)
  ));
}

export function applyTokenBudget<TItem extends BudgetedBibleContextItem>(
  items: readonly TItem[],
  tokenBudget = 8000,
): TokenBudgetResult<TItem> {
  const kept = sortByContextPriority(items);
  let totalTokens = kept.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const droppedIds: string[] = [];

  for (const candidate of sortByDropPriority(kept)) {
    if (totalTokens <= tokenBudget) break;
    const index = kept.findIndex((item) => item.id === candidate.id);
    if (index === -1) continue;

    const [dropped] = kept.splice(index, 1);
    if (!dropped) continue;
    totalTokens -= dropped.estimatedTokens;
    droppedIds.push(dropped.id);
  }

  return {
    items: kept,
    totalTokens,
    droppedIds,
  };
}
