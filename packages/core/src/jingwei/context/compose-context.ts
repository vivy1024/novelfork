import type { JingweiLegacyContextItem, JingweiMode, BuildJingweiLegacyContextResult } from "../types.js";
import { applyTokenBudget, sortByContextPriority, type BudgetedJingweiContextItem } from "./token-budget.js";

export interface ComposeJingweiContextOptions {
  tokenBudget?: number;
  mode: JingweiMode;
}

export interface ComposableJingweiContextItem extends BudgetedJingweiContextItem {
  rawContent?: string;
}

const typeLabels: Record<JingweiLegacyContextItem["type"], string> = {
  character: "角色",
  event: "事件",
  setting: "设定",
  "chapter-summary": "章节摘要",
  conflict: "矛盾",
  "world-model": "世界",
  premise: "基线",
  "character-arc": "弧线",
};

function formatTypeLabel(item: JingweiLegacyContextItem): string {
  const label = typeLabels[item.type];
  return item.type === "setting" && item.category ? `${label}-${item.category}` : label;
}

export function formatJingweiContextItem<TItem extends ComposableJingweiContextItem>(item: TItem): TItem {
  const body = item.rawContent ?? item.content;
  return {
    ...item,
    content: `【${formatTypeLabel(item)}】${item.name}：${body}`,
  };
}

export function composeJingweiContext(
  items: readonly ComposableJingweiContextItem[],
  options: ComposeJingweiContextOptions,
): BuildJingweiLegacyContextResult {
  const formatted = sortByContextPriority(items).map(formatJingweiContextItem);
  const budgeted = applyTokenBudget(formatted, options.tokenBudget ?? 8000);

  return {
    items: budgeted.items,
    totalTokens: budgeted.totalTokens,
    droppedIds: budgeted.droppedIds,
    mode: options.mode,
  };
}

// --- Deprecated aliases ---
/** @deprecated Use ComposableJingweiContextItem instead */
export type ComposableBibleContextItem = ComposableJingweiContextItem;
/** @deprecated Use ComposeJingweiContextOptions instead */
export type ComposeBibleContextOptions = ComposeJingweiContextOptions;
/** @deprecated Use formatJingweiContextItem instead */
export const formatBibleContextItem = formatJingweiContextItem;
/** @deprecated Use composeJingweiContext instead */
export const composeBibleContext = composeJingweiContext;
