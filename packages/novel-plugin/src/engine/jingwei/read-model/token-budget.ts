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

// ---------------------------------------------------------------------------
// Recall with Budget — 逐条降级（参考 LegnaCode）
//
// 超预算时，先把低优先条目从 full→normal→summary→brief 逐级降级（重算 token），
// 仍超才丢弃。比"整条丢弃"保留更多信息。
// ---------------------------------------------------------------------------

export type JingweiBudgetDetailLevel = "brief" | "summary" | "normal" | "full";

/** 详细度从富到简的顺序 */
const LEVEL_ORDER: JingweiBudgetDetailLevel[] = ["full", "normal", "summary", "brief"];

export interface DegradableLevel {
  readonly detailLevel: JingweiBudgetDetailLevel;
  readonly estimatedTokens: number;
}

export interface DegradableItem {
  readonly id: string;
  readonly priority: number;
  /** 各档 token 估算（顺序不限，内部按 LEVEL_ORDER 规整） */
  readonly levels: readonly DegradableLevel[];
  /** 初始档：不会被升级到比它更富的档 */
  readonly initialLevel: JingweiBudgetDetailLevel;
}

export interface DegradedItem {
  readonly id: string;
  readonly detailLevel: JingweiBudgetDetailLevel;
  readonly estimatedTokens: number;
  readonly priority: number;
}

export interface DegradationResult {
  readonly items: DegradedItem[];
  readonly estimatedTokens: number;
  readonly droppedEntryIds: string[];
}

function levelIndex(level: JingweiBudgetDetailLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

function tokensAt(item: DegradableItem, level: JingweiBudgetDetailLevel): number {
  const found = item.levels.find((l) => l.detailLevel === level);
  if (found) return found.estimatedTokens;
  // 缺档时回退到最近的更富档估算
  const idx = levelIndex(level);
  for (let i = idx; i >= 0; i--) {
    const f = item.levels.find((l) => l.detailLevel === LEVEL_ORDER[i]);
    if (f) return f.estimatedTokens;
  }
  return 0;
}

/**
 * 逐条降级预算分配。
 * 1. 每条从 initialLevel 起算总和；放得下直接返回。
 * 2. 超预算：按优先级从低到高，把可降级的条目降一档，重算，直到放得下或无法再降。
 * 3. 全降到最简仍超：按优先级从低到高丢弃。
 */
export function applyTokenBudgetWithDegradation(
  items: readonly DegradableItem[],
  tokenBudget: number,
): DegradationResult {
  if (tokenBudget < 0) {
    return { items: [], estimatedTokens: 0, droppedEntryIds: items.map((i) => i.id) };
  }

  // 当前每条的档位（不低于 initialLevel 的富度，即不升级）
  const state = new Map<string, JingweiBudgetDetailLevel>();
  for (const item of items) state.set(item.id, item.initialLevel);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const alive = new Set(items.map((i) => i.id));

  const currentTotal = (): number => {
    let sum = 0;
    for (const id of alive) {
      const item = itemById.get(id)!;
      sum += tokensAt(item, state.get(id)!);
    }
    return sum;
  };

  // 优先级从低到高（先动最低优先的）
  const byLowPriority = [...items].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  // 阶段 1：逐条降级
  let guard = 0;
  while (currentTotal() > tokenBudget && guard < items.length * LEVEL_ORDER.length + 1) {
    guard++;
    let degradedSomething = false;
    for (const item of byLowPriority) {
      if (!alive.has(item.id)) continue;
      const cur = state.get(item.id)!;
      const curIdx = levelIndex(cur);
      if (curIdx < LEVEL_ORDER.length - 1) {
        // 还能降一档
        state.set(item.id, LEVEL_ORDER[curIdx + 1]!);
        degradedSomething = true;
        break; // 重算后再决定下一步
      }
    }
    if (!degradedSomething) break; // 没有可再降级的条目
  }

  // 阶段 2：全降到最简仍超 → 丢弃最低优先
  const droppedEntryIds: string[] = [];
  for (const item of byLowPriority) {
    if (currentTotal() <= tokenBudget) break;
    if (!alive.has(item.id)) continue;
    alive.delete(item.id);
    droppedEntryIds.push(item.id);
  }

  // 输出：保持原始顺序（按优先级从高到低，与 applyTokenBudget 一致）
  const ordered = [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const result: DegradedItem[] = [];
  for (const item of ordered) {
    if (!alive.has(item.id)) continue;
    const level = state.get(item.id)!;
    result.push({ id: item.id, detailLevel: level, estimatedTokens: tokensAt(item, level), priority: item.priority });
  }

  return {
    items: result,
    estimatedTokens: result.reduce((s, r) => s + r.estimatedTokens, 0),
    droppedEntryIds,
  };
}
