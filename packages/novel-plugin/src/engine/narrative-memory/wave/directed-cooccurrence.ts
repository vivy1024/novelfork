/**
 * 有向序位共现矩阵 —— 移植自我们自己的 Wave Memory 插件
 * （`astrbot_plugin_wave_memory/engine/directed_cooccurrence.py`，v4.7.2）。
 *
 * 为什么必须用它而不是字符串匹配建边：
 *   之前 narrative-graph 用「名字包含/复合主体拆分」造边，实测该书只建出 37 条，
 *   还混进「陈默交付含原版文件」「练习记录」这类根本不是实体的节点。
 *   Wave Memory 在 5 个群跑 80 天得到 133,000 节点 / 447,000 有向边，
 *   边**全部是算出来的**，不依赖任何人工标注关系 —— 这正是我们缺的能力。
 *
 * 边权公式（与 Python 版逐项对齐）：
 *   weight = Φ(src) × Φ(tgt) × bellGain(sim) × (0.7 + 0.6 × residual(tgt))
 *
 *   · Φ 序位势能：同一条记忆里越靠前的标签势能越高（0.9 → 0.5），
 *     使「先出现的实体指向后出现的实体」形成方向性，替代图数据库的显式边。
 *   · bellGain 语义增益：相似度处在中间带的边信息量最大；
 *     过于相似（冗余）或毫不相似（噪声）都压低权重。
 *   · residual 反向锚定：高残差（更不可预测 = 信息量更高）的目标节点加权。
 *
 * 小说场景的映射：一条「记忆」= 一个章节或一个事件，「标签」= 该处出现的实体。
 * 于是「同章出现的角色/地点/物品」自动连成有向图，章内出场次序即序位。
 */

/** 语义增益配置（默认值与 Python 版 SemanticGainConfig 一致）。 */
export interface SemanticGainConfig {
  readonly center: number;
  readonly width: number;
  readonly floor: number;
  readonly ceiling: number;
}

export const DEFAULT_SEMANTIC_GAIN: SemanticGainConfig = {
  center: 0.5,
  width: 0.3,
  floor: 0.1,
  ceiling: 1.0,
};

/**
 * 小说实体对标定（bge-m3，真实书抽样）：中位数 sim≈0.256，
 * 默认 center=0.5 会把大部分边压到钟形左侧。小说场景用这组。
 */
export const NOVEL_ENTITY_SEMANTIC_GAIN: SemanticGainConfig = {
  center: 0.26,
  width: 0.22,
  floor: 0.1,
  ceiling: 1.0,
};

/** 每个源节点保留的最强邻居数上限（防止稠密共现把内存吃爆）。 */
export const DEFAULT_MAX_NEIGHBORS_PER_TAG = 64;

/**
 * 序位势能 Φ ∈ [0.5, 0.9]。
 * position 从 1 起；越靠前势能越高，使方向性指向「后出现者」。
 */
export function ordinalPotential(position: number, maxPosition: number): number {
  if (position <= 0) return 0.7;
  if (maxPosition <= 1) return 0.7;
  return 0.9 - 0.4 * ((position - 1) / (maxPosition - 1));
}

/**
 * 钟形语义增益。相似度落在 center 附近的边增益最高（新信息量最大）。
 * 没有 embedding 时调用方传 center 值即可退化为「不调制」。
 */
export function bellGain(similarity: number, config: SemanticGainConfig = DEFAULT_SEMANTIC_GAIN): number {
  const x = (similarity - config.center) / config.width;
  const raw = Math.exp(-0.5 * x * x);
  return config.floor + (config.ceiling - config.floor) * raw;
}

// ─── 输入 ─────────────────────────────────────────────────────────────────

/** 一条「记忆」：小说里是一章或一个事件。 */
export interface CooccurrenceRecord {
  readonly id: string;
  /** 该记忆里按出场顺序排列的实体 id（position 由数组下标决定）。 */
  readonly tagIds: readonly string[];
  /** 可选：章号，用于 valid-time 与时序过滤。 */
  readonly chapterNumber?: number;
}

export interface BuildCooccurrenceInput {
  readonly records: readonly CooccurrenceRecord[];
  /** 标签对相似度查询；缺省时不做语义调制（等价 gain=ceiling 附近）。 */
  readonly similarity?: (sourceId: string, targetId: string) => number | undefined;
  /** 各标签的内生残差 [0,1]；缺省 0.5。 */
  readonly residuals?: ReadonlyMap<string, number>;
  readonly gainConfig?: SemanticGainConfig;
  readonly maxNeighborsPerTag?: number;
  /** 归一化后低于此权重的边丢弃（与 Python 版导图阈值 0.05 一致）。 */
  readonly minWeight?: number;
}

