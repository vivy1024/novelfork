/**
 * CodeGraph 重要性排序
 *
 * v1：被 import 次数（refCount）——被越多文件引用的文件越重要。
 * 预留 PageRank（纯实现，无外部依赖），v2 可切换。
 */
import type { FileEntry } from "./extract.js";

export interface RankedFile {
  readonly path: string;
  /** 被多少个其它文件 import */
  readonly refCount: number;
  /** PageRank 分数（v2；v1 与 refCount 归一化一致） */
  readonly rank: number;
}

/** v1：统计每个文件被 import 的次数 */
export function rankByRefCount(files: readonly FileEntry[]): Map<string, RankedFile> {
  const refCount = new Map<string, number>();
  for (const f of files) refCount.set(f.path, 0);
  for (const f of files) {
    for (const target of f.imports) {
      if (refCount.has(target)) refCount.set(target, (refCount.get(target) ?? 0) + 1);
    }
  }
  const maxRef = Math.max(1, ...refCount.values());
  const result = new Map<string, RankedFile>();
  for (const [path, count] of refCount) {
    result.set(path, { path, refCount: count, rank: count / maxRef });
  }
  return result;
}

/**
 * PageRank（纯实现，预留 v2）。节点=文件，边=import（A→B 表示 A 引用 B）。
 * damping=0.85，迭代 30 次足够收敛（数千节点毫秒级）。
 */
export function pageRank(files: readonly FileEntry[], damping = 0.85, iterations = 30): Map<string, RankedFile> {
  const nodes = files.map((f) => f.path);
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const n = nodes.length;
  if (n === 0) return new Map();

  // 出边：A → 它 import 的项目内文件
  const outEdges: number[][] = files.map((f) =>
    f.imports.map((t) => idx.get(t)).filter((i): i is number => i !== undefined),
  );

  let pr = new Array(n).fill(1 / n);
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Array(n).fill((1 - damping) / n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      const outs = outEdges[i]!;
      if (outs.length === 0) {
        dangling += pr[i];
      } else {
        const share = (damping * pr[i]) / outs.length;
        for (const j of outs) next[j] += share;
      }
    }
    const danglingShare = (damping * dangling) / n;
    for (let i = 0; i < n; i++) next[i] += danglingShare;
    pr = next;
  }

  const refByRefCount = rankByRefCount(files);
  const maxPr = Math.max(...pr);
  const result = new Map<string, RankedFile>();
  for (let i = 0; i < n; i++) {
    const path = nodes[i]!;
    result.set(path, {
      path,
      refCount: refByRefCount.get(path)?.refCount ?? 0,
      rank: maxPr > 0 ? pr[i] / maxPr : 0,
    });
  }
  return result;
}
