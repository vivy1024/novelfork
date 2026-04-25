import type { BibleContextItem, BibleMode, BuildBibleContextResult } from "../types.js";
import { applyTokenBudget, sortByContextPriority, type BudgetedBibleContextItem } from "./token-budget.js";

export interface ComposeBibleContextOptions {
  tokenBudget?: number;
  mode: BibleMode;
}

export interface ComposableBibleContextItem extends BudgetedBibleContextItem {
  rawContent?: string;
}

const typeLabels: Record<BibleContextItem["type"], string> = {
  character: "角色",
  event: "事件",
  setting: "设定",
  "chapter-summary": "章节摘要",
};

function formatTypeLabel(item: BibleContextItem): string {
  const label = typeLabels[item.type];
  return item.type === "setting" && item.category ? `${label}-${item.category}` : label;
}

export function formatBibleContextItem<TItem extends ComposableBibleContextItem>(item: TItem): TItem {
  const body = item.rawContent ?? item.content;
  return {
    ...item,
    content: `【${formatTypeLabel(item)}】${item.name}：${body}`,
  };
}

export function composeBibleContext(
  items: readonly ComposableBibleContextItem[],
  options: ComposeBibleContextOptions,
): BuildBibleContextResult {
  const formatted = sortByContextPriority(items).map(formatBibleContextItem);
  const budgeted = applyTokenBudget(formatted, options.tokenBudget ?? 8000);

  return {
    items: budgeted.items,
    totalTokens: budgeted.totalTokens,
    droppedIds: budgeted.droppedIds,
    mode: options.mode,
  };
}