// ─── 输出 ─────────────────────────────────────────────────────────────────

export interface CooccurrenceEdge {
  readonly source: string;
  readonly target: string;
  /** 归一化到 [0,1] 的边权。 */
  readonly weight: number;
  /** 共同出现次数，用于给作者解释「他们同场多少次」。 */
  readonly coCount: number;
  /** 首次共现的章号。 */
  readonly firstChapter?: number;
  readonly lastChapter?: number;
}

export interface CooccurrenceGraph {
  /** source → target → 边。 */
  readonly forward: ReadonlyMap<string, ReadonlyMap<string, CooccurrenceEdge>>;
  readonly backward: ReadonlyMap<string, ReadonlyMap<string, CooccurrenceEdge>>;
  readonly edges: readonly CooccurrenceEdge[];
  readonly nodeCount: number;
  /** 被邻居上限裁掉的边数，用于诚实报告图被截断。 */
  readonly prunedEdges: number;
}

interface MutableEdge {
  weight: number;
  coCount: number;
  firstChapter?: number;
  lastChapter?: number;
}

/**
 * 构建有向共现图。
 *
 * 复杂度：Σ(每条记忆的实体数²)。小说场景每章实体数远小于群聊标签数，
 * 209 条目 / 340 事件量级下是毫秒级。
 */
export function buildDirectedCooccurrence(input: BuildCooccurrenceInput): CooccurrenceGraph {
  const gainConfig = input.gainConfig ?? DEFAULT_SEMANTIC_GAIN;
  const maxNeighbors = Math.max(1, input.maxNeighborsPerTag ?? DEFAULT_MAX_NEIGHBORS_PER_TAG);
  const minWeight = input.minWeight ?? 0.05;

  const accum = new Map<string, Map<string, MutableEdge>>();
  const nodes = new Set<string>();

  for (const record of input.records) {
    // 去重但保留首次出现的次序：同一实体在一章里出现多次不该自连
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const tagId of record.tagIds) {
      if (!tagId || seen.has(tagId)) continue;
      seen.add(tagId);
      tags.push(tagId);
    }
    if (tags.length < 2) {
      // 单实体章节仍要登记节点，否则孤立角色会从图里消失
      for (const tagId of tags) nodes.add(tagId);
      continue;
    }

    const maxPosition = tags.length;
    for (let i = 0; i < tags.length; i += 1) {
      const sourceId = tags[i]!;
      nodes.add(sourceId);
      const sourcePhi = ordinalPotential(i + 1, maxPosition);
      for (let j = 0; j < tags.length; j += 1) {
        if (i === j) continue;
        const targetId = tags[j]!;
        const targetPhi = ordinalPotential(j + 1, maxPosition);

        let weight = sourcePhi * targetPhi;

        // 语义增益调制（有 embedding 时才生效）
        const sim = input.similarity?.(sourceId, targetId);
        if (sim !== undefined && Number.isFinite(sim)) {
          weight *= bellGain(sim, gainConfig);
        }

        // 反向锚定：高残差目标加权
        const residual = input.residuals?.get(targetId) ?? 0.5;
        weight *= 0.7 + 0.6 * residual;

        const row = accum.get(sourceId) ?? new Map<string, MutableEdge>();
        const existing = row.get(targetId);
        if (existing) {
          existing.weight += weight;
          existing.coCount += 1;
          if (record.chapterNumber !== undefined) {
            existing.firstChapter = existing.firstChapter === undefined
              ? record.chapterNumber
              : Math.min(existing.firstChapter, record.chapterNumber);
            existing.lastChapter = existing.lastChapter === undefined
              ? record.chapterNumber
              : Math.max(existing.lastChapter, record.chapterNumber);
          }
        } else {
          row.set(targetId, {
            weight,
            coCount: 1,
            ...(record.chapterNumber !== undefined
              ? { firstChapter: record.chapterNumber, lastChapter: record.chapterNumber }
              : {}),
          });
        }
        accum.set(sourceId, row);
      }
    }
  }

  // 归一化到 [0,1]
  let maxWeight = 0;
  for (const row of accum.values()) {
    for (const edge of row.values()) {
      if (edge.weight > maxWeight) maxWeight = edge.weight;
    }
  }

  const forward = new Map<string, Map<string, CooccurrenceEdge>>();
  const backward = new Map<string, Map<string, CooccurrenceEdge>>();
  const edges: CooccurrenceEdge[] = [];
  let prunedEdges = 0;

  for (const [sourceId, row] of accum) {
    // 每源只留最强的 N 条邻居
    const ranked = [...row.entries()]
      .map(([targetId, edge]) => ({ targetId, edge }))
      .sort((left, right) => right.edge.weight - left.edge.weight);
    const kept = ranked.slice(0, maxNeighbors);
    prunedEdges += ranked.length - kept.length;

    for (const { targetId, edge } of kept) {
      const normalized = maxWeight > 0 ? edge.weight / maxWeight : 0;
      if (normalized < minWeight) {
        prunedEdges += 1;
        continue;
      }
      const record: CooccurrenceEdge = {
        source: sourceId,
        target: targetId,
        weight: Number(normalized.toFixed(4)),
        coCount: edge.coCount,
        ...(edge.firstChapter !== undefined ? { firstChapter: edge.firstChapter } : {}),
        ...(edge.lastChapter !== undefined ? { lastChapter: edge.lastChapter } : {}),
      };
      edges.push(record);
      const forwardRow = forward.get(sourceId) ?? new Map<string, CooccurrenceEdge>();
      forwardRow.set(targetId, record);
      forward.set(sourceId, forwardRow);
      const backwardRow = backward.get(targetId) ?? new Map<string, CooccurrenceEdge>();
      backwardRow.set(sourceId, record);
      backward.set(targetId, backwardRow);
    }
  }

  return {
    forward,
    backward,
    edges: edges.sort((left, right) => right.weight - left.weight),
    nodeCount: nodes.size,
    prunedEdges,
  };
}

