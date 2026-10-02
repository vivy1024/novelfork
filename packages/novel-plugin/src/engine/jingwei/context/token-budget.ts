/**
 * Lightweight local token estimate for jingwei/narrative-memory budgeting.
 * Keep this self-contained so unit tests that mock @vivy1024/novelfork-core
 * do not break re-export resolution. Matches core estimateTokenCount.
 *
 * 口径（T4.7 修正）：旧实现按英文 `len/4`，中文正文实际约 0.6–1 token/字，
 * 名义预算与真实占用差 3–4 倍。改为 CJK 感知：CJK 区字符按保守的 1 token/字
 * 计（表意文字、扩展 A、CJK 标点、全角、假名、韩文音节），其余沿用
 * ≈4 字符 1 token。预算数字上升约 3 倍是回到真实，书级默认上限已同步上调。
 */
function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x3000 && code <= 0x303f) || // CJK 标点
    (code >= 0xff00 && code <= 0xffef) || // 全角及半角形式
    (code >= 0x3040 && code <= 0x30ff) || // 平假名/片假名
    (code >= 0xac00 && code <= 0xd7af) // 韩文音节
  );
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (isCjkCodePoint(code)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}
import type { JingweiLegacyContextItem } from "../types.js";

export interface TokenBudgetResult<TItem extends JingweiLegacyContextItem = JingweiLegacyContextItem> {
  items: TItem[];
  totalTokens: number;
  droppedIds: string[];
}

export interface BudgetedJingweiContextItem extends JingweiLegacyContextItem {
  updatedAt?: Date;
}

const sourceRank: Record<JingweiLegacyContextItem["source"], number> = {
  global: 3,
  nested: 2,
  tracked: 1,
};

function phaseOrder(item: JingweiLegacyContextItem): number {
  if (item.source === "nested") return 40;
  if (item.type === "premise") return 100;
  if (item.type === "world-model") return 90;
  if (item.type === "character") return 80;
  if (item.type === "character-arc") return 75;
  if (item.type === "event" || item.type === "setting") return 60;
  if (item.type === "conflict") return 50;
  if (item.type === "chapter-summary") return 10;
  return sourceRank[item.source] * 10;
}

function updatedAtMs(item: BudgetedJingweiContextItem): number {
  return item.updatedAt?.getTime() ?? 0;
}

export function sortByContextPriority<TItem extends BudgetedJingweiContextItem>(items: readonly TItem[]): TItem[] {
  return [...items].sort((a, b) => (
    phaseOrder(b) - phaseOrder(a)
    || sourceRank[b.source] - sourceRank[a.source]
    || b.priority - a.priority
    || updatedAtMs(b) - updatedAtMs(a)
    || a.id.localeCompare(b.id)
  ));
}

function sortByDropPriority<TItem extends BudgetedJingweiContextItem>(items: readonly TItem[]): TItem[] {
  return [...items].sort((a, b) => (
    sourceRank[a.source] - sourceRank[b.source]
    || a.priority - b.priority
    || updatedAtMs(a) - updatedAtMs(b)
    || phaseOrder(a) - phaseOrder(b)
    || a.id.localeCompare(b.id)
  ));
}

export function applyTokenBudget<TItem extends BudgetedJingweiContextItem>(
  items: readonly TItem[],
  tokenBudget = 30000,
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
