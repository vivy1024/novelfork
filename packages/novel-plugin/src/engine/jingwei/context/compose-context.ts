import type { JingweiLegacyContextItem, JingweiMode, BuildJingweiLegacyContextResult } from "../types.js";
import {
  applyTokenBudget,
  estimateTokens,
  sortByContextPriority,
  type BudgetedJingweiContextItem,
  type DroppedEntryPointer,
} from "./token-budget.js";

export interface ComposeJingweiContextOptions {
  tokenBudget?: number;
  mode: JingweiMode;
}

export interface ComposableJingweiContextItem extends BudgetedJingweiContextItem {
  rawContent?: string;
}

export interface ComposedJingweiContextResult extends BuildJingweiLegacyContextResult {
  droppedPointers: DroppedEntryPointer[];
  /** 当存在被裁剪条目时生成的极简折叠索引块；预算充足时为 undefined。 */
  droppedIndexBlock?: string;
}

export const DROPPED_POINTER_INDEX_ITEM_ID = "__jingwei_dropped_index__";
export const DROPPED_POINTER_INDEX_HEADER = "## 已按预算折叠的经纬索引（按需用 jingwei.read 拉回）";
export const MAX_DROPPED_INDEX_BLOCK_CHARS = 600;
export const MAX_DROPPED_INDEX_BLOCK_TOKENS = 200;

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

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  return `${chars.slice(0, maxChars - 1).join("").trimEnd()}…`;
}

function formatPointerLine(pointer: DroppedEntryPointer, maxSnippetChars?: number): string {
  const prefix = `- [${pointer.category}] ${pointer.title} (id: ${pointer.id})`;
  if (!pointer.snippet) return prefix;
  const snippet = maxSnippetChars !== undefined
    ? truncateChars(pointer.snippet, maxSnippetChars)
    : pointer.snippet;
  return snippet ? `${prefix}：${snippet}` : prefix;
}

/**
 * 将被裁剪条目指针渲染为严格控长的折叠索引区块（≤ 600 chars 且 ≤ 200 tokens）。
 * 优先保证每条保留 id / 分类 / 标题，超出字符或 token 上限时自动收紧摘要或追加省略提示行。
 */
export function formatDroppedPointersIndex(
  droppedPointers: readonly DroppedEntryPointer[],
  totalDroppedCount = droppedPointers.length,
): string | undefined {
  if (droppedPointers.length === 0) return undefined;

  const lines: string[] = [DROPPED_POINTER_INDEX_HEADER];
  let includedCount = 0;

  const fits = (candidateLines: readonly string[]): boolean => {
    const text = candidateLines.join("\n");
    return Array.from(text).length <= MAX_DROPPED_INDEX_BLOCK_CHARS
      && estimateTokens(text) <= MAX_DROPPED_INDEX_BLOCK_TOKENS;
  };

  for (const pointer of droppedPointers) {
    const remainingAfterThis = Math.max(0, totalDroppedCount - (includedCount + 1));
    const tailLine = remainingAfterThis > 0
      ? `- …其余 ${remainingAfterThis} 条已省略，可用 jingwei.read 按分类或检索拉回`
      : null;

    const candidates = [
      formatPointerLine(pointer),
      formatPointerLine(pointer, 16),
      `- [${pointer.category}] ${pointer.title} (id: ${pointer.id})`,
    ];

    let chosen: string | null = null;
    for (const candidate of candidates) {
      const probe = tailLine ? [...lines, candidate, tailLine] : [...lines, candidate];
      if (fits(probe)) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) break;

    lines.push(chosen);
    includedCount += 1;
  }

  const omittedCount = Math.max(0, totalDroppedCount - includedCount);
  if (omittedCount > 0) {
    const tailLine = `- …其余 ${omittedCount} 条已省略，可用 jingwei.read 按分类或检索拉回`;
    if (fits([...lines, tailLine])) {
      lines.push(tailLine);
    }
  }

  // 若连第一条都装不下（极端超长标题/ID），退化为一条硬截断的指针行保证索引有效且严格控长。
  if (includedCount === 0 && droppedPointers[0]) {
    const fallbackBudget = Math.max(24, MAX_DROPPED_INDEX_BLOCK_CHARS - Array.from(DROPPED_POINTER_INDEX_HEADER).length - 1);
    const fallbackLine = truncateChars(
      `- [${droppedPointers[0].category}] ${droppedPointers[0].title} (id: ${droppedPointers[0].id})`,
      fallbackBudget,
    );
    lines.push(fallbackLine);
  }

  return lines.join("\n");
}

export function composeJingweiContext(
  items: readonly ComposableJingweiContextItem[],
  options: ComposeJingweiContextOptions,
): ComposedJingweiContextResult {
  const formatted = sortByContextPriority(items).map(formatJingweiContextItem);
  // T4.7 口径：默认与叙事记忆全局预算同尺（等容于旧英文尺 8000）
  const budgeted = applyTokenBudget(formatted, options.tokenBudget ?? 24000);
  const droppedIndexBlock = formatDroppedPointersIndex(
    budgeted.droppedPointers,
    budgeted.droppedIds.length,
  );

  if (!droppedIndexBlock) {
    return {
      items: budgeted.items,
      totalTokens: budgeted.totalTokens,
      droppedIds: budgeted.droppedIds,
      droppedPointers: budgeted.droppedPointers,
      mode: options.mode,
    };
  }

  const indexItem: JingweiLegacyContextItem = {
    id: DROPPED_POINTER_INDEX_ITEM_ID,
    type: "setting",
    category: "dropped-index",
    name: "已按预算折叠的经纬索引",
    content: droppedIndexBlock,
    priority: 0,
    source: "tracked",
    estimatedTokens: estimateTokens(droppedIndexBlock),
  };

  return {
    items: [...budgeted.items, indexItem],
    totalTokens: budgeted.totalTokens,
    droppedIds: budgeted.droppedIds,
    droppedPointers: budgeted.droppedPointers,
    droppedIndexBlock,
    mode: options.mode,
  };
}