/**
 * 无向合并视图：把 a→b 与 b→a 合成一条边，取权重较大者。
 * 关系树/关系网这类展示不需要方向时用它，避免同一对实体画两条线。
 */
export function toUndirected(graph: CooccurrenceGraph): readonly CooccurrenceEdge[] {
  const merged = new Map<string, CooccurrenceEdge>();
  for (const edge of graph.edges) {
    const key = edge.source < edge.target
      ? `${edge.source}\u0000${edge.target}`
      : `${edge.target}\u0000${edge.source}`;
    const existing = merged.get(key);
    if (!existing || edge.weight > existing.weight) {
      merged.set(key, edge);
    }
  }
  return [...merged.values()].sort((left, right) => right.weight - left.weight);
}

/** 取某节点的最强邻居（供 Inspector 与工具子图查询）。 */
export function strongestNeighbors(
  graph: CooccurrenceGraph,
  nodeId: string,
  limit = 12,
): readonly CooccurrenceEdge[] {
  const out = [...(graph.forward.get(nodeId)?.values() ?? [])];
  const incoming = [...(graph.backward.get(nodeId)?.values() ?? [])];
  const merged = new Map<string, CooccurrenceEdge>();
  for (const edge of [...out, ...incoming]) {
    const other = edge.source === nodeId ? edge.target : edge.source;
    const existing = merged.get(other);
    if (!existing || edge.weight > existing.weight) merged.set(other, edge);
  }
  return [...merged.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, limit);
}

/**
 * 内生残差的轻量替代：用「节点度数的反比」当不可预测度。
 *
 * Python 版用 SVD 邻居子空间求残差（intrinsic_residual.py），需要 embedding。
 * 没有 embedding 时用这个近似：高频出现的实体（主角）残差低，
 * 偶现实体残差高 —— 与「信息量」的直觉一致，也不会让主角吸走全部权重。
 */
export function approximateResiduals(records: readonly CooccurrenceRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const tagId of new Set(record.tagIds)) {
      counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    }
  }
  const values = [...counts.values()];
  const maxCount = values.length > 0 ? Math.max(...values) : 1;
  const residuals = new Map<string, number>();
  for (const [tagId, count] of counts) {
    // 出现越少 → 残差越高（信息量越大），压到 [0.15, 0.95] 避免极端权重
    const ratio = maxCount > 0 ? count / maxCount : 0;
    residuals.set(tagId, Math.min(0.95, Math.max(0.15, 1 - ratio)));
  }
  return residuals;
}
