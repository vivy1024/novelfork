export type ResidualFacet = Readonly<{
  tagId: string;
  vector: readonly number[];
}>;

export type ResidualPyramidLevel = Readonly<{
  level: number;
  facets: readonly Readonly<{ tagId: string; similarity: number }>[];
  energyRatio: number;
}>;

export type ResidualPyramidResult = Readonly<{
  levels: readonly ResidualPyramidLevel[];
  finalEnergyRatio: number;
  fallback?: "missing_embedding";
}>;

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

function energy(vector: readonly number[]): number {
  return vector.reduce((sum, value) => sum + value * value, 0);
}

function cosine(a: readonly number[], b: readonly number[]): number {
  const denominator = Math.sqrt(energy(a)) * Math.sqrt(energy(b));
  if (a.length === 0 || a.length !== b.length || denominator <= 0) return Number.NEGATIVE_INFINITY;
  return dot(a, b) / denominator;
}

function subtractProjection(residual: readonly number[], basis: readonly number[]): number[] {
  const basisEnergy = energy(basis);
  if (basisEnergy <= 0 || residual.length !== basis.length) return [...residual];
  const coefficient = dot(residual, basis) / basisEnergy;
  return residual.map((value, index) => value - coefficient * (basis[index] ?? 0));
}

export function buildResidualPyramid(input: Readonly<{
  queryVector: readonly number[];
  facets: readonly ResidualFacet[];
  config?: Partial<Readonly<{ maxLevels: number; topK: number; minEnergyRatio: number }>>;
}>): ResidualPyramidResult {
  const config = { maxLevels: 3, topK: 2, minEnergyRatio: 0.1, ...(input.config ?? {}) };
  const candidates = input.facets.filter((facet) => facet.vector.length === input.queryVector.length);
  const baseEnergy = energy(input.queryVector);
  if (input.queryVector.length === 0 || candidates.length === 0 || baseEnergy <= 0) {
    return { levels: [], finalEnergyRatio: 1, fallback: "missing_embedding" };
  }

  let residual = [...input.queryVector];
  const used = new Set<string>();
  const levels: ResidualPyramidLevel[] = [];
  for (let level = 0; level < config.maxLevels; level += 1) {
    const ranked = candidates
      .filter((facet) => !used.has(facet.tagId))
      .map((facet) => ({ facet, similarity: cosine(residual, facet.vector) }))
      .filter((item) => item.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity || a.facet.tagId.localeCompare(b.facet.tagId))
      .slice(0, config.topK);
    if (ranked.length === 0) break;
    for (const item of ranked) {
      used.add(item.facet.tagId);
      residual = subtractProjection(residual, item.facet.vector);
    }
    const energyRatio = energy(residual) / baseEnergy;
    levels.push({ level, facets: ranked.map((item) => ({ tagId: item.facet.tagId, similarity: item.similarity })), energyRatio });
    if (energyRatio < config.minEnergyRatio) break;
  }

  return { levels, finalEnergyRatio: energy(residual) / baseEnergy };
}
