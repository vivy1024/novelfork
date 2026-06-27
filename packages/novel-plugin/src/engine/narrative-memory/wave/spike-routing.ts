export type SpikeRoutingEdge = Readonly<{
  sourceTagId: string;
  targetTagId: string;
  weight: number;
}>;

export type ActivatedNarrativeTag = Readonly<{
  tagId: string;
  energy: number;
  hop: number;
}>;

export type SpikeRoutingResult = Readonly<{
  activatedTags: readonly ActivatedNarrativeTag[];
}>;

export function routeNarrativeSpikes(input: Readonly<{
  seedTagIds: readonly string[];
  edges: readonly SpikeRoutingEdge[];
  logicDepth: number;
  config?: Partial<Readonly<{ maxHops: number; firingThreshold: number; maxEmergentNodes: number; maxNeighborsPerNode: number }>>;
}>): SpikeRoutingResult {
  const config = { maxHops: 2, firingThreshold: 0.12, maxEmergentNodes: 16, maxNeighborsPerNode: 8, ...(input.config ?? {}) };
  const momentum = input.logicDepth >= 0.7 ? 0.25 : 0.75;
  const adjacency = new Map<string, SpikeRoutingEdge[]>();
  for (const edge of input.edges) {
    const list = adjacency.get(edge.sourceTagId) ?? [];
    list.push(edge);
    adjacency.set(edge.sourceTagId, list);
  }
  for (const [tagId, list] of adjacency) {
    adjacency.set(tagId, [...list].sort((a, b) => b.weight - a.weight || a.targetTagId.localeCompare(b.targetTagId)).slice(0, config.maxNeighborsPerNode));
  }

  const energyByTag = new Map<string, ActivatedNarrativeTag>();
  let frontier = [...new Set(input.seedTagIds)].map((tagId) => ({ tagId, energy: 1, hop: 0 }));
  for (let hop = 1; hop <= config.maxHops; hop += 1) {
    const next: ActivatedNarrativeTag[] = [];
    for (const item of frontier) {
      for (const edge of adjacency.get(item.tagId) ?? []) {
        const energy = item.energy * edge.weight * momentum;
        if (energy < config.firingThreshold) continue;
        const previous = energyByTag.get(edge.targetTagId);
        if (!previous || energy > previous.energy) {
          const activated = { tagId: edge.targetTagId, energy, hop };
          energyByTag.set(edge.targetTagId, activated);
          next.push(activated);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0 || energyByTag.size >= config.maxEmergentNodes) break;
  }

  return {
    activatedTags: [...energyByTag.values()]
      .sort((a, b) => b.energy - a.energy || a.hop - b.hop || a.tagId.localeCompare(b.tagId))
      .slice(0, config.maxEmergentNodes),
  };
}
