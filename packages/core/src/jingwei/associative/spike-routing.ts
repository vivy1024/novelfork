/**
 * Spike routing — given seed entities, propagate activation through co-occurrence graph
 * to discover weakly related but potentially useful entries.
 */

export interface SpikeResult {
  entity: string;
  activation: number; // 0-1
  hops: number;       // distance from seed
  path: string[];     // how we got here
}

/**
 * Propagate activation from seed entities through co-occurrence graph.
 * Returns top-K activated entities (excluding seeds).
 */
export async function propagateSpikes(
  bookId: string,
  seeds: string[],
  options: { maxHops?: number; decayRate?: number; topK?: number; minActivation?: number } = {},
): Promise<SpikeResult[]> {
  const { maxHops = 3, decayRate = 0.5, topK = 10, minActivation = 0.1 } = options;
  const { getStorageDatabase } = await import("../../storage/db.js");
  const storage = getStorageDatabase();

  // Activation map: entity → { activation, hops, path }
  const activations = new Map<string, { activation: number; hops: number; path: string[] }>();

  // Initialize seeds with activation 1.0
  const frontier: Array<{ entity: string; activation: number; hops: number; path: string[] }> = [];
  for (const seed of seeds) {
    activations.set(seed, { activation: 1.0, hops: 0, path: [seed] });
    frontier.push({ entity: seed, activation: 1.0, hops: 0, path: [seed] });
  }

  // BFS propagation
  while (frontier.length > 0) {
    const current = frontier.shift()!;
    if (current.hops >= maxHops) continue;

    // Get neighbors from co-occurrence
    const neighbors = storage.sqlite.prepare(
      `SELECT tag_b as neighbor, count FROM jingwei_cooccurrence WHERE book_id = ? AND tag_a = ?
       UNION ALL
       SELECT tag_a as neighbor, count FROM jingwei_cooccurrence WHERE book_id = ? AND tag_b = ?
       ORDER BY count DESC LIMIT 20`
    ).all(bookId, current.entity, bookId, current.entity) as Array<{ neighbor: string; count: number }>;

    // Normalize counts for this node
    const totalCount = neighbors.reduce((sum, n) => sum + n.count, 0) || 1;

    for (const { neighbor, count } of neighbors) {
      if (seeds.includes(neighbor)) continue; // skip seeds

      // Calculate propagated activation
      const edgeWeight = count / totalCount;
      const propagated = current.activation * decayRate * edgeWeight;

      if (propagated < minActivation) continue;

      const existing = activations.get(neighbor);
      if (!existing || existing.activation < propagated) {
        const newPath = [...current.path, neighbor];
        activations.set(neighbor, { activation: propagated, hops: current.hops + 1, path: newPath });
        frontier.push({ entity: neighbor, activation: propagated, hops: current.hops + 1, path: newPath });
      }
    }
  }

  // Remove seeds and sort by activation
  const results: SpikeResult[] = [];
  for (const [entity, data] of activations) {
    if (seeds.includes(entity)) continue;
    results.push({ entity, ...data });
  }

  return results.sort((a, b) => b.activation - a.activation).slice(0, topK);
}
