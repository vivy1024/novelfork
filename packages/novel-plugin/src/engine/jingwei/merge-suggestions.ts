/**
 * merge-suggestions.ts — 只读合并建议：识别同一本书中的重复/近似经纬条目，
 * 输出分组、评分、冲突字段与幸存者建议，不执行任何写入。
 *
 * 设计原则：
 * - 纯函数，无副作用，无 DB 依赖
 * - bookId 硬隔离
 * - 使用 normalizeCategory 统一分类
 * - 不与 entry-identity.ts（尚未创建）在命名上冲突；
 *   本模块只导出 merge 维度的接口，身份规范化留给 entry-identity
 */

import { normalizeCategory, type JingweiCategory } from "./unified-categories.js";

// ---------------------------------------------------------------------------
// 文本规范化工具
// ---------------------------------------------------------------------------

/** NFKC + 去空格 + 小写 + 去标点/括号 */
export function normalizeTitle(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\s\u3000]+/gu, "")
    .toLowerCase()
    .replace(/[（）()【】\[\]《》<>「」『』""''·、，。！？!?,.:;；：\-—…~～]+/gu, "");
}

/** 生成条目的 entryKey（与 dissection-staging.makeEntryKey 逻辑一致但不导入它） */
export function makeCanonicalKey(category: string, title: string): string {
  const normalized = title.trim().replace(/\s+/gu, "").toLowerCase();
  return `${category}:${normalized.slice(0, 48) || "untitled"}`;
}

// ---------------------------------------------------------------------------
// 输入/输出类型
// ---------------------------------------------------------------------------

/** 合并建议的输入条目（正式条目或候选条目均可适配为此结构） */
export interface MergeEntry {
  /** 条目 ID */
  readonly id: string;
  readonly bookId: string;
  /** 原始 category（可含旧值，内部会 normalize） */
  readonly category: string;
  readonly title: string;
  readonly aliases: readonly string[];
  /** 条目的结构化字段（关系条目含 sourceName/targetName/relationType 等） */
  readonly fields: Readonly<Record<string, unknown>>;
  /** 关联章节号 */
  readonly relatedChapterNumbers: readonly number[];
  /** 来源引用（如章节摘要） */
  readonly sourceRefs: readonly { readonly chapterNumber: number }[];
  /** entryKey（可选，如已有则直接比对） */
  readonly entryKey?: string;
  /** 是否为正式条目（vs 候选/staging） */
  readonly isCanonical: boolean;
}

/** 匹配命中的原因 */
export type MergeMatchReason =
  | "exact-entry-key"
  | "exact-title"
  | "title-alias-cross"
  | "normalized-title"
  | "chapter-summary-same-chapter"
  | "relationship-key-match"
  | "source-refs-overlap";

/** 两个条目之间的一条匹配信号 */
export interface MergeMatchSignal {
  readonly reason: MergeMatchReason;
  readonly score: number;
  /** 附加说明 */
  readonly detail?: string;
}

/** 某个字段的冲突报告 */
export interface MergeFieldConflict {
  readonly field: string;
  readonly values: readonly { readonly entryId: string; readonly value: unknown }[];
}

/** 一个合并分组 */
export interface MergeSuggestionGroup {
  /** 分组唯一键（用于幂等展示） */
  readonly groupKey: string;
  /** 合并总得分（越高越确信是重复） */
  readonly score: number;
  /** 匹配原因列表 */
  readonly reasons: readonly MergeMatchSignal[];
  /** 建议幸存者（优先正式条目、版本高、更新晚） */
  readonly survivor: string;
  /** 被识别为重复的条目 ID 列表 */
  readonly duplicates: readonly string[];
  /** 冲突字段（值不同，需要人工决策） */
  readonly conflicts: readonly MergeFieldConflict[];
  /** 是否需要作者手动选择（多候选人或有冲突字段） */
  readonly requiresAuthorChoice: boolean;
  /** 涉及的所有条目 */
  readonly entries: readonly MergeEntry[];
  /** 规范化后的 category */
  readonly category: JingweiCategory;
}

export interface MergeSuggestionResult {
  readonly bookId: string;
  readonly groups: readonly MergeSuggestionGroup[];
  /** 无匹配的条目 ID */
  readonly ungrouped: readonly string[];
}

// ---------------------------------------------------------------------------
// 核心逻辑
// ---------------------------------------------------------------------------

interface ScoredPair {
  a: MergeEntry;
  b: MergeEntry;
  signals: MergeMatchSignal[];
  total: number;
}

/** 将条目按 (bookId, normalizedCategory) 分桶 */
function bucketEntries(entries: readonly MergeEntry[]): Map<string, MergeEntry[]> {
  const buckets = new Map<string, MergeEntry[]>();
  for (const entry of entries) {
    const cat = normalizeCategory(entry.category).category;
    const key = `${entry.bookId}::${cat}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(entry);
  }
  return buckets;
}

/** 比较两条目的全部匹配信号 */
function computeSignals(a: MergeEntry, b: MergeEntry, normalizedCat: JingweiCategory): MergeMatchSignal[] {
  const signals: MergeMatchSignal[] = [];

  // 1. exact entryKey
  const keyA = a.entryKey ?? makeCanonicalKey(normalizedCat, a.title);
  const keyB = b.entryKey ?? makeCanonicalKey(normalizedCat, b.title);
  if (keyA === keyB) {
    signals.push({ reason: "exact-entry-key", score: 80 });
  }

  // 2. exact title
  if (a.title.trim() === b.title.trim() && a.title.trim().length > 0) {
    signals.push({ reason: "exact-title", score: 90 });
  }

  // 3. title ↔ alias 交叉命中
  const aTitles = new Set([a.title.trim(), ...a.aliases.map((al) => al.trim())].filter(Boolean));
  const bTitles = new Set([b.title.trim(), ...b.aliases.map((al) => al.trim())].filter(Boolean));
  let crossHit = false;
  for (const t of aTitles) {
    if (bTitles.has(t)) {
      crossHit = true;
      signals.push({ reason: "title-alias-cross", score: 70, detail: t });
      break;
    }
  }
  if (!crossHit) {
    for (const t of bTitles) {
      if (aTitles.has(t)) {
        signals.push({ reason: "title-alias-cross", score: 70, detail: t });
        break;
      }
    }
  }

  // 4. normalized title
  const normA = normalizeTitle(a.title);
  const normB = normalizeTitle(b.title);
  if (normA.length > 0 && normA === normB) {
    // 只有在没被更高信号覆盖时才给分（避免重复计分太多）
    if (!signals.some((s) => s.reason === "exact-title" || s.reason === "exact-entry-key")) {
      signals.push({ reason: "normalized-title", score: 60 });
    }
  }

  // 5. chapter-summaries 同 chapterNumber
  if (normalizedCat === "chapter-summaries") {
    const chaptersA = new Set([
      ...a.relatedChapterNumbers,
      ...(typeof a.fields.chapterNumber === "number" ? [a.fields.chapterNumber] : []),
    ]);
    const chaptersB = new Set([
      ...b.relatedChapterNumbers,
      ...(typeof b.fields.chapterNumber === "number" ? [b.fields.chapterNumber] : []),
    ]);
    for (const ch of chaptersA) {
      if (chaptersB.has(ch)) {
        signals.push({ reason: "chapter-summary-same-chapter", score: 85, detail: `ch${ch}` });
        break;
      }
    }
  }

  // 6. relationships: source/target/relationType 分层
  if (normalizedCat === "relationships") {
    const srcA = String(a.fields.sourceName ?? a.fields.source ?? "").trim();
    const tgtA = String(a.fields.targetName ?? a.fields.target ?? "").trim();
    const relA = String(a.fields.relationType ?? "").trim();
    const srcB = String(b.fields.sourceName ?? b.fields.source ?? "").trim();
    const tgtB = String(b.fields.targetName ?? b.fields.target ?? "").trim();
    const relB = String(b.fields.relationType ?? "").trim();

    if (srcA && tgtA && srcB && tgtB) {
      // 同方向匹配
      const sameDir = srcA === srcB && tgtA === tgtB;
      // 反向匹配
      const reverseDir = srcA === tgtB && tgtA === srcB;
      if (sameDir || reverseDir) {
        const base = 50;
        const relMatch = relA && relB && relA === relB;
        signals.push({
          reason: "relationship-key-match",
          score: relMatch ? base + 30 : base,
          detail: relMatch
            ? `${srcA}→${tgtA} (${relA})`
            : `${srcA}↔${tgtA}`,
        });
      }
    }
  }

  // 7. sourceRefs 重叠——只能加分，不能单独触发
  if (signals.length > 0) {
    const refsA = new Set(a.sourceRefs.map((r) => r.chapterNumber));
    const refsB = new Set(b.sourceRefs.map((r) => r.chapterNumber));
    let overlap = 0;
    for (const ch of refsA) {
      if (refsB.has(ch)) overlap++;
    }
    if (overlap > 0) {
      signals.push({ reason: "source-refs-overlap", score: Math.min(overlap * 5, 15), detail: `${overlap} shared refs` });
    }
  }

  return signals;
}

/** 选择幸存者：优先 isCanonical=true；相同则比谁 title 更短（更精炼） */
function pickSurvivor(entries: readonly MergeEntry[]): string {
  const sorted = [...entries].sort((a, b) => {
    // canonical first
    if (a.isCanonical !== b.isCanonical) return a.isCanonical ? -1 : 1;
    // shorter title = more canonical
    return a.title.length - b.title.length;
  });
  return sorted[0].id;
}

/** 提取冲突字段（值不同的字段） */
function extractConflicts(entries: readonly MergeEntry[]): MergeFieldConflict[] {
  // 比较 fields 中的所有键
  const allKeys = new Set<string>();
  for (const e of entries) {
    for (const k of Object.keys(e.fields)) {
      allKeys.add(k);
    }
  }

  const conflicts: MergeFieldConflict[] = [];
  for (const field of allKeys) {
    const values: { entryId: string; value: unknown }[] = [];
    for (const e of entries) {
      if (field in e.fields) {
        values.push({ entryId: e.id, value: e.fields[field] });
      }
    }
    if (values.length < 2) continue;
    // 是否全部相同
    const serialized = values.map((v) => JSON.stringify(v.value));
    if (new Set(serialized).size > 1) {
      conflicts.push({ field, values });
    }
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Union-Find for transitive grouping
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: Map<string, string> = new Map();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // path compression
    let current = x;
    while (current !== root) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 合并建议分数阈值——低于此值不建议合并 */
const MERGE_THRESHOLD = 50;

/**
 * 生成同一本书内经纬条目的合并建议。
 *
 * @param entries - 正式条目与候选条目的混合列表
 * @param options.bookId - 限定此 bookId（如果所有条目已属同一本书则可省略）
 * @param options.threshold - 自定义分数阈值（默认 50）
 * @returns 合并建议分组与未匹配条目列表
 */
export function generateMergeSuggestions(
  entries: readonly MergeEntry[],
  options?: { bookId?: string; threshold?: number },
): MergeSuggestionResult {
  const threshold = options?.threshold ?? MERGE_THRESHOLD;
  const targetBookId = options?.bookId;

  // 过滤 bookId
  const filtered = targetBookId
    ? entries.filter((e) => e.bookId === targetBookId)
    : entries;

  if (filtered.length === 0) {
    return { bookId: targetBookId ?? "", groups: [], ungrouped: [] };
  }

  // 确定 bookId（取第一个）
  const bookId = targetBookId ?? filtered[0].bookId;

  // 仅处理当前 bookId（硬隔离）
  const bookEntries = filtered.filter((e) => e.bookId === bookId);
  const buckets = bucketEntries(bookEntries);

  // 收集所有达标的 pair
  const pairs: ScoredPair[] = [];
  for (const [bucketKey, bucket] of buckets) {
    const cat = bucketKey.split("::")[1] as JingweiCategory;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const signals = computeSignals(bucket[i], bucket[j], cat);
        const total = signals.reduce((sum, s) => sum + s.score, 0);
        if (total >= threshold) {
          pairs.push({ a: bucket[i], b: bucket[j], signals, total });
        }
      }
    }
  }

  // Union-Find 聚合传递性分组
  const uf = new UnionFind();
  for (const p of pairs) {
    uf.union(p.a.id, p.b.id);
  }

  // 按组根收集条目
  const groupMap = new Map<string, Set<string>>();
  const allPairedIds = new Set<string>();
  for (const p of pairs) {
    allPairedIds.add(p.a.id);
    allPairedIds.add(p.b.id);
  }
  for (const id of allPairedIds) {
    const root = uf.find(id);
    let set = groupMap.get(root);
    if (!set) {
      set = new Set();
      groupMap.set(root, set);
    }
    set.add(id);
  }

  // 条目 index
  const entryById = new Map<string, MergeEntry>();
  for (const e of bookEntries) entryById.set(e.id, e);

  // 构建 groups
  const groups: MergeSuggestionGroup[] = [];
  for (const [, memberIds] of groupMap) {
    const members = [...memberIds].map((id) => entryById.get(id)!).filter(Boolean);
    if (members.length < 2) continue;

    // 合并所有 pair 信号
    const groupSignals: MergeMatchSignal[] = [];
    let maxTotal = 0;
    for (const p of pairs) {
      if (memberIds.has(p.a.id) && memberIds.has(p.b.id)) {
        for (const s of p.signals) {
          // 去重同 reason（保留 score 最高的）
          const existing = groupSignals.find((gs) => gs.reason === s.reason && gs.detail === s.detail);
          if (!existing) groupSignals.push(s);
          else if (s.score > existing.score) {
            groupSignals.splice(groupSignals.indexOf(existing), 1, s);
          }
        }
        if (p.total > maxTotal) maxTotal = p.total;
      }
    }

    const survivor = pickSurvivor(members);
    const duplicates = members.filter((m) => m.id !== survivor).map((m) => m.id);
    const conflicts = extractConflicts(members);
    const cat = normalizeCategory(members[0].category).category;

    // requiresAuthorChoice: 多于 2 个候选 OR 有冲突字段 OR 多个非 canonical 条目
    const nonCanonicalCount = members.filter((m) => !m.isCanonical).length;
    const requiresAuthorChoice = conflicts.length > 0 || nonCanonicalCount > 1 || members.length > 2;

    // groupKey: 稳定排序 IDs 拼接
    const sortedIds = [...memberIds].sort();
    const groupKey = `merge:${cat}:${sortedIds.join("+")}`;

    groups.push({
      groupKey,
      score: maxTotal,
      reasons: groupSignals,
      survivor,
      duplicates,
      conflicts,
      requiresAuthorChoice,
      entries: members,
      category: cat,
    });
  }

  // 按 score 降序
  groups.sort((a, b) => b.score - a.score);

  // 未分组
  const groupedIds = new Set(groups.flatMap((g) => g.entries.map((e) => e.id)));
  const ungrouped = bookEntries.filter((e) => !groupedIds.has(e.id)).map((e) => e.id);

  return { bookId, groups, ungrouped };
}
